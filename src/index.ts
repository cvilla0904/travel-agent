import { fileURLToPath } from "node:url";
import { Agent, MemorySession, run, tool } from '@openai/agents';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
import { buscarLugaresGeoapify } from './services/geoapify.js';
import { buscarActividadesApify } from './services/apify.js';
import {
  buscarGoogleFlights,
  buscarGoogleTravelExplore,
  resolverAeropuerto,
} from './services/serpapi.js';
import { buscarHotelesSearchApi } from './services/searchapi.js';

/* =========================================================
   1. FUNCIONES AUXILIARES
   ========================================================= */

/**
 * Resuelve una ciudad o aeropuerto introducido por el usuario
 * utilizando SerpApi Google Flights Autocomplete.
 *
 * Devuelve los códigos IATA encontrados para la primera
 * sugerencia relevante.
 */
async function resolverIdsAeropuerto(
  texto: string,
): Promise<string[]> {
  const consultaOriginal = texto.trim();

  if (!consultaOriginal) {
    throw new Error('El origen o destino del vuelo está vacío.');
  }

  // Si el usuario ya proporciona un código IATA, no necesitamos
  // depender del autocompletado de SerpApi.
  if (/^[A-Za-z]{3}$/.test(consultaOriginal)) {
    return [consultaOriginal.toUpperCase()];
  }

  const sugerencias = await resolverAeropuerto(consultaOriginal);

  if (!Array.isArray(sugerencias) || sugerencias.length === 0) {
    throw new Error(
      `No se ha encontrado ningún aeropuerto para "${consultaOriginal}".`,
    );
  }

  const normalizar = (valor: string) =>
    valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

  const consultaNormalizada = normalizar(consultaOriginal);

  // Nunca usamos "la primera sugerencia" como fallback.
  // Eso fue lo que permitía que una respuesta incorrecta del
  // autocompletado pudiera convertir Bilbao en otra ciudad.
  const candidatos = sugerencias.filter(
    (sugerencia: any) =>
      Array.isArray(sugerencia?.airports) &&
      sugerencia.airports.length > 0,
  );

  const sugerenciaExacta = candidatos.find(
    (sugerencia: any) => {
      const nombre = normalizar(sugerencia.name ?? '');
      const descripcion = normalizar(sugerencia.description ?? '');

      return (
        nombre === consultaNormalizada ||
        nombre.startsWith(consultaNormalizada + ',') ||
        descripcion === consultaNormalizada ||
        descripcion.startsWith(consultaNormalizada + ',') ||
        sugerencia.airports.some(
          (airport: any) =>
            normalizar(airport?.city ?? '') === consultaNormalizada ||
            normalizar(airport?.name ?? '') === consultaNormalizada,
        )
      );
    },
  );

  if (!sugerenciaExacta) {
    throw new Error(
      `No se ha podido verificar "${consultaOriginal}" como ciudad o aeropuerto. No se realizará una búsqueda para evitar resultados de otra ciudad.`,
    );
  }

  const ids = sugerenciaExacta.airports
    .map((airport: any) => airport?.id)
    .filter(
      (id: any): id is string =>
        typeof id === 'string' &&
        /^[A-Za-z]{3}$/.test(id.trim()),
    )
    .map((id: string) => id.trim().toUpperCase());

  if (ids.length === 0) {
    throw new Error(
      `No se han encontrado códigos IATA válidos para "${consultaOriginal}".`,
    );
  }

  return Array.from(new Set(ids));
}

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

/* =========================================================
   2. TOOL: DESCUBRIMIENTO DE DESTINOS
   ========================================================= */

