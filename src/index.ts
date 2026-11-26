import { fileURLToPath } from "node:url";
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { Agent, MemorySession, run, tool } from '@openai/agents';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
import { buscarLugaresGeoapify } from './services/geoapify.js';
import { buscarActividadesApifyMultidestinoDetallado, etiquetaPlataformas } from './services/apify.js';
import { plataformaPermitida } from './services/plataformas-actividades.js';
import { bloqueActividadesMultidestino, registrarBloque } from './services/resultados-estructurados.js';
import { buscarActividadesDestino } from './services/actividades-busqueda.js';
import { buscarVuelosConEstado } from './services/vuelos.js';
import { filtrarActividadesDeCiudad, actividadParaMultidestino } from './services/actividades-ciudad.js';
import { parsearPrecio, extraerPrecio, esGratisVerificado } from './services/precios-actividades.js';
import { buscarHotelesConEstado } from './services/hoteles.js';
import { buscarHotelesTramo } from './services/hoteles-multidestino.js';
import { crearPresupuestoApify } from './services/apify-hoteles.js';
import { hotelApifyOutputSchema } from './schemas/hotels-apify.js';
import { DESCRIPCION_HERRAMIENTA_HOTELES_APIFY, INSTRUCCIONES_HOTELES_APIFY_AGENTE, INSTRUCCIONES_HOTELES_APIFY_MANAGER } from './services/hoteles-instrucciones.js';

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

const routeStore = Redis.fromEnv();

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

    const ultimaCiudad = ciudadesUnicas[ciudadesUnicas.length - 1];
    if (!ultimaCiudad) {
      throw new Error('No hay ciudades disponibles para distribuir los días.');
    }

    while (diasAsignados < diasTotales) {
      ultimaCiudad.dias += 1;
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

    return await buscarVuelosConEstado({
      origen, destino, fechaIda, fechaVuelta, pasajeros, aeropuertoDestino, destinoRegreso,
    });
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
    estado: z.enum(['ok', 'parcial', 'sin_resultados', 'error_proveedor', 'error_parametros']),
    error: z.string().nullable(),
    direccionesConError: z.array(z.enum(['ida', 'vuelta'])),
    avisos: z.array(z.string()),
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

    La herramienta devuelve un campo estado. Copia estado, error,
    direccionesConError y avisos tal cual en tu salida:
    - ok: hay opciones; preséntalas.
    - parcial: solo hay opciones de una dirección (tipo "Solo ida" o
      "Solo vuelta"); preséntalas e indica el aviso. No inventes la otra.
    - sin_resultados: el proveedor respondió sin vuelos; solo entonces
      puede decirse que no hay vuelos.
    - error_proveedor / error_parametros: la búsqueda FALLÓ; no la
      presentes como "no hay vuelos". Devuelve vuelos vacío y el error.
    Nunca inventes vuelos ni precios.

    Los vuelos devueltos son opciones reales (ida y vuelta, o de una sola
    dirección cuando el estado es parcial).
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

    SALIDA: devuelve cada vuelo con los campos exactos de buscar_vuelos (aerolínea, precio con su moneda ISO, horarios,
    aeropuertos IATA, escalas, duración, números de vuelo y enlace). La web construye las tarjetas con esos datos, así que no
    hace falta redactar líneas de texto. Si el campo enlace está vacío NO inventes una URL.
    Respeta siempre el campo moneda devuelto por la herramienta; nunca añadas un símbolo de moneda por tu cuenta y, si la
    moneda no viene, indica "moneda no confirmada".
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
  description: DESCRIPCION_HERRAMIENTA_HOTELES_APIFY,
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
    return await buscarHotelesConEstado({ destino, fechaEntrada, fechaSalida, adultos });
  },
});

