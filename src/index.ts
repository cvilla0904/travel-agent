import { fileURLToPath } from "node:url";
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Agent, MemorySession, run, tool } from '@openai/agents';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
import { buscarLugaresGeoapify } from './services/geoapify.js';
import { buscarActividadesApify, buscarActividadesApifyMultidestino } from './services/apify.js';
import { buscarVuelosApify } from './services/apify-flights.js';
import { buscarHotelesSearchApi } from './services/searchapi.js';

/* =========================================================
   1. FUNCIONES AUXILIARES
   ========================================================= */

/**
 * Calcula la duración del viaje en días a partir de las fechas.
 */
function calcularDuracionDias(
  fechaIda: string,
  fechaVuelta: string,
): number {
  const inicio = new Date(`${fechaIda}T00:00:00`);
  const fin = new Date(`${fechaVuelta}T00:00:00`);

  const diferencia =
    fin.getTime() - inicio.getTime();

  return Math.max(
    1,
    Math.round(
      diferencia / (1000 * 60 * 60 * 24),
    ),
  );
}

/* Los destinos se concretan a partir de las preferencias del usuario y los resultados de los proveedores activos. */

const routeStore = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

/* =========================================================
   3. TOOL: PLANIFICACIÓN DE RUTA MULTIDESTINO
   ========================================================= */

const planificarRuta = tool({
  name: 'planificar_ruta',
  description:
    'Organiza una ruta multidestino a partir de las ciudades que el Travel Manager considera adecuadas. Distribuye los días del viaje entre las ciudades sin superar la duración disponible.',
  parameters: {
    type: 'object',
    properties: {
      pais: {
        type: 'string',
        description: 'País principal del viaje.',
      },
      duracionDias: {
        type: 'number',
        description: 'Duración total del viaje en días.',
      },
      rutaId: {
        type: 'string',
        description: 'Identificador de la ruta propuesta y aceptada. Debe proceder directamente de planificar_ruta.',
      },
      ciudades: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ciudad: {
              type: 'string',
              description: 'Nombre de la ciudad.',
            },
            dias: {
              type: 'number',
              description: 'Número de días que se dedicarán a esta ciudad.',
            },
          },
          required: ['ciudad', 'dias'],
          additionalProperties: false,
        },
        description: 'Ciudades propuestas para la ruta y número de días para cada una.',
      },
    },
    required: ['pais', 'duracionDias', 'ciudades'],
    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      pais,
      duracionDias,
      ciudades,
    } = input as {
      pais: string;
      duracionDias: number;
      ciudades: Array<{ ciudad: string; dias: number }>;
    };

    const diasTotales = Math.max(1, Math.round(duracionDias));

    const ciudadesUnicas = Array.from(
      new Map(
        ciudades
          .filter(
            (item) =>
              item &&
              typeof item.ciudad === 'string' &&
              item.ciudad.trim() &&
              Number.isFinite(item.dias) &&
              item.dias > 0,
          )
          .map((item) => [
            item.ciudad.trim(),
            {
              ciudad: item.ciudad.trim(),
              dias: Math.max(1, Math.round(item.dias)),
            },
          ]),
      ).values(),
    ).slice(0, 4);

    if (ciudadesUnicas.length === 0) {
      throw new Error(
        'No se han proporcionado ciudades válidas para construir la ruta.',
      );
    }

    let diasAsignados = ciudadesUnicas.reduce(
      (total, item) => total + item.dias,
      0,
    );

    while (
      diasAsignados > diasTotales &&
      ciudadesUnicas.some((item) => item.dias > 1)
    ) {
      const ciudad = [...ciudadesUnicas]
        .reverse()
        .find((item) => item.dias > 1);

      if (!ciudad) break;

      ciudad.dias -= 1;
      diasAsignados -= 1;
    }

    while (diasAsignados < diasTotales) {
      ciudadesUnicas[ciudadesUnicas.length - 1].dias += 1;
      diasAsignados += 1;
    }

    let diaInicio = 1;

    const ruta = ciudadesUnicas.map((item, index) => {
      const diaFin = diaInicio + item.dias - 1;

      const tramo = {
        orden: index + 1,
        ciudad: item.ciudad,
        dias: item.dias,
        diaInicio,
        diaFin,
      };

      diaInicio = diaFin + 1;
      return tramo;
    });

    const rutaId = randomUUID();

    await routeStore.set(
      `travel:route:${rutaId}`,
      { pais, duracionDias: diasTotales, ruta },
      { ex: 24 * 60 * 60 },
    );

    return {
      pais,
      duracionDias: diasTotales,
      ciudades: ruta.length,
      ruta,
      rutaId,
      nota:
        'Esta ruta queda fijada con un identificador. Cuando el usuario la acepte, las búsquedas reales deben utilizar exactamente esta ruta, sin añadir, eliminar ni sustituir ciudades.',
    };
  },
});

/* =========================================================
   3. TOOL + AGENT: VUELOS
   ========================================================= */

