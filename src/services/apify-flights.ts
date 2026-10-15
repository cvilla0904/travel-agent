import { ApifyClient } from 'apify-client';

// Integración de vuelos basada en el patrón operativo de la integración Apify
// de actividades: ejecutar actor, comprobar el estado, leer el dataset y validar
// los registros reales antes de entregarlos al agente.
const ACTOR_ID = 'johnvc/google-flights-data-scraper-flight-and-price-search';
const MAX_RESULTS = 10;
const WAIT_SECS = 20;

export type BuscarVuelosApifyParams = {
  origen: string;
  destino: string;
  fechaIda: string;
  fechaVuelta?: string;
  pasajeros: number;
};

const AEROPUERTOS: Record<string, string> = {
  bilbao: 'BIO', donostia: 'EAS', 'san sebastian': 'EAS', 'san sebastián': 'EAS',
  pasaia: 'EAS', pasajes: 'EAS', madrid: 'MAD', barcelona: 'BCN',
  malaga: 'AGP', málaga: 'AGP', sevilla: 'SVQ', valencia: 'VLC',
  alicante: 'ALC', ibiza: 'IBZ', palma: 'PMI', 'palma de mallorca': 'PMI',
  'santiago de compostela': 'SCQ', vigo: 'VGO', 'a coruña': 'LCG',
  paris: 'CDG', parís: 'CDG', londres: 'LHR', roma: 'FCO', rome: 'FCO',
  milan: 'MXP', milán: 'MXP', venecia: 'VCE', florencia: 'FLR', florence: 'FLR',
  amsterdam: 'AMS', berlin: 'BER', berlín: 'BER', munich: 'MUC', múnich: 'MUC',
  frankfurt: 'FRA', lisboa: 'LIS', lisbon: 'LIS', oporto: 'OPO', porto: 'OPO',
  bruselas: 'BRU', praga: 'PRG', viena: 'VIE', zurich: 'ZRH', zúrich: 'ZRH',
  atenas: 'ATH', athens: 'ATH', estambul: 'IST', istanbul: 'IST',
  'nueva york': 'JFK', 'new york': 'JFK', 'los angeles': 'LAX', 'los ángeles': 'LAX',
  tokio: 'HND', tokyo: 'HND', osaka: 'KIX', bangkok: 'BKK', singapur: 'SIN',
  singapore: 'SIN', dubai: 'DXB', dublín: 'DUB', dublin: 'DUB', copenhague: 'CPH',
  estocolmo: 'ARN', helsinki: 'HEL', varsovia: 'WAW', budapest: 'BUD',
  bogota: 'BOG', bogotá: 'BOG', medellin: 'MDE', medellín: 'MDE',
  cartagena: 'CTG', 'ciudad de mexico': 'MEX', 'ciudad de méxico': 'MEX',
  'mexico city': 'MEX', 'buenos aires': 'EZE', 'sao paulo': 'GRU',
  'são paulo': 'GRU', 'rio de janeiro': 'GIG',
};

function resolverAeropuerto(value: string, campo: string): string {
  const limpio = value.trim();
  if (/^[A-Z]{3}$/i.test(limpio)) return limpio.toUpperCase();
  const normalizado = limpio.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const codigo = AEROPUERTOS[normalizado] ?? AEROPUERTOS[limpio.toLocaleLowerCase('es')];
  if (codigo) return codigo;
  throw new Error(`No he podido identificar el aeropuerto IATA de ${campo} ("${limpio}"). Prueba con un código IATA de tres letras, por ejemplo BIO, MAD o FCO.`);
}

function pareceVuelo(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const vuelo = value as Record<string, any>;
  return ('price' in vuelo || 'price_total' in vuelo || 'priceTotal' in vuelo) &&
    ('departure_airport' in vuelo || 'departureAirport' in vuelo || 'route' in vuelo ||
      'arrival_airport' in vuelo || 'arrivalAirport' in vuelo);
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
      vuelos.push(item);
      return;
    }

    for (const key of ['all_flights', 'best_flights', 'other_flights', 'flights', 'results', 'data', 'items']) {
      if (item[key] != null) procesar(item[key], depth + 1);
    }
  };

  for (const item of items) procesar(item);
  return vuelos;
}

export async function buscarVuelosApify(params: BuscarVuelosApifyParams): Promise<Record<string, any>[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');
  if (!params.origen.trim() || !params.destino.trim()) throw new Error('El origen y el destino son obligatorios.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaIda)) throw new Error('La fecha de ida debe tener formato YYYY-MM-DD.');
  if (params.fechaVuelta && !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaVuelta)) throw new Error('La fecha de vuelta debe tener formato YYYY-MM-DD.');

  const origin = resolverAeropuerto(params.origen, 'origen');
  const destination = resolverAeropuerto(params.destino, 'destino');
  const adults = Math.max(1, Math.min(9, Math.floor(params.pasajeros || 1)));
  const client = new ApifyClient({ token });

  // Nombres de campos contrastados con el formulario real del actor en Apify.
  // Ida y vuelta se consultan por separado desde buscar_vuelos, de modo que
  // cada ejecución representa una sola dirección y una fecha inequívoca.
  const actorInput = {
    departure_id: origin,
    arrival_id: destination,
    outbound_date: params.fechaIda,
    adults,
    currency: 'EUR',
    language: 'es',
    country_code: 'es',
    exclude_basic: false,
    fetch_booking_options: false,
    max_pages: 1,
  };

  console.info('[APIFY_FLIGHTS] Starting actor', JSON.stringify({
    actor: ACTOR_ID, input: actorInput,
  }));

  const run = await client.actor(ACTOR_ID).call(actorInput, { waitSecs: WAIT_SECS });
  console.info('[APIFY_FLIGHTS] Actor returned', JSON.stringify({
    runId: run.id, status: run.status, datasetId: run.defaultDatasetId ?? null,
  }));

  if (!run.defaultDatasetId) {
    throw new Error(`Apify no devolvió un dataset para vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }
  if (run.status !== 'SUCCEEDED' && run.status !== 'RUNNING') {
    throw new Error(`Apify no completó la búsqueda de vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
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
    throw new Error(
      run.status === 'RUNNING'
        ? 'Apify sigue ejecutando la búsqueda y todavía no ha guardado vuelos reconocibles.'
        : 'Apify terminó, pero no se reconocieron vuelos en el JSON del dataset. Revisa la estructura del resultado del actor.',
    );
  }

  return flights.slice(0, MAX_RESULTS);
}