const hotelAgent = new Agent({
  name: 'Hotel Agent',
  outputType: hotelApifyOutputSchema,
  instructions: `
    Eres un agente especializado exclusivamente en alojamiento.

    Utiliza SIEMPRE la herramienta buscar_hoteles.

    La herramienta buscar_hoteles obtiene alojamientos de Google Hotels mediante Apify.

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
    La herramienta devuelve "estado":
    - "ok": hay alojamientos; devuélvelos todos (hasta 10) tal cual.
    - "sin_resultados": el proveedor respondió sin alojamientos para esas fechas; indícalo en "error" como null y deja "hoteles" vacío.
    - "error_proveedor" o "error_interno": la búsqueda FALLÓ. Copia "estado", "error", "codigoError", "httpStatus", "retryAfter", "detalleProveedor" y "etapaError" tal cual y deja "hoteles" vacío. NUNCA lo presentes como que el destino no tiene alojamientos.
    Copia también "diagnostico".

    REGLAS PARA EXPLICAR UN ERROR DEL PROVEEDOR:
    - Comunica únicamente lo que respalda la respuesta del proveedor: el texto de "error", "detalleProveedor", "httpStatus" y "retryAfter".
    - Según "codigoError": "limite_uso" = el proveedor indica cuota o créditos agotados (cita su detalle); "limite_peticiones" = el proveedor indica un límite de frecuencia de peticiones; "autenticacion" = el proveedor respondió 401/403.
    - Si el motivo no está confirmado, dilo claramente. NO deduzcas ni inventes causas ni plazos de recuperación: no digas "límite mensual", "cuota agotada", "créditos agotados" ni "clave inválida", ni cuándo se restablecerá el servicio, salvo que figuren en la respuesta del proveedor. Una hipótesis nunca se presenta como un hecho.
    - No muestres claves ni datos de configuración.

    Si precioDisponible es false (precioTotal y precioPorNoche son 0), el proveedor no dio precio: NO lo presentes como 0, gratis ni como precio real. Indica "Precio no disponible; consultar proveedor". Respeta el campo moneda de cada importe; si la moneda viene vacía indica "Moneda no confirmada" y no supongas ninguna. Si precioCalculado es true, el importe se ha derivado dividiendo/multiplicando por las noches: no lo presentes como dato literal del proveedor.
    Respeta valoracionEscala; no conviertas ni inventes escalas.
    No reduzcas las opciones a una única opción.
    Conserva el enlace real que devuelve la herramienta (campo url). No inventes enlaces ni proveedores.${INSTRUCCIONES_HOTELES_APIFY_AGENTE}
  `,
  tools: [buscarHoteles],
});

/* =========================================================
   5. TOOL + AGENT: ACTIVIDADES
   ========================================================= */

const buscarActividades = tool({
  name: 'buscar_actividades',

  description:
    `Busca actividades y tours reales y reservables en el destino mediante ${etiquetaPlataformas()}.`,

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
    const { destino, tipos } = input as { destino: string; tipos: string[] };
    return buscarActividadesDestino({ destino, tipos });
  },
});

