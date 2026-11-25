// Integración de vuelos basada en el patrón operativo de la integración Apify
// de actividades: ejecutar actor, comprobar el estado, leer el dataset y validar
// los registros reales antes de entregarlos al agente.
import { resolverAeropuertoVuelo } from './aeropuertos-vuelos.js';
import { ErrorVuelos } from './errores-vuelos.js';
const ACTOR_ID = 'johnvc/google-flights-data-scraper-flight-and-price-search';
const MAX_RESULTS = 10;
const WAIT_SECS = 60;
// Build fijada tras comprobar entregas en dataset; configurable desde Vercel.
const ACTOR_BUILD = process.env.APIFY_FLIGHTS_BUILD?.trim() || '0.0.450';

export { ErrorVuelos, type CodigoErrorVuelos } from './errores-vuelos.js';

export type ClienteApifyMinimo = {
  actor(id: string): { call(input: any, opts?: any): Promise<any> };
  dataset(id: string): { listItems(opts?: any): Promise<{ items: unknown[] }> };
};

export type DependenciasApifyFlights = {
  crearCliente?: (token: string) => Promise<ClienteApifyMinimo> | ClienteApifyMinimo;
};

export type BuscarVuelosApifyParams = {
  origen: string;
  destino: string;
  fechaIda: string;
  fechaVuelta?: string;
  pasajeros: number;
};

export function resolverAeropuerto(value: string, campo: string): string {
  return resolverAeropuertoVuelo(value, campo).iata;
}

function normalizarClave(value: string): string {
  return value.toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
}

function obtenerCampo(objeto: Record<string, any>, aliases: string[]): any {
  const claves = new Set(aliases.map(normalizarClave));
  const clave = Object.keys(objeto).find((key) => claves.has(normalizarClave(key)));
  return clave === undefined ? undefined : objeto[clave];
}

function normalizarRegistroVuelo(value: Record<string, any>): Record<string, any> {
  const price = obtenerCampo(value, ['price', 'price_total', 'priceTotal', 'total_price', 'totalPrice']);
  const currency = obtenerCampo(value, ['currency']) ?? 'EUR';
  const airline = obtenerCampo(value, ['airlines', 'airline(s)', 'airline', 'airlineName']);
  const departureAirport = obtenerCampo(value, ['departure_airport', 'departureAirport']);
  const arrivalAirport = obtenerCampo(value, ['arrival_airport', 'arrivalAirport']);
  const departs = obtenerCampo(value, ['departs', 'departure_time', 'departureTime', 'departure']);
  const arrives = obtenerCampo(value, ['arrives', 'arrival_time', 'arrivalTime', 'arrival']);
  const durationMinutes = obtenerCampo(value, ['duration_minutes', 'durationMinutes']);
  const duration = obtenerCampo(value, ['duration']);
  const flightNumber = obtenerCampo(value, ['flight_number', 'flight_numbers', 'flightNumber', 'flightNumbers']);
  const rawStops = obtenerCampo(value, ['stops', 'number_of_stops', 'numberOfStops']);

  let stops: number | undefined;
  if (typeof rawStops === 'number' && Number.isFinite(rawStops)) {
    stops = Math.max(0, rawStops);
  } else if (typeof rawStops === 'string' && rawStops.trim()) {
    const text = rawStops.trim().toLowerCase();
    if (/^(?:direct|nonstop|non-stop|sin escalas?)$/.test(text)) {
      stops = 0;
    } else {
      const match = text.match(/\d+/);
      if (match) stops = Math.max(0, Number(match[0]));
    }
  }

  return {
    ...value,
    price,
    currency,
    airlines: airline,
    departure_airport: departureAirport,
    arrival_airport: arrivalAirport,
    departs,
    arrives,
    duration_minutes: durationMinutes,
    duration,
    flight_number: flightNumber,
    ...(stops === undefined ? {} : { stops }),
  };
}

function pareceVuelo(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const vuelo = value as Record<string, any>;
  const price = obtenerCampo(vuelo, ['price', 'price_total', 'priceTotal', 'total_price', 'totalPrice']);
  const departure = obtenerCampo(vuelo, ['departure_airport', 'departureAirport', 'departs', 'departure_time', 'departureTime']);
  const arrival = obtenerCampo(vuelo, ['arrival_airport', 'arrivalAirport', 'arrives', 'arrival_time', 'arrivalTime']);
  const route = obtenerCampo(vuelo, ['route']);
  return price != null && (departure != null || arrival != null || route != null);
}

/**
 * El actor puede entregar los vuelos como:
 * - registros individuales;
 * - un único registro que contiene un array de vuelos;
 * - all_flights, best_flights/other_flights o results/data.
 * La vista Table de Apify puede expandir un array aunque el dataset muestre
 * un solo registro. Por eso se aplanan arrays antes de validar cada vuelo.
 */