const buscarDestinos = tool({
  name: 'buscar_destinos',

  description:
    'Descubre destinos reales desde el origen indicado utilizando Google Travel Explore mediante SerpApi. Los precios devueltos son datos reales de búsqueda y no precios inventados.',

  parameters: {
    type: 'object',

    properties: {
      origen: {
        type: 'string',
        description: 'Ciudad o aeropuerto de origen.',
      },

      fechaIda: {
        type: 'string',
        description:
          'Fecha de ida en formato YYYY-MM-DD.',
      },

      fechaVuelta: {
        type: 'string',
        description:
          'Fecha de vuelta en formato YYYY-MM-DD.',
      },

      pasajeros: {
        type: 'number',
        description:
          'Número de pasajeros adultos.',
      },

      presupuestoTotal: {
        type: 'number',
        description:
          'Presupuesto total disponible para todo el viaje.',
      },

      preferencias: {
        type: 'array',

        items: {
          type: 'string',
        },

        description:
          'Preferencias del viaje.',
      },
    },

    required: [
      'origen',
      'fechaIda',
      'fechaVuelta',
      'pasajeros',
      'presupuestoTotal',
      'preferencias',
    ],

    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      origen,
      fechaIda,
      fechaVuelta,
      pasajeros,
      presupuestoTotal,
      preferencias,
    } = input as {
      origen: string;
      fechaIda: string;
      fechaVuelta: string;
      pasajeros: number;
      presupuestoTotal: number;
      preferencias: string[];
    };

    const departureIds =
      await resolverIdsAeropuerto(origen);

    const departureId =
      departureIds.join(',');

    const data =
      await buscarGoogleTravelExplore({
        departureId,
        outboundDate: fechaIda,
        returnDate: fechaVuelta,
      });

    const destinos =
      (data.destinations ?? [])
        .filter(
          (destino: any) =>
            destino?.name &&
            destino?.destination_airport?.code &&
            Number.isFinite(
              Number(destino?.flight_price),
            ),
        )

        .map((destino: any) => {
          const precioVueloPorPersona =
            Number(destino.flight_price);

          const precioVueloTotal =
            Math.round(
              precioVueloPorPersona *
                pasajeros,
            );

          const precioHotel =
            Number.isFinite(
              Number(destino.hotel_price),
            )
              ? Number(destino.hotel_price)
              : null;

          return {
            destino: destino.name,

            pais:
              destino.country ?? '',

            aeropuerto:
              destino.destination_airport.code,

            precioVueloPorPersona,

            precioVueloTotal,

            precioHotelReferencia:
              precioHotel,

            escalas:
              Number(
                destino.number_of_stops ?? 0,
              ),

            duracionVueloMinutos:
              Number(
                destino.flight_duration ?? 0,
              ),

            fechaIda:
              destino.start_date ??
              fechaIda,

            fechaVuelta:
              destino.end_date ??
              fechaVuelta,

            enlace:
              destino.link ?? '',
          };
        })

        .filter(
          (destino: any) =>
            destino.precioVueloTotal <=
            presupuestoTotal,
        )

        .sort(
          (a: any, b: any) =>
            a.precioVueloTotal -
            b.precioVueloTotal,
        )

        .slice(0, 10);

    return {
      origen,
      fechaIda,
      fechaVuelta,
      pasajeros,
      presupuestoTotal,
      preferencias,
      destinos,

      nota:
        'Los precios de vuelo proceden de Google Travel Explore mediante SerpApi. La relevancia respecto a las preferencias se verificará posteriormente mediante los datos reales del destino.',
    };
  },
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

    return {
      pais,
      duracionDias: diasTotales,
      ciudades: ruta.length,
      ruta,
      nota:
        'Esta herramienta organiza la distribución temporal de la ruta. Las ciudades son recomendaciones de planificación y deberán verificarse después con búsquedas reales de vuelos, alojamiento y actividades.',
    };
  },
});

/* =========================================================
   3. TOOL + AGENT: VUELOS
   ========================================================= */