const activitiesOutputSchema =
  z.object({
    destino: z.string(),
    estado: z.enum(['ok', 'parcial', 'sin_resultados', 'error']),
    motivo: z.string().nullable(),
    mensaje: z.string().nullable(),
    diagnosticoBusqueda: z.object({
      consultas: z.array(z.string()),
      resultadosProveedor: z.number(),
      resultadosConTitulo: z.number(),
      resultadosConPrecioNumerico: z.number(),
      sinTituloOUrl: z.number(),
      descartadasPorCiudad: z.number(),
      ciudadesDescartadas: z.array(z.string()),
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

          esGratis:
            z.boolean(),

          precioTexto:
            z.string().nullable(),

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

          ciudadProveedor:
            z.string(),

          verificacionUbicacion:
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

      Los resultados proceden de ${etiquetaPlataformas()}
      mediante Apify y pueden incluir actividades
      reservables, precios, valoraciones, reseñas,
      duración y URL de reserva.

      IMPORTANTE:
      Pasa a la herramienta el destino EXACTAMENTE como lo recibes, sin
      traducirlo. La herramienta ya consulta al proveedor con el nombre en
      español y en inglés. Traducirlo antes empeoró la búsqueda: Civitatis en
      español solo publica /es/bruselas/ y no /es/brussels/.

      Copia en tu salida los campos estado, motivo y mensaje de la herramienta
      sin modificarlos. Si estado es "error", "parcial" o "sin_resultados",
      devuelve la lista de actividades que haya (puede estar vacía) y NO
      presentes un error como si no existieran actividades.

      No inventes:
      - actividades
      - precios
      - horarios
      - disponibilidad
      - valoraciones
      - características

      Devuelve únicamente información obtenida
      de buscar_actividades.

      Conserva exactamente para cada actividad los campos precio, esGratis,
      precioTexto, moneda y URL de la herramienta.
      Si precio es mayor que cero, informa 'Desde [importe] [moneda]' cuando
      no conste que sea el precio final e incluye el texto de modalidad/unidad.
      Si esGratis es true, destaca GRATUITA. Si precio es null y esGratis false,
      indica Precio por confirmar. Nunca interpretes precio ausente como gratis.

      Los precios deben utilizarse cuando la herramienta los proporcione.
      Si una actividad no tiene precio, no inventes ninguno.
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
      rutaId: string;
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
    let actividadesCompletas = true;
    let motivoActividadesIncompletas: string | undefined;

    try {
      const ejecucionActividades = await buscarActividadesApifyMultidestinoDetallado(
        tramos.map((tramo) => tramo.ciudad),
      );
      // Solo plataformas activas (Civitatis): lo que llegara de otra se descarta.
      actividadesProveedor = ejecucionActividades.items.filter((a: any) => plataformaPermitida(a?.platform));
      actividadesCompletas = ejecucionActividades.completa !== false && ejecucionActividades.status === 'SUCCEEDED';
      motivoActividadesIncompletas = ejecucionActividades.motivoIncompleta;
    } catch (error: any) {
      errorActividadesProveedor =
        String(
          error?.message ??
            'No se pudieron consultar las actividades.',
        );
    }

    const resultados = [];
    // Un presupuesto de Apify por itinerario: todas las ciudades comparten el mismo tope.
    const presupuestoApify = crearPresupuestoApify(
      Number(process.env.APIFY_HOTELS_ITINERARY_BUDGET_USD) > 0
        ? Number(process.env.APIFY_HOTELS_ITINERARY_BUDGET_USD)
        : undefined,
    );

    for (const tramo of tramos) {
      const { ciudad, dias, fechaEntrada, fechaSalida } = tramo;

      const hotelResult = await buscarHotelesTramo(
        { ciudad, fechaEntrada, fechaSalida },
        { pais: rutaGuardada.pais, adultos },
        { apify: { presupuesto: presupuestoApify } },
      );
      const hoteles: any[] = hotelResult.hoteles.slice(0, 10);
      const errorAlojamientos: string | null = hotelResult.error;

      // Mismo criterio que en un solo destino: se conservan las actividades con precio pendiente.
      const { validas: actividadesCiudad, diagnostico: diagnosticoActividades } =
        filtrarActividadesDeCiudad(actividadesProveedor, ciudad);
      console.info('[ACTIVITIES_DIAG] Multidestino city filter', JSON.stringify({ ciudad, ...diagnosticoActividades }));
      const actividades = actividadesCiudad
        .slice(0, 10)
        .map((actividad: any) => actividadParaMultidestino(actividad, tipos));
      // Datos estructurados para la web, por ciudad (como en un solo destino).
      registrarBloque(bloqueActividadesMultidestino({
        ciudad, tipos, actividades, error: errorActividadesProveedor, completa: actividadesCompletas, motivoIncompleta: motivoActividadesIncompletas,
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
        diagnosticoActividades,
        diagnosticoErrorAlojamientos: errorAlojamientos
          ? {
              codigoError: hotelResult.codigoError,
              httpStatus: hotelResult.httpStatus,
              retryAfter: hotelResult.retryAfter,
              detalleProveedor: hotelResult.detalleProveedor,
              etapaError: hotelResult.etapaError,
            }
          : null,
      });
    }

    return {
      ciudades: resultados,
      nota:
        'Los resultados están agrupados por ciudad y proceden de búsquedas reales. En actividades, si precio es null y esGratis es false, el precio está por confirmar: no lo presentes como 0 ni como gratis.',
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

    Si el mensaje incluye "Preferencias e instrucciones adicionales del
    usuario", los datos esenciales (origen, destino, fechas y viajeros) son
    los del formulario y esa parte solo los complementa con preferencias,
    intereses o ritmo del viaje: tenlas en cuenta, no las ignores. Si ese
    texto contradice un dato esencial del formulario, NO elijas uno por tu
    cuenta ni busques: pregunta al usuario cuál quiere usar. Haz una única
    búsqueda coherente, sin repetir llamadas.

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
    obtenidos de ${etiquetaPlataformas()} mediante Apify.

    Pueden incluir precio, valoracion, resenas, duracion y URL de reserva.

    ESTADO DE LA CONSULTA DE ACTIVIDADES:
    activities_agent devuelve estado: ok, parcial, sin_resultados o error.
    La web muestra el estado y los avisos de cada búsqueda directamente a partir de los datos de la herramienta; tú NO
    escribes ninguna línea de estado ni listas las actividades.
    - Un "error" significa que la consulta falló, NO que no existan actividades: nunca lo presentes como "no hay actividades".
    - Si el estado es "parcial", la lista puede estar incompleta: puedes comentarlo en una frase.
    - Las actividades se muestran con la ciudad real del destino; no las reetiquetes.

    REGLA CRITICA DE PRECIOS DE ACTIVIDADES:
    - La herramienta devuelve precio numerico (o null) y moneda.
    - Si precio es un numero mayor que cero, presenta exactamente "Desde X MONEDA" si el proveedor solo ofrece priceFrom; no lo llames precio total.
    - Si precio es 0, solo puedes llamarla gratuita si el proveedor confirma explícitamente que es gratis. En caso de free tour, aclara que puede haber propina voluntaria si está confirmado.
    - Si precio es null, presenta "Precio no disponible; consulta la oferta". Nunca escribas "gratis" por ausencia de precio.
    - Conserva por actividad su nombre, precio/unidad, valoración, duración, plataforma y URL real.

    IMPORTANTE SOBRE ENLACES:
    Cuando presentes vuelos, hoteles o actividades, conserva SIEMPRE
    la URL real proporcionada por la herramienta y muéstrala como
    un enlace "Ver oferta", "Ver alojamiento" o "Ver actividad".
    Nunca inventes una URL ni sustituyas una URL real por otra.

    =========================================================
    PRESENTACIÓN DE VUELOS
    =========================================================

    Los vuelos devueltos por flight_agent los muestra la web como tarjetas, construidas directamente con los datos de la
    herramienta (aerolínea, precio con su moneda, horarios, aeropuertos IATA, escalas, duración y enlace). Por eso NO repitas
    la lista de vuelos ni sus precios en tu texto: escribe solo una explicación breve (qué se ha buscado, aeropuertos usados,
    avisos relevantes) y, si el usuario lo pide, comparaciones o recomendaciones apoyadas en esos datos.
    Nunca inventes un dato que no esté en el resultado de flight_agent ni fijes un símbolo de moneda: la moneda es la que
    devuelve la herramienta; si no la devuelve, di "moneda no confirmada".

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

    PRESENTACION DEL ITINERARIO:
    Cuando entregues un itinerario, usa una estructura escaneable:
    ## Tu itinerario
    ### Día 1 · [fecha si consta]
    - [actividad seleccionada] · [duración/precio si están confirmados]
    Incluye un bloque independiente de presupuesto con costes conocidos,
    costes pendientes y total conocido. No dupliques actividades ni el
    itinerario en la misma respuesta. No incluyas ofertas no seleccionadas.

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

    - Vuelo: muestra su campo enlace. Si apunta a Google Flights con una consulta de ruta/fechas, etiquétalo "Ver búsqueda en Google Flights"; no afirmes que es un enlace de compra directa. Si el proveedor devuelve una URL de reserva directa, etiquétala "Ver oferta de vuelo".
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
    PRESENTACIÓN DE RESULTADOS (los muestra la web desde los datos)
    =========================================================

    Los resultados de flight_agent, hotel_agent y activities_agent (vuelos, alojamientos y actividades) se envían a la web
    como datos estructurados y la web los pinta como tarjetas con todas las opciones reales (precio con su moneda,
    valoración con su escala, enlace real, estado de la consulta). Tu respuesta de texto es SOLO la explicación:
    - NO escribas listas ni tablas con las opciones, precios ni enlaces de cada resultado (saldrían duplicados).
    - NO fijes monedas: no escribas "€" ni "$" por tu cuenta; si necesitas citar un importe, usa la moneda exacta que
      devolvió la herramienta. Si la herramienta no da importe escribe "Precio no disponible"; si no da moneda, "Moneda no confirmada".
    - NO inventes opciones, precios, valoraciones ni enlaces, y no digas que un alojamiento o vuelo es "el mejor" o "el más barato"
      del mercado: solo puedes comparar entre los resultados devueltos.
    - Explica qué se ha buscado (destino, fechas, viajeros), cuántas opciones hay si lo sabes por la herramienta, y cualquier
      aviso (resultados parciales, aeropuerto elegido, precios sin impuestos...). Puedes orientar al usuario sobre cómo elegir
      y preguntarle qué opción prefiere o cuál quiere añadir a su viaje.
    - Si una herramienta devuelve estado "error_proveedor", "error_interno" o "error_parametros", di claramente que esa
      búsqueda falló, con el motivo del campo error, y NO digas que no hay resultados ni inventes opciones. Explica la causa
      solo si la respalda la respuesta del proveedor (codigoError, httpStatus, retryAfter, detalleProveedor); si el motivo no
      está confirmado, dilo así y no lo atribuyas a una cuota agotada ni a otra causa hipotética.
    - Estado "parcial" = hay resultados pero la búsqueda no terminó del todo; estado "sin_resultados" = el proveedor
      respondió sin opciones (no es un fallo).

    El usuario es quien decide qué vuelo y qué alojamiento quiere.
    Tu función es mostrar todas las opciones con información comparable,
    no decidir por él.

    =========================================================
    RESULTADOS EN VIAJES MULTIDESTINO
    =========================================================

    En una ruta con varias ciudades, busca alojamiento y actividades para cada una de las ciudades confirmadas. La web agrupa
    los resultados por ciudad, en el orden de la ruta, a partir de los datos de la herramienta; tú no los listas.
    Tu texto es solo la explicación por ciudad (días, qué se ha encontrado, avisos) sin repetir listas de opciones.

    Si la herramienta devuelve un error en "errores.alojamientos" o "errores.actividades", no digas que no se encontraron
    alojamientos o actividades: indica que el proveedor no pudo completar esa consulta, con el motivo técnico de forma
    comprensible, apoyándote solo en "errores.*" y "diagnosticoErrorAlojamientos" (codigoError, httpStatus, retryAfter,
    detalleProveedor). NO deduzcas ni inventes la causa; si no está confirmada, dilo así.

    La herramienta de recursos multidestino ignora cualquier ciudad que no pertenezca a la ruta guardada mediante rutaId.
    Para actividades, la fuente de verificación es el campo estructurado "city" devuelto por el proveedor.

    =========================================================
    FIN RESULTADOS MULTIDESTINO
    =========================================================

    Si una herramienta devuelve varias opciones, está PROHIBIDO
    convertirlas en una sola recomendación aunque una sea más barata.

    No preguntes al usuario si quiere que le muestres los
    resultados: la web los muestra automáticamente.

    Si el usuario pide volver a ver resultados de un turno anterior, ejecuta de nuevo la búsqueda correspondiente para que la
    web los vuelva a mostrar; no los reescribas de memoria.

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
    y calcular_presupuesto.${INSTRUCCIONES_HOTELES_APIFY_MANAGER}
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