function extraerVuelosDelDataset(items: unknown[]): Record<string, any>[] {
  const vuelos: Record<string, any>[] = [];

  const procesar = (value: unknown, depth = 0): void => {
    if (depth > 5 || value == null) return;

    if (Array.isArray(value)) {
      for (const child of value) procesar(child, depth + 1);
      return;
    }

    if (typeof value !== 'object') return;
    const item = value as Record<string, any>;

    if (pareceVuelo(item)) {
      vuelos.push(normalizarRegistroVuelo(item));
      return;
    }

    const contenedores = new Set([
      'allflights', 'bestflights', 'otherflights', 'flights',
      'results', 'data', 'items',
    ]);
    for (const key of Object.keys(item)) {
      if (contenedores.has(normalizarClave(key)) && item[key] != null) {
        procesar(item[key], depth + 1);
      }
    }
  };

  for (const item of items) procesar(item);
  return vuelos;
}

export async function buscarVuelosApify(
  params: BuscarVuelosApifyParams,
  deps: DependenciasApifyFlights = {},
): Promise<Record<string, any>[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new ErrorVuelos('configuracion', 'APIFY_API_TOKEN no está configurada.');
  if (!params.origen.trim() || !params.destino.trim()) throw new ErrorVuelos('parametros', 'El origen y el destino son obligatorios.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaIda)) throw new ErrorVuelos('parametros', 'La fecha de ida debe tener formato YYYY-MM-DD.');
  if (params.fechaVuelta && !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaVuelta)) throw new ErrorVuelos('parametros', 'La fecha de vuelta debe tener formato YYYY-MM-DD.');

  const origin = resolverAeropuerto(params.origen, 'origen');
  const destination = resolverAeropuerto(params.destino, 'destino');
  const adults = Math.max(1, Math.min(9, Math.floor(params.pasajeros || 1)));
  const client: ClienteApifyMinimo = deps.crearCliente
    ? await deps.crearCliente(token)
    : new (await import('apify-client')).ApifyClient({ token }) as unknown as ClienteApifyMinimo;

  // Nombres de campos contrastados con el formulario real del actor en Apify.
  // Ida y vuelta se consultan por separado desde buscar_vuelos, de modo que
  // cada ejecución representa una sola dirección y una fecha inequívoca.
  const actorInput = {
    departure_id: origin,
    arrival_id: destination,
    outbound_date: params.fechaIda,
    adults,
    currency: 'EUR',
    hl: 'en',
    gl: 'us',
    exclude_basic: false,
    fetch_booking_options: false,
    max_pages: 1,
  };

  console.info('[APIFY_FLIGHTS] Starting actor', JSON.stringify({
    actor: ACTOR_ID, build: ACTOR_BUILD, waitSecs: WAIT_SECS, input: actorInput,
  }));

  let run: any;
  try {
    run = await client.actor(ACTOR_ID).call(actorInput, { waitSecs: WAIT_SECS, build: ACTOR_BUILD });
  } catch (error) {
    // Si la build fijada ya no existe, se reintenta una sola vez con la build por defecto del actor.
    const mensaje = error instanceof Error ? error.message : String(error);
    if (!/build/i.test(mensaje) || process.env.APIFY_FLIGHTS_BUILD?.trim()) {
      throw new ErrorVuelos('proveedor', `Apify no pudo ejecutar la búsqueda de vuelos: ${mensaje}`);
    }
    console.warn('[APIFY_FLIGHTS] Build fijada no disponible, reintentando con la build por defecto');
    run = await client.actor(ACTOR_ID).call(actorInput, { waitSecs: WAIT_SECS });
  }
  console.info('[APIFY_FLIGHTS] Actor returned', JSON.stringify({
    runId: run.id, status: run.status, datasetId: run.defaultDatasetId ?? null,
  }));

  if (!run.defaultDatasetId) {
    throw new ErrorVuelos('proveedor', `Apify no devolvió un dataset para vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }
  if (run.status !== 'SUCCEEDED' && run.status !== 'RUNNING') {
    throw new ErrorVuelos('proveedor', `Apify no completó la búsqueda de vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }

  // No limitar a 10 registros: el actor puede guardar todos los vuelos dentro
  // de un único elemento del dataset. El límite se aplica tras aplanar el JSON.
  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1000 });
  const flights = extraerVuelosDelDataset(items);

  console.info('[APIFY_FLIGHTS] Dataset read', JSON.stringify({
    runId: run.id,
    status: run.status,
    datasetRecords: items.length,
    extractedFlights: flights.length,
    sampleKeys: flights[0] ? Object.keys(flights[0]) : [],
    origin,
    destination,
    outboundDate: params.fechaIda,
  }));

  if (flights.length === 0) {
    if (run.status === 'RUNNING') {
      throw new ErrorVuelos('proveedor', 'Apify sigue ejecutando la búsqueda y todavía no ha guardado vuelos reconocibles.');
    }
    // Dataset realmente vacío tras terminar con éxito: es "sin resultados", no un fallo.
    if (items.length === 0) return [];
    throw new ErrorVuelos('formato', 'Apify terminó, pero no se reconocieron vuelos en el JSON del dataset. Revisa la estructura del resultado del actor.');
  }

  return flights.slice(0, MAX_RESULTS);
}