const buscarVuelos = tool({
  name: 'buscar_vuelos',
  description:
    'Busca vuelos reales con Apify Google Flights Scraper. Acepta nombres de ciudades o códigos IATA y devuelve precios, horarios, escalas y enlaces del proveedor.',
  parameters: {
    type: 'object',
    properties: {
      origen: { type: 'string', description: 'Ciudad, aeropuerto o código IATA de origen.' },
      destino: { type: 'string', description: 'Ciudad, aeropuerto o código IATA de destino.' },
      fechaIda: { type: 'string', description: 'Fecha de ida en formato YYYY-MM-DD.' },
      fechaVuelta: { type: 'string', description: 'Fecha de vuelta en formato YYYY-MM-DD.' },
      pasajeros: { type: 'number', description: 'Número de pasajeros adultos.' },
      aeropuertoDestino: { type: 'string', description: 'Opcional: código IATA de destino si ya está identificado.' },
      destinoRegreso: { type: 'string', description: 'Opcional: ciudad desde la que se vuelve al origen en un itinerario abierto.' },
    },
    required: ['origen', 'destino', 'fechaIda', 'fechaVuelta', 'pasajeros'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const {
      origen, destino, fechaIda, fechaVuelta, pasajeros,
      aeropuertoDestino, destinoRegreso,
    } = input as {
      origen: string; destino: string; fechaIda: string; fechaVuelta: string;
      pasajeros: number; aeropuertoDestino?: string; destinoRegreso?: string;
    };

    const idaYVuelta = await buscarVuelosApify({
      origen,
      destino: aeropuertoDestino?.trim() || destino,
      fechaIda,
      fechaVuelta: destinoRegreso ? undefined : fechaVuelta,
      pasajeros,
    });

    let opciones = idaYVuelta;
    let opcionesRegreso: any[] = [];
    if (destinoRegreso) {
      opcionesRegreso = await buscarVuelosApify({
        origen: destinoRegreso,
        destino: origen,
        fechaIda: fechaVuelta,
        pasajeros,
      });
    }

    const vuelos = destinoRegreso
      ? opciones.slice(0, 5).flatMap((ida: any) =>
          opcionesRegreso.slice(0, 5).map((vuelta: any) => combinarItinerarioAbierto(ida, vuelta, {
            origen, destino, destinoRegreso, fechaIda, fechaVuelta, pasajeros,
          })),
        )
      : opciones.map((vuelo: any) => normalizarVueloIdaVuelta(vuelo, {
          origen, destino, fechaIda, fechaVuelta, pasajeros,
        }));

    return {
      origen,
      destino,
      ...(destinoRegreso ? { destinoRegreso } : {}),
      aeropuertoDestino: aeropuertoDestino?.trim().toUpperCase() || destino,
      aeropuertoOrigen: origen,
      fechaIda,
      fechaVuelta,
      pasajeros,
      vuelos: vuelos
        .filter((vuelo: any) => Number.isFinite(vuelo.precioTotal) && vuelo.precioTotal > 0)
        .sort((a: any, b: any) => a.precioTotal - b.precioTotal)
        .slice(0, 10),
    };
  },
});

function parsearDuracionMinutos(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const texto = value.trim().toLowerCase();
  const horas = texto.match(/(\d+)\s*h/);
  const minutos = texto.match(/(\d+)\s*m/);
  if (horas || minutos) return Number(horas?.[1] ?? 0) * 60 + Number(minutos?.[1] ?? 0);
  const numerico = Number(texto);
  return Number.isFinite(numerico) ? numerico : 0;
}

function extraerSegmentosApify(leg: any, fallbackOrigen = '', fallbackDestino = '') {
  const segmentos = Array.isArray(leg?.segments) ? leg.segments
    : Array.isArray(leg?.flights) ? leg.flights
    : Array.isArray(leg) ? leg : [];
  return segmentos.map((segmento: any) => {
    const salida = segmento.departureAirport ?? segmento.departure_airport ?? segmento.departure ?? {};
    const llegada = segmento.arrivalAirport ?? segmento.arrival_airport ?? segmento.arrival ?? {};
    const hora = (value: any) => typeof value === 'string' ? value : value?.time ?? value?.datetime ?? '';
    const codigo = (value: any) => typeof value === 'string' ? (/^[A-Z]{3}$/i.test(value) ? value.toUpperCase() : '') : value?.code ?? value?.iata ?? value?.id ?? '';
    const nombre = (value: any, fallback: string) => typeof value === 'string' ? value : value?.name ?? value?.city ?? fallback;
    const duracion = parsearDuracionMinutos(segmento.durationMinutes ?? segmento.duration_minutes ?? segmento.duration ?? 0);
    return {
      aeropuertoSalida: nombre(salida, fallbackOrigen),
      codigoSalida: codigo(salida),
      horaSalida: hora(salida),
      aeropuertoLlegada: nombre(llegada, fallbackDestino),
      codigoLlegada: codigo(llegada),
      horaLlegada: hora(llegada),
      duracionMinutos: duracion,
      aerolinea: String(segmento.airline ?? segmento.airlineName ?? segmento.carrier ?? ''),
      numeroVuelo: String(segmento.flightNumber ?? segmento.flight_number ?? ''),
    };
  });
}

function normalizarVueloIdaVuelta(vuelo: any, ctx: {
  origen: string; destino: string; fechaIda: string; fechaVuelta: string; pasajeros: number;
}) {
  const ida = vuelo.outbound ?? vuelo.outboundLeg ?? vuelo.departure ?? vuelo.legs?.[0] ?? vuelo;
  const vuelta = vuelo.return ?? vuelo.returnLeg ?? vuelo.inbound ?? vuelo.legs?.[1] ?? null;
  const segmentosIda = extraerSegmentosApify(ida, ctx.origen, ctx.destino);
  const segmentosVuelta = extraerSegmentosApify(vuelta, ctx.destino, ctx.origen);
  const precioTotal = Number(vuelo.price ?? vuelo.totalPrice ?? vuelo.total_price ?? vuelo.priceTotal ?? 0);
  const aerolineas = [...new Set([...segmentosIda, ...segmentosVuelta].map((s: any) => s.aerolinea).filter(Boolean))];
  return {
    aerolinea: String(vuelo.airlines?.join?.(' + ') ?? aerolineas.join(' + ') ?? 'Aerolínea no indicada'),
    precioPorPersona: Number(vuelo.pricePerPassenger ?? vuelo.price_per_passenger ?? (precioTotal / ctx.pasajeros)),
    precioTotal,
    moneda: String(vuelo.currency ?? 'EUR'),
    enlace: String(vuelo.googleFlightsUrl ?? vuelo.google_flights_url ?? vuelo.url ?? ''),
    esIdaVuelta: true,
    tipo: 'Ida y vuelta',
    escalasIda: Math.max(0, segmentosIda.length - 1),
    escalasVuelta: Math.max(0, segmentosVuelta.length - 1),
    esDirecto: segmentosIda.length === 1 && segmentosVuelta.length === 1,
    ida: {
      fecha: ctx.fechaIda,
      segmentos: segmentosIda,
      duracionMinutos: parsearDuracionMinutos(ida?.durationMinutes ?? ida?.duration_minutes ?? ida?.duration ?? segmentosIda.reduce((t: number, s: any) => t + s.duracionMinutos, 0)),
    },
    vuelta: {
      fecha: ctx.fechaVuelta,
      segmentos: segmentosVuelta,
      duracionMinutos: parsearDuracionMinutos(vuelta?.durationMinutes ?? vuelta?.duration_minutes ?? vuelta?.duration ?? segmentosVuelta.reduce((t: number, s: any) => t + s.duracionMinutos, 0)),
    },
  };
}

function combinarItinerarioAbierto(idaRaw: any, vueltaRaw: any, ctx: {
  origen: string; destino: string; destinoRegreso: string; fechaIda: string; fechaVuelta: string; pasajeros: number;
}) {
  const ida = normalizarVueloIdaVuelta({ ...idaRaw, return: null }, {
    origen: ctx.origen, destino: ctx.destino, fechaIda: ctx.fechaIda, fechaVuelta: ctx.fechaIda, pasajeros: ctx.pasajeros,
  });
  const vuelta = normalizarVueloIdaVuelta({ ...vueltaRaw, return: null }, {
    origen: ctx.destinoRegreso, destino: ctx.origen, fechaIda: ctx.fechaVuelta, fechaVuelta: ctx.fechaVuelta, pasajeros: ctx.pasajeros,
  });
  const precioTotal = ida.precioTotal + vuelta.precioTotal;
  return {
    aerolinea: [ida.aerolinea, vuelta.aerolinea].filter(Boolean).join(' + '),
    precioPorPersona: Math.round(precioTotal / ctx.pasajeros),
    precioTotal,
    moneda: ida.moneda || vuelta.moneda || 'EUR',
    enlace: ida.enlace || vuelta.enlace || '',
    esIdaVuelta: true,
    tipo: 'Itinerario abierto / multidestino',
    escalasIda: ida.escalasIda,
    escalasVuelta: vuelta.escalasIda,
    esDirecto: ida.esDirecto && vuelta.esDirecto,
    ida: ida.ida,
    vuelta: { ...vuelta.ida, fecha: ctx.fechaVuelta },
  };
}

const flightSegmentSchema =
  z.object({
    aeropuertoSalida: z.string(),
    codigoSalida: z.string(),
    horaSalida: z.string(),
    aeropuertoLlegada: z.string(),
    codigoLlegada: z.string(),
    horaLlegada: z.string(),
    duracionMinutos: z.number(),
    aerolinea: z.string(),
    numeroVuelo: z.string(),
  });

const flightOutputSchema =
  z.object({
    origen: z.string(),
    destino: z.string(),
    aeropuertoDestino: z.string(),
    aeropuertoOrigen: z.string(),
    fechaIda: z.string(),
    fechaVuelta: z.string(),
    pasajeros: z.number(),
    vuelos: z.array(
      z.object({
        aerolinea: z.string(),
        precioPorPersona: z.number(),
        precioTotal: z.number(),
        moneda: z.string(),
        esIdaVuelta: z.boolean(),
        tipo: z.string(),
        escalasIda: z.number(),
        escalasVuelta: z.number(),
        esDirecto: z.boolean(),
        enlace: z.string(),
        ida: z.object({
          fecha: z.string(),
          segmentos: z.array(flightSegmentSchema),
          duracionMinutos: z.number(),
        }),
        vuelta: z.object({
          fecha: z.string(),
          segmentos: z.array(flightSegmentSchema),
          duracionMinutos: z.number(),
        }),
      }),
    ),
  });

const flightAgent = new Agent({
  name: 'Flight Agent',

  outputType:
    flightOutputSchema,

  instructions: `
    Eres un agente especializado exclusivamente en vuelos.

    Utiliza SIEMPRE la herramienta buscar_vuelos.

    Necesitas:
    - origen
    - destino
    - fecha de ida
    - fecha de vuelta
    - número de pasajeros

    Si el Travel Manager te proporciona un código IATA de destino,
    debes pasarlo a buscar_vuelos mediante aeropuertoDestino.

    Para una ruta multidestino/itinerario abierto, pasa destino como
    la primera ciudad de llegada y destinoRegreso como la última ciudad
    desde la que se vuelve al origen. Así se buscarán dos trayectos de
    solo ida y no un ida-vuelta a la primera ciudad.

    Apify admite nombres de ciudades y códigos IATA; si un código IATA está disponible, úsalo.

    Los vuelos devueltos son opciones reales de ida y vuelta.
    El precioTotal es el precio total de la opción para todos los pasajeros.
    precioPorPersona es el precio total dividido entre los pasajeros.

    Cuando existan datos de vuelta, muestra también:
    - hora de salida y llegada de la ida
    - hora de salida y llegada de la vuelta
    - aeropuertos de salida y llegada
    - códigos IATA
    - número de vuelo
    - duración de ida y vuelta
    - escalas de ida y vuelta
    - precio total
    - enlace real proporcionado por la herramienta

    FORMATO OBLIGATORIO PARA CADA VUELO:
    Cada vuelo debe ocupar UNA ÚNICA LÍNEA y seguir exactamente este formato:
    - **[Aerolínea]**: [precio total] € | Ida: [hora salida] [aeropuerto salida] ([IATA]) → [hora llegada] [aeropuerto llegada] ([IATA]) | [duración] | [escalas] | Vuelta: [hora salida] [aeropuerto salida] ([IATA]) → [hora llegada] [aeropuerto llegada] ([IATA]) | [duración] | [escalas] | [número(s) de vuelo] | https://...

    Es obligatorio incluir al final de cada línea el campo "enlace" real proporcionado por buscar_vuelos.
    Si el campo enlace está vacío, NO inventes una URL y escribe "Enlace no disponible".
    No omitas horarios, aeropuertos, duración, escalas ni el enlace cuando estén disponibles.

    No inventes:
    - vuelos
    - precios
    - aerolíneas
    - horarios
    - escalas
    - disponibilidad
    - condiciones

    Devuelve únicamente información obtenida de buscar_vuelos.
  `,

  tools: [
    buscarVuelos,
  ],
});

/* =========================================================
   4. TOOL + AGENT: HOTELES
   ========================================================= */

const buscarHoteles = tool({
  name: 'buscar_hoteles',
  description: 'Busca alojamientos en Booking.com mediante SearchAPI con destino, fechas y número de adultos. Conserva los alojamientos reales aunque el proveedor no publique precio y marca el precio como no disponible.',
  parameters: {
    type: 'object',
    properties: {
      destino: { type: 'string', description: 'Ciudad o destino del alojamiento.' },
      fechaEntrada: { type: 'string', description: 'Fecha de entrada en formato YYYY-MM-DD.' },
      fechaSalida: { type: 'string', description: 'Fecha de salida en formato YYYY-MM-DD.' },
      adultos: { type: 'number', description: 'Número de adultos.' },
    },
    required: ['destino','fechaEntrada','fechaSalida','adultos'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const { destino, fechaEntrada, fechaSalida, adultos } = input as { destino:string; fechaEntrada:string; fechaSalida:string; adultos:number };
    return await buscarHotelesSearchApi({ destino, fechaEntrada, fechaSalida, adultos });
  },
});

const hotelOutputSchema = z.object({
  destino: z.string(), fechaEntrada: z.string(), fechaSalida: z.string(), adultos: z.number(),
  hoteles: z.array(z.object({
    nombre:z.string(), estrellas:z.number(), valoracion:z.number(), numeroResenas:z.number(),
    precioTotal:z.number(), precioPorNoche:z.number(), moneda:z.string(), habitacion:z.string(),
    disponibilidad:z.string(), habitacionesDisponibles:z.number(), cancelacionGratuita:z.boolean(),
    cancelacionHasta:z.string(), url:z.string(), imagen:z.string(), zona:z.string(), distanciaCentro:z.string(),
    precioDisponible:z.boolean().optional(), fuentePrecio:z.string().optional(),
    ofertas:z.array(z.object({
      proveedor:z.string(), precioTotal:z.number(), precioPorNoche:z.number(),
      url:z.string(), esWebOficial:z.boolean(), cancelacionGratuita:z.boolean(),
      cancelacionHasta:z.string(),
    })).optional(),
    descripcion:z.string().optional(), tipo:z.string().optional(),
  })),
});

const hotelAgent = new Agent({
  name: 'Hotel Agent',
  outputType: hotelOutputSchema,
  instructions: `
    Eres un agente especializado exclusivamente en alojamiento.

    Utiliza SIEMPRE la herramienta buscar_hoteles.

    La herramienta buscar_hoteles obtiene alojamientos mediante Booking.com a través de SearchAPI.

    Necesitas:
    - destino
    - fecha de entrada
    - fecha de salida
    - número de adultos

    NO necesitas presupuesto para realizar la búsqueda.

    Devuelve únicamente alojamientos proporcionados por la herramienta.

    Conserva los datos reales proporcionados por la herramienta:
    - nombre
    - estrellas
    - valoración
    - reseñas
    - precio total
    - precio por noche
    - moneda
    - habitación
    - disponibilidad
    - habitaciones disponibles
    - cancelación gratuita
    - fecha límite de cancelación
    - enlace
    - zona
    - distancia al centro

    No inventes alojamientos, precios, estrellas, valoraciones, reseñas, disponibilidad ni condiciones.
    Si precioTotal o precioPorNoche es 0, significa que Google Hotels no proporcionó un precio utilizable: NO lo presentes como 0 €, gratis ni como precio real. Indica "Precio no disponible; consultar proveedor".
    No reduzcas las opciones a una única opción.
    Conserva el enlace real que devuelve Google Hotels. No inventes enlaces ni proveedores.

    Si el alojamiento incluye el array "ofertas", utiliza sus ofertas como
    comparación de precios para las mismas fechas y adultos. Muestra el precio
    total y el proveedor de cada oferta, con su enlace real correspondiente.
    No combines el precio de un proveedor con el enlace de otro. Si no hay
    ofertas comparables, conserva el precio agregado de Google Hotels y su
    enlace de comparación. No afirmes que una opción es la más barata de todo
    el mercado: solo es la más barata entre las ofertas devueltas.
  `,
  tools: [buscarHoteles],
});

/* =========================================================
   5. TOOL + AGENT: ACTIVIDADES
   ========================================================= */

const buscarActividades = tool({
  name: 'buscar_actividades',

  description:
    'Busca actividades y tours reales y reservables en el destino mediante Civitatis y Tiqets.',

  parameters: {
    type: 'object',

    properties: {
      destino: {
        type: 'string',

        description:
          'Ciudad o destino donde buscar.',
      },

      tipos: {
        type: 'array',

        items: {
          type: 'string',

          enum: [
            'naturaleza',
            'cultura',
            'gastronomía',
            'aventura',
          ],
        },

        description:
          'Tipos de actividades que interesan al viajero.',
      },
    },

    required: [
      'destino',
      'tipos',
    ],

    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      destino,
      tipos,
    } = input as {
      destino: string;
      tipos: string[];
    };

    const traduccionesTipo: Record<string, string[]> = {
      naturaleza: ['nature', 'outdoor', 'nature tours'],
      cultura: ['culture', 'museums', 'guided tours'],
      'gastronomía': ['food', 'gastronomy', 'food tours'],
      aventura: ['adventure', 'outdoor activities'],
    };
    const preferencias = tipos.flatMap((tipo) => traduccionesTipo[tipo] ?? []);
    // El actor espera ciudades en searchQueries; las preferencias no deben contaminar la consulta.
    console.info('[ACTIVITIES_DIAG] Tool started', JSON.stringify({ destino, tipos, preferencias }));
    const resultados = await buscarActividadesApify({ destino });
    console.info('[ACTIVITIES_DIAG] Provider returned', JSON.stringify({ destino, count: resultados.length, sampleFields: resultados[0] ? Object.keys(resultados[0] as Record<string, unknown>) : [] }));
    // Restauramos el criterio sencillo de la versión anterior: el propio proveedor
    // busca por ciudad. El filtro geográfico estricto estaba descartando resultados
    // válidos cuando la etiqueta city del actor no coincidía con el idioma del destino.
    // No descartamos una actividad real solo porque el proveedor no publique precio.
    // Exigimos título y URL HTTP(S); el precio se normaliza y puede quedar como null.
    const conTitulo = resultados.filter((actividad: any) => {
      const url = typeof actividad?.url === 'string' ? actividad.url.trim() : '';
      return typeof actividad?.title === 'string' &&
        actividad.title.trim().length > 0 &&
        (url.startsWith('https://') || url.startsWith('http://')) &&
        // El actor puede mezclar resultados de varias consultas en el mismo dataset.
        // Nunca mostramos una actividad si no podemos verificar que pertenece al destino.
        actividadEsDeCiudad(actividad, destino);
    });
    const normalizarTexto = (valor: unknown) => String(valor ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const parsearPrecio = (valor: unknown): number | null => {
      if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 0) return valor;
      if (typeof valor === 'string' && valor.trim()) {
        const limpio = valor.trim().replace(/[^0-9,.-]/g, '').replace(',', '.');
        const numero = Number(limpio);
        if (Number.isFinite(numero) && numero >= 0) return numero;
      }
      return null;
    };
    const conPreferencia = conTitulo.map((actividad: any) => ({
      ...actividad,
      _precioNormalizado: parsearPrecio(actividad.priceFrom),
      _preferencia: preferencias.reduce((puntos, termino) =>
        puntos + (normalizarTexto(actividad.title).includes(normalizarTexto(termino)) ? 1 : 0), 0),
    }));
    const unicos = Array.from(
      new Map(conPreferencia.map((actividad: any) => [actividad.url || actividad.title, actividad])).values(),
    ).sort((a: any, b: any) => b._preferencia - a._preferencia);
    console.info('[ACTIVITIES_DIAG] Filtering summary', JSON.stringify({ destino, conTitulo: conTitulo.length, conPrecio: conTitulo.filter((actividad: any) => parsearPrecio(actividad.priceFrom) !== null).length, unicos: unicos.length }));

    const salida = {
      destino,
      diagnosticoBusqueda: {
        consultas: [destino],
        resultadosProveedor: resultados.length,
        resultadosConTitulo: conTitulo.length,
        resultadosConPrecioNumerico: conTitulo.filter((actividad: any) => parsearPrecio(actividad.priceFrom) !== null).length,
      },
      actividades: unicos.slice(0, 15).map((actividad: any) => ({
        nombre: actividad.title,
        tipo: Array.isArray(actividad.categories) ? actividad.categories.join(', ') : tipos.join(', '),
        precio: actividad._precioNormalizado,
        moneda: typeof actividad.priceCurrency === 'string' && actividad.priceCurrency.trim()
          ? actividad.priceCurrency.trim().toUpperCase()
          : null,
        valoracion: Number.isFinite(Number(actividad.rating)) ? Number(actividad.rating) : 0,
        numeroResenas: Number.isFinite(Number(actividad.reviewCount)) ? Number(actividad.reviewCount) : 0,
        duracion: typeof actividad.durationText === 'string' ? actividad.durationText : '',
        cancelacionGratuita: typeof actividad.freeCancellation === 'boolean' ? actividad.freeCancellation : false,
        direccion: '',
        latitud: 0,
        longitud: 0,
        url: typeof actividad.url === 'string' ? actividad.url : '',
        plataforma: typeof actividad.platform === 'string' ? actividad.platform : '',
      })),
    };
    console.info('[ACTIVITIES_DIAG] Tool output', JSON.stringify({ destino, returnedActivities: salida.actividades.length }));
    return salida;
  },
});

const activitiesOutputSchema =
  z.object({
    destino: z.string(),
    diagnosticoBusqueda: z.object({
      consultas: z.array(z.string()),
      resultadosProveedor: z.number(),
      resultadosConTitulo: z.number(),
      resultadosConPrecioNumerico: z.number(),
    }),

    actividades:
      z.array(
        z.object({
          nombre:
            z.string(),

          tipo:
            z.string(),

          precio:
            z.number().nullable(),

          moneda:
            z.string().nullable(),

          valoracion:
            z.number(),

          numeroResenas:
            z.number(),

          duracion:
            z.string(),

          cancelacionGratuita:
            z.boolean(),

          direccion:
            z.string(),

          latitud:
            z.number(),

          longitud:
            z.number(),

          url:
            z.string(),

          plataforma:
            z.string(),
        }),
      ),
  });

const activitiesAgent =
  new Agent({
    name:
      'Activities Agent',

    outputType:
      activitiesOutputSchema,

    instructions: `
      Eres un agente especializado exclusivamente
      en actividades y tours turísticos reales.

      Utiliza SIEMPRE la herramienta buscar_actividades.

      Los resultados proceden de Civitatis y Tiqets
      mediante Apify y pueden incluir actividades
      reservables, precios, valoraciones, reseñas,
      duración y URL de reserva.

      IMPORTANTE:
      La herramienta de búsqueda funciona mejor con
      el nombre habitual de la ciudad en inglés.
      Si el destino recibido está en español u otro idioma,
      utiliza internamente su equivalente habitual en inglés
      para realizar la búsqueda.

      Ejemplos:
      - Florencia -> Florence
      - Venecia -> Venice
      - Roma -> Rome
      - Londres -> London
      - Múnich -> Munich

      No inventes:
      - actividades
      - precios
      - horarios
      - disponibilidad
      - valoraciones
      - características

      Devuelve únicamente información obtenida
      de buscar_actividades.

      Los precios deben utilizarse cuando la herramienta
      los proporcione. Si una actividad no tiene precio,
      no inventes ninguno.
    `,

    tools: [
      buscarActividades,
    ],
  });

/* =========================================================
   6. AGENTES ESPECIALIZADOS COMO TOOLS
   ========================================================= */

const flightAgentTool =
  flightAgent.asTool({
    toolName:
      'flight_agent',

    toolDescription:
      'Busca vuelos reales utilizando el Flight Agent.',
  });

const hotelAgentTool =
  hotelAgent.asTool({
    toolName:
      'hotel_agent',

    toolDescription:
      'Busca alojamientos reales utilizando el Hotel Agent.',
  });

const activitiesAgentTool =
  activitiesAgent.asTool({
    toolName:
      'activities_agent',

    toolDescription:
      'Busca lugares y actividades reales utilizando el Activities Agent.',
  });

function obtenerCodigoPais(pais: string): string | undefined {
  const clave = pais
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const codigos: Record<string, string> = {
    colombia: 'co',
    espana: 'es',
    españa: 'es',
    italia: 'it',
    francia: 'fr',
    portugal: 'pt',
    alemania: 'de',
    austria: 'at',
    'reino unido': 'gb',
    japon: 'jp',
    mexico: 'mx',
    méxico: 'mx',
    'estados unidos': 'us',
  };

  return codigos[clave];
}

function normalizarCiudadBusquedaMultidestino(ciudad: string, pais?: string): string {
  const valor = ciudad.trim();

  const equivalencias: Record<string, string> = {
    'cartagena': 'Cartagena de Indias, Colombia',
    'cartagena de indias': 'Cartagena de Indias, Colombia',
    'bogota': 'Bogotá, Colombia',
    'bogotá': 'Bogotá, Colombia',
    'medellin': 'Medellín, Colombia',
    'medellín': 'Medellín, Colombia',
  };

  const clave = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  if (equivalencias[clave]) {
    return equivalencias[clave];
  }

  return pais ? `${valor}, ${pais}` : valor;
}

function slugCiudadActividades(ciudad: string): string {
  const normalizada = ciudad
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (normalizada === 'cartagena' || normalizada === 'cartagena de indias') {
    return 'cartagena-de-indias';
  }

  return normalizada
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function actividadEsDeCiudad(actividad: any, ciudad: string): boolean {
  const normalizar = (valor: unknown) => String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const ciudadNormalizada = normalizar(ciudad);
  const ciudadActividad = normalizar(actividad?.city);
  const url = typeof actividad?.url === 'string' ? actividad.url.toLowerCase() : '';
  const titulo = normalizar(actividad?.title);
  const slug = slugCiudadActividades(ciudad);

  // El agente puede traducir el destino al inglés antes de llamar al proveedor.
  // Comparamos equivalencias habituales para no descartar Florencia/Florence.
  const equivalencias: Record<string, string[]> = {
    florencia: ['florencia', 'florence'],
    florence: ['florence', 'florencia'],
    venecia: ['venecia', 'venice'],
    venice: ['venice', 'venecia'],
    roma: ['roma', 'rome'],
    rome: ['rome', 'roma'],
    munich: ['munich'],
    bogota: ['bogota', 'bogota d.c.'],
    medellin: ['medellin'],
    'cartagena de indias': ['cartagena', 'cartagena de indias'],
    cartagena: ['cartagena', 'cartagena de indias'],
  };
  const nombresValidos = equivalencias[ciudadNormalizada] ?? [ciudadNormalizada];

  if (ciudadActividad) {
    // Algunos resultados etiquetan la ciudad como "Atracciones Florence"
    // y otros usan "Florence Attractions". Quitamos solo etiquetas genéricas.
    const ciudadLimpia = ciudadActividad
      .replace(/^(atracciones|attractions|things to do)\s+/, '')
      .replace(/\s+(attractions|things to do)$/, '')
      .trim();
    return nombresValidos.some((nombre) =>
      ciudadLimpia === nombre ||
      ciudadLimpia.startsWith(nombre + ',') ||
      ciudadLimpia.startsWith(nombre + ' -') ||
      ciudadLimpia.startsWith(nombre + ' (')
    );
  }

  if (!url) return false;
  if (slug === 'cartagena-de-indias') {
    return url.includes('/cartagena-de-indias/') || url.includes('/cartagena/');
  }
  return nombresValidos.some((nombre) =>
    url.includes('/' + nombre.replace(/\s+/g, '-') + '/') ||
    titulo.includes(nombre)
  );
}

/* =========================================================
   7. TOOL: RECURSOS PARA RUTA MULTIDESTINO
   ========================================================= */

const buscarRecursosMultidestino = tool({
  name: 'buscar_recursos_multidestino',
  description:
    'OBLIGATORIO para una ruta multidestino confirmada. Busca alojamiento y actividades reales para TODAS las ciudades de la ruta y devuelve los resultados separados por ciudad. No devuelve solo una ciudad.',
  parameters: {
    type: 'object',
    properties: {
      rutaId: {
        type: 'string',
        description: 'Identificador de la ruta propuesta y aceptada. Debe proceder directamente de planificar_ruta.',
      },
      ciudades: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ciudad: { type: 'string' },
            dias: { type: 'number' },
          },
          required: ['ciudad', 'dias'],
          additionalProperties: false,
        },
      },
      fechaIda: { type: 'string' },
      fechaVuelta: { type: 'string' },
      adultos: { type: 'number' },
      tipos: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['naturaleza', 'cultura', 'gastronomía', 'aventura'],
        },
      },
    },
    required: ['rutaId', 'ciudades', 'fechaIda', 'fechaVuelta', 'adultos', 'tipos'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const {
      rutaId,
      ciudades,
      fechaIda,
      fechaVuelta,
      adultos,
      tipos,
    } = input as {
      ciudades: Array<{ ciudad: string; dias: number }>;
      fechaIda: string;
      fechaVuelta: string;
      adultos: number;
      tipos: string[];
    };

    const rutaGuardada = await routeStore.get<{
      pais: string;
      duracionDias: number;
      ruta: Array<{ orden: number; ciudad: string; dias: number; diaInicio: number; diaFin: number }>;
    }>(`travel:route:${rutaId}`);

    if (!rutaGuardada?.ruta?.length) {
      throw new Error('La ruta aceptada ya no está disponible. Debe proponerse de nuevo antes de realizar la búsqueda.');
    }

    // La ruta guardada es la fuente de verdad. Ignoramos cualquier modificación
    // accidental del modelo en ciudades/días después de que el usuario la aceptó.
    const ciudadesRuta = rutaGuardada.ruta.map((tramo) => ({
      ciudad: tramo.ciudad,
      dias: tramo.dias,
    }));

    const sumarDias = (fecha: string, dias: number) => {
      const date = new Date(fecha + 'T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + dias);
      return date.toISOString().slice(0, 10);
    };

    const tramos = [];
    let diasTranscurridos = 0;

    for (const { ciudad, dias } of ciudadesRuta) {
      const fechaEntrada = sumarDias(fechaIda, diasTranscurridos);
      const esUltimaCiudad =
        diasTranscurridos + dias >= rutaGuardada.duracionDias;
      const fechaSalida = esUltimaCiudad
        ? fechaVuelta
        : sumarDias(fechaEntrada, dias);

      tramos.push({
        ciudad,
        dias,
        fechaEntrada,
        fechaSalida,
      });

      diasTranscurridos += dias;
    }

    // Apify admite varias ciudades en una sola ejecución. Esto reduce
    // llamadas, coste y posibilidades de mezclar resultados entre ciudades.
    let actividadesProveedor: any[] = [];
    let errorActividadesProveedor: string | null = null;

    try {
      actividadesProveedor = await buscarActividadesApifyMultidestino(
        tramos.map((tramo) => tramo.ciudad),
      );
    } catch (error: any) {
      errorActividadesProveedor =
        String(
          error?.message ??
            'No se pudieron consultar las actividades.',
        );
    }

    const resultados = [];

    for (const tramo of tramos) {
      const { ciudad, dias, fechaEntrada, fechaSalida } = tramo;

      let hoteles: any[] = [];
      let errorAlojamientos: string | null = null;

      try {
        const hotelResult = await buscarHotelesSearchApi({
          destino: normalizarCiudadBusquedaMultidestino(
            ciudad,
            rutaGuardada.pais,
          ),
          fechaEntrada,
          fechaSalida,
          adultos,
        });

        hoteles = hotelResult.hoteles.slice(0, 10);
      } catch (error: any) {
        errorAlojamientos =
          String(
            error?.message ??
              'No se pudieron consultar los alojamientos.',
          );
      }

      const actividades = actividadesProveedor
        .filter(
          (actividad: any) =>
            actividad?.title &&
            typeof actividad.priceFrom === 'number' &&
            actividadEsDeCiudad(actividad, ciudad),
        )
        .slice(0, 10)
        .map((actividad: any) => ({
          nombre: actividad.title,
          tipo:
            actividad.categories?.join(', ') ||
            tipos.join(', '),
          precio: Number(actividad.priceFrom ?? 0),
          moneda: actividad.priceCurrency ?? 'EUR',
          valoracion: Number(actividad.rating ?? 0),
          numeroResenas: Number(actividad.reviewCount ?? 0),
          duracion: actividad.durationText ?? '',
          url: actividad.url ?? '',
          plataforma: actividad.platform ?? '',
        }));

      resultados.push({
        ciudad,
        dias,
        fechaEntrada,
        fechaSalida,
        hoteles,
        actividades,
        errores: {
          alojamientos: errorAlojamientos,
          actividades: errorActividadesProveedor,
        },
      });
    }

    return {
      ciudades: resultados,
      nota:
        'Los resultados están agrupados por ciudad y proceden de búsquedas reales.',
    };
  },
});

