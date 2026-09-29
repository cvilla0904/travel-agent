import { Agent, MemorySession, run, tool } from '@openai/agents';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { z } from 'zod';
import { buscarLugaresGeoapify } from './services/geoapify.js';
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
  const sugerencias = await resolverAeropuerto(texto);

  if (!Array.isArray(sugerencias) || sugerencias.length === 0) {
    throw new Error(
      `No se ha encontrado ningún aeropuerto para "${texto}".`,
    );
  }

  const sugerenciaCiudad =
    sugerencias.find(
      (sugerencia: any) =>
        sugerencia?.type === 'city' &&
        Array.isArray(sugerencia?.airports) &&
        sugerencia.airports.length > 0,
    ) ??
    sugerencias.find(
      (sugerencia: any) =>
        Array.isArray(sugerencia?.airports) &&
        sugerencia.airports.length > 0,
    );

  if (!sugerenciaCiudad) {
    throw new Error(
      `No se han encontrado aeropuertos para "${texto}".`,
    );
  }

  const ids = sugerenciaCiudad.airports
    .map((airport: any) => airport?.id)
    .filter(
      (id: any): id is string =>
        typeof id === 'string' &&
        id.trim().length > 0,
    );

  if (ids.length === 0) {
    throw new Error(
      `No se han encontrado códigos IATA para "${texto}".`,
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
   3. TOOL + AGENT: VUELOS
   ========================================================= */

const buscarVuelos = tool({
  name: 'buscar_vuelos',

  description:
    'Busca vuelos reales utilizando Google Flights mediante SerpApi. Resuelve automáticamente cualquier ciudad o aeropuerto introducido por el usuario.',

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
        await resolverIdsAeropuerto(
          destino,
        );

      arrivalId =
        arrivalIds.join(',');
    }

    const data =
      await buscarGoogleFlights({
        departureId,
        arrivalId,
        outboundDate: fechaIda,
        returnDate: fechaVuelta,
        adults: pasajeros,
      });

    const resultados = [
      ...(data.best_flights ?? []),
      ...(data.other_flights ?? []),
    ];

    const vuelos =
      resultados
        .slice(0, 5)
        .map((vuelo: any) => {
          const segmentos =
            vuelo.flights ?? [];

          const aerolineas = [
            ...new Set(
              segmentos.map(
                (segmento: any) =>
                  segmento.airline,
              ),
            ),
          ];

          return {
            aerolinea:
              aerolineas.join(' + '),

            precioPorPersona:
              Math.round(
                Number(vuelo.price) /
                  pasajeros,
              ),

            escalas:
              vuelo.layovers?.length ?? 0,

            precioTotal:
              Number(vuelo.price),
          };
        });

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

const flightOutputSchema =
  z.object({
    origen: z.string(),

    destino: z.string(),

    aeropuertoDestino:
      z.string(),

    aeropuertoOrigen:
      z.string(),

    fechaIda: z.string(),

    fechaVuelta: z.string(),

    pasajeros: z.number(),

    vuelos: z.array(
      z.object({
        aerolinea: z.string(),

        precioPorPersona:
          z.number(),

        escalas: z.number(),

        precioTotal: z.number(),
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
    'Busca lugares y puntos de interés reales en el destino según el tipo de actividad solicitado.',

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

    const categorias:
      Record<string, string> = {
        naturaleza:
          'natural',

        cultura:
          'tourism.sights',

        gastronomía:
          'catering.restaurant',

        aventura:
          'sport',
      };

    const resultados: Array<{
      nombre: string;
      tipo: string;
      direccion: string;
      latitud: number;
      longitud: number;
    }> = [];

    for (const tipo of tipos) {
      const categoria =
        categorias[tipo];

      if (!categoria) {
        continue;
      }

      const lugares =
        await buscarLugaresGeoapify({
          destino,
          categoria,
        });

      for (const lugar of lugares) {
        const properties =
          lugar.properties;

        resultados.push({
          nombre:
            properties.name ||
            'Lugar sin nombre',

          tipo,

          direccion:
            properties.formatted ||
            '',

          latitud:
            properties.lat || 0,

          longitud:
            properties.lon || 0,
        });
      }
    }

    const lugaresUnicos =
      Array.from(
        new Map(
          resultados.map(
            (lugar) => [
              `${lugar.nombre}-${lugar.latitud}-${lugar.longitud}`,
              lugar,
            ],
          ),
        ).values(),
      );

    return {
      destino,

      actividades:
        lugaresUnicos.slice(0, 15),
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

          direccion:
            z.string(),

          latitud:
            z.number(),

          longitud:
            z.number(),
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
      en lugares y actividades.

      Utiliza SIEMPRE la herramienta buscar_actividades.

      Los resultados proceden de lugares reales
      encontrados mediante Geoapify.

      No inventes:
      - actividades
      - precios
      - horarios
      - disponibilidad
      - características

      Devuelve únicamente información obtenida
      de buscar_actividades.

      Importante:
      los resultados de Geoapify son lugares o puntos
      de interés reales. No debes presentarlos como
      actividades reservables si la herramienta no
      proporciona información de reserva.
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
   7. PRESUPUESTO CONTROLADO POR CÓDIGO
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
   8. ITINERARIO CONTROLADO POR CÓDIGO
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
   9. TRAVEL MANAGER
   ========================================================= */

const travelAgent = new Agent({
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
    - destino
    - fecha de ida
    - fecha de vuelta
    - número de pasajeros
    - presupuesto
    - preferencias

    =========================================================
    CASO 1: DESTINO YA DEFINIDO
    =========================================================

    Si el usuario ya ha indicado destino:

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
    ELECCIÓN DEL DESTINO
    =========================================================

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

    - naturaleza
    - cultura
    - gastronomía
    - aventura

    utiliza activities_agent.

    Los resultados de Geoapify son lugares y puntos
    de interés reales.

    No los presentes como actividades reservables
    si no existe información de reserva.

    =========================================================
    PRESUPUESTO
    =========================================================

    Si el usuario ha proporcionado presupuesto y existen
    resultados reales de vuelos y alojamiento:

    utiliza calcular_presupuesto.

    Los vuelos deben proceder de flight_agent.

    El alojamiento debe proceder de hotel_agent.

    Actualmente las actividades se consideran:

    0 EUR

    para el cálculo automático porque Geoapify no proporciona
    un precio fiable de reserva.

    Indica claramente que el presupuesto calculado
    NO incluye entradas, tours o actividades de pago.

    =========================================================
    ITINERARIO
    =========================================================

    Si existen actividades y fechas del viaje:

    calcula la duración mediante las fechas.

    Utiliza crear_itinerario.

    No inventes actividades.

    No repitas actividades.

    =========================================================
    REGLAS ABSOLUTAS
    =========================================================

    Nunca inventes:

    - vuelos
    - precios
    - hoteles
    - disponibilidad
    - aerolíneas
    - actividades
    - horarios
    - valoraciones
    - condiciones

    Utiliza siempre las herramientas para obtener
    información real.

    No dependas de una lista fija de aeropuertos.
    Los aeropuertos deben resolverse dinámicamente
    mediante SerpApi.

    No vuelvas a preguntar datos ya conocidos.

    Prioriza ejecutar búsquedas reales tan pronto
    como dispongas de los datos mínimos necesarios.

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

    flightAgentTool,

    hotelAgentTool,

    activitiesAgentTool,

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
main().catch((error) => {
  console.error(
    '\nERROR:',
    error?.message ??
      error,
  );

  process.exit(1);
});