const buscarVuelos = tool({
  name: 'buscar_vuelos',

  description:
    'Busca vuelos reales de ida y vuelta utilizando Google Flights mediante SerpApi. Resuelve automáticamente cualquier ciudad o aeropuerto introducido por el usuario y devuelve horarios reales de ida y vuelta.',

  parameters: {
    type: 'object',

    properties: {
      origen: {
        type: 'string',
        description:
          'Ciudad o aeropuerto de origen.',
      },

      destino: {
        type: 'string',
        description:
          'Ciudad o aeropuerto de destino.',
      },

      fechaIda: {
        type: 'string',
        description:
          'Fecha de ida en formato YYYY-MM-DD.',
      },

      fechaVuelta: {
        type: 'string',
        description:
          'Fecha de vuelta en formato YYYY-MM-DD.',
      },

      pasajeros: {
        type: 'number',
        description:
          'Número de pasajeros adultos.',
      },

      aeropuertoDestino: {
        type: 'string',
        description:
          'Código IATA del aeropuerto de destino cuando ya haya sido identificado. Puede contener varios códigos separados por comas.',
      },
    },

    required: [
      'origen',
      'destino',
      'fechaIda',
      'fechaVuelta',
      'pasajeros',
    ],

    additionalProperties: false,
  },

  execute: async (input) => {
    const {
      origen,
      destino,
      fechaIda,
      fechaVuelta,
      pasajeros,
      aeropuertoDestino,
    } = input as {
      origen: string;
      destino: string;
      fechaIda: string;
      fechaVuelta: string;
      pasajeros: number;
      aeropuertoDestino?: string;
    };

    const departureIds =
      await resolverIdsAeropuerto(origen);

    const departureId =
      departureIds.join(',');

    let arrivalId =
      aeropuertoDestino?.trim().toUpperCase();

    if (!arrivalId) {
      const arrivalIds =
        await resolverIdsAeropuerto(destino);

      arrivalId =
        arrivalIds.join(',');
    }

    /*
     * PRIMERA CONSULTA
     *
     * Google Flights devuelve las opciones
     * de ida y un departure_token para obtener
     * las opciones reales de vuelta.
     */

    let data =
      await buscarGoogleFlights({
        departureId,
        arrivalId,
        outboundDate: fechaIda,
        returnDate: fechaVuelta,
        adults: pasajeros,
        deepSearch: true,
      });

    let resultadosIniciales = [
      ...(data.best_flights ?? []),
      ...(data.other_flights ?? []),
    ];

    /*
     * Si Google Flights no devuelve resultados en la primera consulta,
     * repetimos con una búsqueda profunda. SerpApi indica que
     * deep_search puede producir resultados más completos.
     */
    if (resultadosIniciales.length === 0) {
      data = await buscarGoogleFlights({
        departureId,
        arrivalId,
        outboundDate: fechaIda,
        returnDate: fechaVuelta,
        adults: pasajeros,
        deepSearch: true,
      });

      resultadosIniciales = [
        ...(data.best_flights ?? []),
        ...(data.other_flights ?? []),
      ];
    }

    resultadosIniciales = resultadosIniciales
      .filter(
        (vuelo: any) =>
          typeof vuelo.price === 'number' &&
          vuelo.price > 0,
      )
      .sort(
        (a: any, b: any) =>
          Number(a.price) -
          Number(b.price),
      )
      .slice(0, 10);

    /*
     * Obtiene la información de ida de un vuelo.
     */

    function extraerSegmentos(
      segmentos: any[],
    ) {
      return (segmentos ?? []).map(
        (segmento: any) => ({
          aeropuertoSalida:
            segmento.departure_airport?.name ??
            '',

          codigoSalida:
            segmento.departure_airport?.id ??
            '',

          horaSalida:
            segmento.departure_airport?.time ??
            '',

          aeropuertoLlegada:
            segmento.arrival_airport?.name ??
            '',

          codigoLlegada:
            segmento.arrival_airport?.id ??
            '',

          horaLlegada:
            segmento.arrival_airport?.time ??
            '',

          duracionMinutos:
            Number(segmento.duration ?? 0),

          aerolinea:
            segmento.airline ?? '',

          numeroVuelo:
            segmento.flight_number ?? '',
        }),
      );
    }

    /*
     * SEGUNDA CONSULTA
     *
     * Para cada vuelo de ida obtenemos
     * las opciones reales de vuelta.
     */

    const vuelosCompletos =
      await Promise.all(
        resultadosIniciales.map(
          async (vuelo: any) => {
            let vueltaData: any = null;

            if (typeof vuelo.departure_token === 'string') {
              try {
                vueltaData =
                  await buscarGoogleFlights({
                    departureId,
                    arrivalId,
                    outboundDate: fechaIda,
                    returnDate: fechaVuelta,
                    adults: pasajeros,
                    departureToken:
                      vuelo.departure_token,
                  });
              } catch {
                vueltaData = null;
              }
            }

            const opcionesVuelta = [
              ...(vueltaData?.best_flights ?? []),
              ...(vueltaData?.other_flights ?? []),
            ]
              .filter(
                (opcion: any) =>
                  Array.isArray(
                    opcion.flights,
                  ) &&
                  opcion.flights.length > 0,
              )
              .sort(
                (a: any, b: any) =>
                  Number(a.price ?? 0) -
                  Number(b.price ?? 0),
              );

            /*
             * Elegimos la primera opción de vuelta
             * devuelta por Google Flights.
             */

            const vuelta =
              opcionesVuelta[0] ?? null;

            const idaSegmentos =
              extraerSegmentos(
                vuelo.flights ?? [],
              );

            const vueltaSegmentos =
              extraerSegmentos(
                vuelta?.flights ?? [],
              );

            const aerolineas = [
              ...new Set(
                [
                  ...idaSegmentos,
                  ...vueltaSegmentos,
                ]
                  .map(
                    (segmento) =>
                      segmento.aerolinea,
                  )
                  .filter(Boolean),
              ),
            ];

            const departureAirportIds = new Set(
              departureId
                .split(',')
                .map((id) => id.trim().toUpperCase())
                .filter(Boolean),
            );

            const arrivalAirportIds = new Set(
              arrivalId
                .split(',')
                .map((id) => id.trim().toUpperCase())
                .filter(Boolean),
            );

            const idaValida =
              idaSegmentos.length > 0 &&
              departureAirportIds.has(
                idaSegmentos[0].codigoSalida.toUpperCase(),
              ) &&
              arrivalAirportIds.has(
                idaSegmentos[idaSegmentos.length - 1].codigoLlegada.toUpperCase(),
              );

            const vueltaValida =
              vueltaSegmentos.length === 0 ||
              (
                departureAirportIds.has(
                  vueltaSegmentos[vueltaSegmentos.length - 1].codigoLlegada.toUpperCase(),
                ) &&
                arrivalAirportIds.has(
                  vueltaSegmentos[0].codigoSalida.toUpperCase(),
                )
              );

            if (!idaValida || !vueltaValida) {
              return null;
            }

            const escalasIda =
              Math.max(
                0,
                idaSegmentos.length - 1,
              );

            const escalasVuelta =
              Math.max(
                0,
                vueltaSegmentos.length - 1,
              );

            /*
             * El precio de la combinación
             * completa procede del resultado
             * seleccionado por Google Flights.
             *
             * Si no tenemos precio de vuelta,
             * conservamos el precio inicial.
             */

            const precioTotal =
              Number(vuelo.price);

            const enlace =
              data?.search_metadata?.google_flights_url ??
              vueltaData?.search_metadata?.google_flights_url ??
              '';

            return {
              aerolinea:
                aerolineas.join(' + '),

              precioPorPersona:
                Math.round(
                  precioTotal /
                    pasajeros,
                ),

              precioTotal,

              moneda: 'EUR',

              enlace,

              esIdaVuelta: true,

              tipo:
                'Ida y vuelta',

              escalasIda,

              escalasVuelta,

              esDirecto:
                escalasIda === 0 &&
                escalasVuelta === 0,

              ida: {
                fecha:
                  fechaIda,

                segmentos:
                  idaSegmentos,

                duracionMinutos:
                  Number(
                    vuelo.total_duration ??
                      idaSegmentos.reduce(
                        (
                          total,
                          segmento,
                        ) =>
                          total +
                          segmento.duracionMinutos,
                        0,
                      ),
                  ),
              },

              vuelta: {
                fecha:
                  fechaVuelta,

                segmentos:
                  vueltaSegmentos,

                duracionMinutos:
                  Number(
                    vuelta?.total_duration ??
                      vueltaSegmentos.reduce(
                        (
                          total,
                          segmento,
                        ) =>
                          total +
                          segmento.duracionMinutos,
                        0,
                      ),
                  ),
              },
            };
          },
        ),
      );

    const vuelos =
      vuelosCompletos
        .filter(
          (vuelo) =>
            vuelo !== null &&
            vuelo.precioTotal > 0,
        )
        .sort(
          (a, b) =>
            a.precioTotal -
            b.precioTotal,
        )
        .slice(0, 10);

    return {
      origen,

      destino,

      aeropuertoDestino:
        arrivalId,

      aeropuertoOrigen:
        departureId,

      fechaIda,

      fechaVuelta,

      pasajeros,

      vuelos,
    };
  },
});

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

    La herramienta resuelve automáticamente los aeropuertos.
    No necesitas ningún mapa interno de ciudades o aeropuertos.

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
  description: 'Busca alojamientos reales utilizando SearchAPI sobre Booking.com.',
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
  })),
});