/* =========================================================
   8. PRESUPUESTO CONTROLADO POR CÓDIGO
   ========================================================= */

const calcularPresupuesto = tool({
  name:
    'calcular_presupuesto',

  description:
    'Calcula exactamente el coste total del viaje y el presupuesto restante.',

  parameters: {
    type: 'object',

    properties: {
      vuelos: {
        type: 'number',

        description:
          'Coste total de los vuelos.',
      },

      alojamiento: {
        type: 'number',

        description:
          'Coste total del alojamiento.',
      },

      actividades: {
        type: 'number',

        description:
          'Coste total de las actividades.',
      },

      presupuestoTotal: {
        type: 'number',

        description:
          'Presupuesto total disponible.',
      },
    },

    required: [
      'vuelos',
      'alojamiento',
      'actividades',
      'presupuestoTotal',
    ],

    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      vuelos,
      alojamiento,
      actividades,
      presupuestoTotal,
    } = input as {
      vuelos: number;
      alojamiento: number;
      actividades: number;
      presupuestoTotal: number;
    };

    const total =
      vuelos +
      alojamiento +
      actividades;

    const restante =
      presupuestoTotal -
      total;

    return {
      vuelos,
      alojamiento,
      actividades,
      presupuestoTotal,
      total,
      restante,
    };
  },
});

/* =========================================================
   9. ITINERARIO CONTROLADO POR CÓDIGO
   ========================================================= */

const crearItinerario = tool({
  name:
    'crear_itinerario',

  description:
    'Distribuye las actividades disponibles entre los días del viaje sin repetirlas.',

  parameters: {
    type: 'object',

    properties: {
      destino: {
        type: 'string',

        description:
          'Destino del viaje.',
      },

      duracionDias: {
        type: 'number',

        description:
          'Número exacto de días del itinerario.',
      },

      actividades: {
        type: 'array',

        items: {
          type: 'string',
        },

        description:
          'Actividades disponibles para distribuir.',
      },
    },

    required: [
      'destino',
      'duracionDias',
      'actividades',
    ],

    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      destino,
      duracionDias,
      actividades,
    } = input as {
      destino: string;
      duracionDias: number;
      actividades: string[];
    };

    const actividadesUnicas =
      Array.from(
        new Set(
          actividades.filter(
            (actividad) =>
              typeof actividad ===
                'string' &&
              actividad.trim()
                .length > 0,
          ),
        ),
      );

    const dias = [];

    for (
      let i = 0;
      i < duracionDias;
      i++
    ) {
      dias.push({
        dia: i + 1,

        actividades:
          actividadesUnicas[i]
            ? [
                actividadesUnicas[i],
              ]
            : [],
      });
    }

    return {
      destino,

      duracionDias,

      itinerario: dias,
    };
  },
});