const hotelAgent = new Agent({
  name: 'Hotel Agent',
  outputType: hotelOutputSchema,
  instructions: `
    Eres un agente especializado exclusivamente en alojamiento.

    Utiliza SIEMPRE la herramienta buscar_hoteles.

    La herramienta obtiene alojamientos reales mediante SearchAPI sobre Booking.com.

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
    No reduzcas las opciones a una única opción.
    Los enlaces proceden de Booking.com.
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

    const resultados = await buscarActividadesApify({
      destino,
    });

    return {
      destino,

      actividades: resultados
        .filter(
          (actividad: any) =>
            actividad.title &&
            typeof actividad.priceFrom === 'number',
        )
        .slice(0, 15)
        .map((actividad: any) => ({
          nombre:
            actividad.title,

          tipo:
            actividad.categories?.join(', ') ||
            tipos.join(', '),

          precio:
            Number(actividad.priceFrom ?? 0),

          moneda:
            actividad.priceCurrency ?? 'EUR',

          valoracion:
            Number(actividad.rating ?? 0),

          numeroResenas:
            Number(actividad.reviewCount ?? 0),

          duracion:
            actividad.durationText ?? '',

          cancelacionGratuita:
            actividad.freeCancellation ?? false,

          direccion:
            '',

          latitud:
            0,

          longitud:
            0,

          url:
            actividad.url ?? '',

          plataforma:
            actividad.platform ?? '',
        })),
    };
  },
});

const activitiesOutputSchema =
  z.object({
    destino: z.string(),

    actividades:
      z.array(
        z.object({
          nombre:
            z.string(),

          tipo:
            z.string(),

          precio:
            z.number(),

          moneda:
            z.string(),

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

/* =========================================================
   7. TOOL: RECURSOS PARA RUTA MULTIDESTINO
   ========================================================= */

const buscarRecursosMultidestino = tool({
  name: 'buscar_recursos_multidestino',
  description:
    'Busca alojamiento y actividades reales para cada ciudad de una ruta multidestino, manteniendo los resultados separados por ciudad.',
  parameters: {
    type: 'object',
    properties: {
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
    required: ['ciudades', 'fechaIda', 'fechaVuelta', 'adultos', 'tipos'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const {
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

    const resultados = await Promise.all(
      ciudades.map(async ({ ciudad, dias }) => {
        const [hoteles, actividades] = await Promise.all([
          buscarHotelesSearchApi({
            destino: ciudad,
            fechaEntrada: fechaIda,
            fechaSalida: fechaVuelta,
            adultos,
          }),
          buscarActividadesApify({ destino: ciudad }),
        ]);

        return {
          ciudad,
          dias,
          hoteles: hoteles.slice(0, 10),
          actividades: actividades
            .filter(
              (actividad: any) =>
                actividad.title &&
                typeof actividad.priceFrom === 'number',
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
            })),
        };
      }),
    );

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

    buscar_destinos

    para descubrir destinos reales.

    NO inventes destinos.

    NO inventes precios.

    Presenta las opciones obtenidas de la herramienta
    para que el usuario pueda elegir.

    No ejecutes todavía vuelos y hoteles de un destino
    que el usuario no haya elegido.

    =========================================================
    ELECCIÓN DE DESTINO O RUTA
    =========================================================

    Si el usuario elige una ciudad de una búsqueda de destinos,
    utiliza esa ciudad como destino único.

    Si el usuario acepta una ruta multidestino propuesta:
    - conserva el orden de las ciudades;
    - conserva los días asignados a cada ciudad;
    - NO conviertas la ruta en una única ciudad;
    - cuando tengas las fechas exactas y el número de pasajeros,
      utiliza OBLIGATORIAMENTE buscar_recursos_multidestino para
      obtener alojamiento y actividades de TODAS las ciudades
      de la ruta en una sola búsqueda coordinada;
    - no llames solo a hotel_agent o activities_agent para una
      única ciudad cuando la ruta tenga varias ciudades;
    - presenta los resultados agrupados por ciudad, respetando
      exactamente el orden de la ruta.

    Cuando el usuario elija uno de los destinos descubiertos:

    utiliza el destino seleccionado.

    Si buscar_destinos proporciona un código IATA,
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

    No dependas de una lista fija de aeropuertos.
    Los aeropuertos deben resolverse dinámicamente
    mediante SerpApi.

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

    Para hoteles, muestra como mínimo todas las opciones que
    hotel_agent haya devuelto, hasta un máximo de 10.
    Cada hotel debe conservar sus datos reales y su enlace.

    El usuario es quien decide qué vuelo y qué alojamiento quiere.
    Tu función es MOSTRAR LAS OPCIONES, no tomar esa decisión.

    Cuando haya varias opciones, enuméralas claramente como
    opciones independientes.

    =========================================================
    RESULTADOS EN VIAJES MULTIDESTINO
    =========================================================

    Cuando la ruta aceptada tenga varias ciudades, presenta los
    resultados separados por ciudad y en el mismo orden de la ruta.

    Para cada ciudad utiliza siempre esta estructura:

    ### [Ciudad] — [días] días
    #### Alojamientos
    - [opciones de alojamiento de esa ciudad]

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
    buscarDestinos,

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