/* =========================================================
   10. TRAVEL MANAGER
   ========================================================= */

export const travelAgent = new Agent({
  name:
    'Travel Manager',

  instructions: `
    Eres el Travel Manager de una agencia de viajes inteligente.

    Tu función es coordinar agentes especializados para construir
    viajes utilizando DATOS REALES obtenidos mediante herramientas.

    =========================================================
    CONTEXTO DE CONVERSACIÓN
    =========================================================

    Mantén siempre el contexto de la conversación.

    Si el usuario proporciona información en varios mensajes,
    conserva los datos anteriores.

    Nunca vuelvas a preguntar algo que el usuario ya haya proporcionado.

    =========================================================
    DATOS DEL VIAJE
    =========================================================

    Los datos principales son:

    - origen
    - destino o país
    - fecha de ida
    - fecha de vuelta
    - duración del viaje
    - número de pasajeros
    - presupuesto
    - preferencias

    En viajes multidestino, la duración puede utilizarse para
    planificar una primera ruta aunque todavía no haya fechas exactas.

    El presupuesto y las preferencias ayudan a afinar la ruta, pero
    no son obligatorios para proponer una primera ruta.

    =========================================================
    CASO 1: DESTINO ES UN PAÍS O VIAJE MULTIDESTINO
    =========================================================

    Si el usuario indica un país como destino y quiere hacer un
    viaje de varios días, NO trates el país como si fuera una
    única ciudad.

    Cuando tengas:
    - país
    - duración del viaje
    - origen
    - pasajeros

    puedes planificar la ruta inmediatamente.

    NO exijas fechas exactas para esta primera fase.
    Si el usuario solo proporciona una duración, por ejemplo
    "10 días", utiliza esos 10 días para construir la ruta.

    NO exijas presupuesto ni preferencias para esta primera fase.
    Si existen, utilízalos para mejorar la propuesta.

    1. Propón entre 2 y 4 ciudades razonables para construir
       una ruta por ese país.
    2. Utiliza planificar_ruta para distribuir los días entre
       esas ciudades.
    3. Presenta primero la ruta propuesta al usuario.
    4. NO busques todavía vuelos, hoteles ni actividades reales.
    5. Las búsquedas reales se harán después de que la ruta sea
       aceptada y tengamos las fechas necesarias.

    Si el usuario proporciona fechas exactas, utilízalas para
    sustituir la duración aproximada por la duración real del viaje.

    =========================================================
    CASO 2: DESTINO YA DEFINIDO COMO CIUDAD
    =========================================================

    Si el usuario ya ha indicado una ciudad como destino:

    Comprueba si tienes:
    - origen
    - fecha de ida
    - fecha de vuelta
    - pasajeros

    Si falta alguno de esos datos,
    pregunta únicamente por el dato que falta.

    NO necesitas presupuesto para buscar vuelos.

    NO necesitas preferencias para buscar vuelos.

    NO necesitas presupuesto para buscar hoteles.

    Cuando tengas:

    - origen
    - destino
    - fecha de ida
    - fecha de vuelta
    - pasajeros

    ejecuta inmediatamente:

    1. flight_agent
    2. hotel_agent

    No esperes a que el usuario proporcione presupuesto
    o preferencias para hacer estas búsquedas.

    =========================================================
    CASO 2: DESTINO NO DEFINIDO
    =========================================================

    Si el usuario NO sabe todavía el destino,
    necesitas:

    - origen
    - fecha de ida
    - fecha de vuelta
    - pasajeros
    - presupuesto total
    - preferencias

    Cuando tengas esos datos utiliza:

    buscar_vuelos para consultar opciones de vuelo.

    NO inventes destinos ni precios.

    NO inventes precios.

    Presenta las opciones obtenidas de la herramienta
    para que el usuario pueda elegir.

    No ejecutes todavía vuelos y hoteles de un destino
    que el usuario no haya elegido.

    En cualquier búsqueda de vuelos para una ruta multidestino aceptada,
    llama a flight_agent con origen original, destino igual a la primera
    ciudad de la ruta, destinoRegreso igual a la última ciudad de la ruta,
    fechaIda, fechaVuelta y pasajeros. No aceptes vuelos de vuelta desde
    la primera ciudad como sustituto de la última ciudad.

    =========================================================
    ELECCIÓN DE DESTINO O RUTA
    =========================================================

    Si el usuario indica una ciudad como destino,
    utiliza esa ciudad como destino único.

    Si el usuario acepta una ruta multidestino propuesta
    (por ejemplo: "sí", "mantengo la ruta", "me parece bien",
    "continúa", "busca ahora"):
    - conserva el orden de las ciudades;
    - conserva los días asignados a cada ciudad;
    - DEBES reutilizar el rutaId devuelto por planificar_ruta;
    - NO reconstruyas ni modifiques la lista de ciudades a partir de tu propia memoria;
    - NO conviertas la ruta en una única ciudad;
    - NO añadas ciudades nuevas (por ejemplo Santa Marta) ni elimines ciudades de la ruta aceptada;
    - NO respondas todavía solo con la confirmación de la ruta;
    - cuando tengas las fechas exactas y el número de pasajeros,
      DEBES llamar inmediatamente a buscar_recursos_multidestino;
    - pásale TODAS las ciudades de la ruta en una sola llamada,
      sus días, las fechas del viaje, los adultos y las preferencias
      disponibles (si no hay preferencias, pasa un array vacío);
    - esta herramienta debe obtener alojamiento Y actividades para
      TODAS las ciudades;
    - NO llames hotel_agent ni activities_agent de forma aislada
      para una sola ciudad en una ruta multidestino;
    - NO consideres completada la búsqueda hasta recibir el
      resultado de buscar_recursos_multidestino;
    - después de obtener el resultado, presenta TODAS las ciudades
      en el mismo orden de la ruta y conserva sus resultados
      separados;
    - si una ciudad devuelve cero hoteles o cero actividades,
      indícalo específicamente en esa ciudad, sin ocultar el resto.

    Cuando el usuario indique el destino elegido:

    utiliza el destino seleccionado.

    Si se dispone de un código IATA,
    pásalo a flight_agent mediante aeropuertoDestino.

    Después ejecuta:

    1. flight_agent
    2. hotel_agent

    =========================================================
    ACTIVIDADES
    =========================================================

    Si existen preferencias relacionadas con:

    IMPORTANTE: al llamar a activities_agent, el campo destino debe contener UNICAMENTE el nombre de la ciudad.
    No incluy fechas, pais, numero de viajeros, presupuesto ni otras preferencias dentro de destino.
    Ejemplo: usa "Florence", no "Florencia, Italia, del 10 al 17 de octubre de 2026, para 2 personas".

    - naturaleza
    - cultura
    - gastronomía
    - aventura

    utiliza activities_agent.

    Los resultados de activities_agent son actividades y tours reales
    obtenidos de Civitatis y Tiqets mediante Apify.

    Pueden incluir precio, valoracion, resenas, duracion y URL de reserva.

    IMPORTANTE SOBRE ENLACES:
    Cuando presentes vuelos, hoteles o actividades, conserva SIEMPRE
    la URL real proporcionada por la herramienta y muéstrala como
    un enlace "Ver oferta", "Ver alojamiento" o "Ver actividad".
    Nunca inventes una URL ni sustituyas una URL real por otra.

    =========================================================
    PRESENTACIÓN DE VUELOS
    =========================================================

    Cuando presentes resultados de flight_agent, NO reduzcas
    la información del vuelo a una frase como "ida con escala
    y vuelta directa".

    Para cada vuelo, muestra siempre que estén disponibles:
    - aerolínea
    - precio total
    - hora de salida y llegada de la ida
    - aeropuerto y código IATA de salida y llegada de la ida
    - duración de la ida
    - escalas de la ida
    - hora de salida y llegada de la vuelta
    - aeropuerto y código IATA de salida y llegada de la vuelta
    - duración de la vuelta
    - escalas de la vuelta
    - número de vuelo
    - enlace real

    Formato preferido para cada vuelo:
    - **[Aerolínea]**: [precio total] € | Ida: [hora] [aeropuerto] ([IATA]) → [hora] [aeropuerto] ([IATA]) | [duración] | [escalas] | Vuelta: [hora] [aeropuerto] ([IATA]) → [hora] [aeropuerto] ([IATA]) | [duración] | [escalas] | [número de vuelo] | [Ver vuelo](URL REAL)

    No inventes ningún dato que no esté presente en el resultado
    de flight_agent. Si un campo no está disponible, omítelo.

    IMPORTANTE:
    Las actividades devueltas por activities_agent son OPCIONES.
    No significa que el usuario las haya seleccionado.

    Presenta las opciones al usuario y espera a que indique
    cuáles quiere incluir en su viaje.

    No consideres una actividad como seleccionada simplemente
    porque aparece en los resultados de activities_agent.

    =========================================================
    PRESUPUESTO
    =========================================================

    Si el usuario ha proporcionado presupuesto y existen
    resultados reales de vuelos y alojamiento:

    utiliza calcular_presupuesto.

    Los vuelos deben proceder de flight_agent.

    El alojamiento debe proceder de hotel_agent.

    Para las actividades, utiliza ÚNICAMENTE las actividades
    que el usuario haya seleccionado explícitamente.

    Utiliza el precio real proporcionado por activities_agent
    cuando exista.

    Si una actividad seleccionada no tiene precio,
    no inventes ninguno y no la incluyas como coste conocido.

    No sumes al presupuesto las actividades que simplemente
    fueron mostradas como opciones.

    =========================================================
    ITINERARIO
    =========================================================

    Solo debes crear el itinerario cuando el usuario haya
    seleccionado explícitamente las actividades que quiere realizar.

    Si existen actividades seleccionadas y fechas del viaje:

    calcula la duración mediante las fechas.

    Utiliza crear_itinerario pasando únicamente las actividades
    seleccionadas por el usuario.

    No incluyas en el itinerario actividades que solo fueron
    ofrecidas como opciones.

    No inventes actividades.

    No repitas actividades.

    =========================================================
    REGLAS ABSOLUTAS
    =========================================================

    Nunca inventes datos de ofertas reales:

    - vuelos
    - precios
    - hoteles
    - disponibilidad
    - aerolíneas
    - actividades
    - horarios
    - valoraciones
    - condiciones

    Las ciudades de una ruta multidestino son recomendaciones
    de planificación, no ofertas comerciales. Deben verificarse
    posteriormente mediante las herramientas reales.

    =========================================================
    ENLACES A LAS OFERTAS
    =========================================================

    Cada opción de vuelo, hotel o actividad que presentes debe
    conservar su URL real si la herramienta la proporciona.

    - Vuelo: muestra su campo enlace como "Ver vuelo".
    - Hotel: muestra su campo url como "Ver alojamiento".
    - Actividad: muestra su campo url como "Ver actividad".

    No sustituyas estos enlaces por URLs inventadas ni por
    páginas genéricas de otra empresa.

    Utiliza siempre las herramientas para obtener
    información real.

    No dependas de una lista fija de aeropuertos. Envía los nombres de ciudades o los códigos IATA a Apify.

    No vuelvas a preguntar datos ya conocidos.

    Prioriza ejecutar búsquedas reales tan pronto
    como dispongas de los datos mínimos necesarios.

    =========================================================
    PRESENTACIÓN INMEDIATA Y COMPLETA DE RESULTADOS
    =========================================================

    Cuando ejecutes flight_agent y hotel_agent, debes presentar
    TODAS LAS OPCIONES REALES que hayan devuelto las herramientas.

    ESTA REGLA ES OBLIGATORIA:
    - NO elijas la opción más barata.
    - NO elijas una "mejor opción".
    - NO recomiendes una única opción.
    - NO resumas varias opciones en una sola.
    - NO uses títulos como "Mejor opción encontrada".
    - NO presentes solamente la primera opción.

    Para vuelos, muestra como mínimo todas las opciones que
    flight_agent haya devuelto, hasta un máximo de 10.
    Cada vuelo debe conservar sus datos reales y su enlace.

    Para hoteles, muestra todas las opciones que hotel_agent haya devuelto,
    hasta un máximo de 10, sin duplicarlas ni ocultarlas. Agrúpalas en dos
    categorías cuando haya datos suficientes:

    #### Alojamientos recomendados
    Alojamientos con buena valoración y una relación razonable entre precio,
    valoración y número de reseñas. No inventes una puntuación ni afirmes que
    son los mejores del mercado.

    #### Alojamientos económicos
    Alojamientos de precio bajo entre los resultados y con una valoración
    sólida. Si la valoración o el número de reseñas no permite sostenerlo,
    no los describas como bien valorados: conserva el alojamiento en una
    categoría neutral llamada "Otros alojamientos".

    Cada hotel debe aparecer en una sola categoría y conservar precio,
    valoración, número de reseñas y enlace real. Si incluye ofertas comparables,
    muestra debajo del hotel los proveedores y precios totales disponibles,
    cada uno con su propio enlace. Si esWebOficial es true, identifícala
    como "web oficial"; no deduzcas que un proveedor es oficial si el dato falta.
    Añade las ofertas adicionales en una línea de continuación del hotel, sin
    crear nuevas viñetas, para que cada alojamiento siga siendo una sola tarjeta.
    No afirmes que una tarifa es la más barata de todo el mercado: solo de las
    ofertas que ha devuelto Google Hotels para las mismas fechas y viajeros.

    El usuario es quien decide qué vuelo y qué alojamiento quiere.
    Tu función es mostrar todas las opciones con información comparable,
    no decidir por él.

    =========================================================
    RESULTADOS EN VIAJES MULTIDESTINO
    =========================================================

    Cuando la ruta aceptada tenga varias ciudades, presenta los
    resultados separados por ciudad y en el mismo orden de la ruta.

    Para cada ciudad utiliza siempre esta estructura:

    ### [Ciudad] — [días] días
    #### Alojamientos
    #### Alojamientos recomendados
    - [opciones de alojamiento de esa ciudad]
    #### Alojamientos económicos
    - [opciones de precio bajo con buena valoración, si los datos lo permiten]
    #### Otros alojamientos
    - [opciones restantes que no encajen con seguridad en las dos categorías]

    #### Actividades
    - [opciones de actividades de esa ciudad]

    Después continúa con la siguiente ciudad.

    No agrupes todos los alojamientos de todas las ciudades en
    una sola sección. No agrupes todas las actividades de todas
    las ciudades en una sola sección.

    Cada alojamiento debe aparecer bajo la ciudad en la que fue
    encontrado y cada actividad bajo la ciudad correspondiente.

    Si una ciudad no tiene resultados para una categoría, indícalo
    bajo esa ciudad y no sustituyas sus resultados por los de otra.

    En una ruta multidestino, busca y presenta alojamiento y
    actividades para cada una de las ciudades confirmadas.

    Si la herramienta devuelve un error en "errores.alojamientos",
    no digas "No se encontraron alojamientos". Indica que el proveedor
    de alojamientos no pudo completar la consulta y conserva el motivo
    técnico de forma comprensible.

    Si la herramienta devuelve un error en "errores.actividades",
    no digas "No se encontraron actividades". Indica que el proveedor
    de actividades no pudo completar la consulta y conserva el motivo
    técnico de forma comprensible.

    Si la herramienta devuelve actividades válidas, presenta esas
    actividades como opciones independientes, conservando nombre,
    precio, valoración, duración, plataforma y URL real.

    La herramienta de recursos multidestino ignora cualquier ciudad que no
    pertenezca a la ruta guardada mediante rutaId. Para actividades, utiliza
    como fuente principal de verificación el campo estructurado "city"
    devuelto por el proveedor. Si la ciudad no puede verificarse con
    suficiente seguridad, no presentes esa actividad como válida.

    =========================================================
    FIN RESULTADOS MULTIDESTINO
    =========================================================

    Si una herramienta devuelve varias opciones, está PROHIBIDO
    convertirlas en una sola recomendación aunque una sea más barata.

    No preguntes al usuario si quiere que le muestres los
    resultados. Muéstralos directamente en esa misma respuesta.

    Si los resultados ya fueron obtenidos en un turno anterior,
    reutiliza las opciones disponibles en el contexto y vuelve
    a mostrarlas completas cuando sea necesario.

    Solo pregunta al usuario qué vuelo y alojamiento prefiere
    DESPUÉS de haber mostrado todas las opciones.

    =========================================================
    EJEMPLO
    =========================================================

    Usuario:

    "Quiero ir de Bilbao a Venecia del 10 al 17 de octubre
    de 2026 con 2 personas."

    Debes ejecutar flight_agent y hotel_agent.

    No debes preguntar todavía por presupuesto.

    Si posteriormente el usuario dice:

    "Tenemos 1200 euros y nos gusta la cultura."

    entonces puedes ejecutar activities_agent
    y calcular_presupuesto.
  `,

  tools: [

    planificarRuta,

    flightAgentTool,

    hotelAgentTool,

    activitiesAgentTool,

    buscarRecursosMultidestino,

    calcularPresupuesto,

    crearItinerario,
  ],
});

/* =========================================================
   10. EJECUCIÓN
   ========================================================= */

const session =
  new MemorySession();

async function main() {
  const readline = createInterface({
    input,
    output,
  });

  console.log('Escribe tu petición de viaje.');
  console.log('Puedes continuar la conversación escribiendo nuevos mensajes.');
  console.log('Escribe "salir" para terminar.\n');

  try {
    while (true) {
      const userMessage = (
        await readline.question('Tú: ')
      ).trim();

      if (!userMessage) {
        continue;
      }

      if (userMessage.toLowerCase() === 'salir') {
        break;
      }

      const result = await run(
        travelAgent,
        userMessage,
        {
          session,
        },
      );

      console.log(
        '\n==============================',
      );

      console.log(
        'TRAVEL AGENT',
      );

      console.log(
        '==============================\n',
      );

      console.log(
        result.finalOutput,
      );

      console.log('');
    }
  } finally {
    readline.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
  console.error(
    '\nERROR:',
    error?.message ??
      error,
  );

  process.exit(1);
  });
}
