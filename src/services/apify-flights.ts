import { ApifyClient } from 'apify-client';

// Actor probado manualmente en Apify y con resultados reales.
// Importante: cada elemento del dataset puede contener los vuelos dentro de all_flights.
const ACTOR_ID = 'johnvc/google-flights-data-scraper-flight-and-price-search';
const MAX_RESULTS = 10;

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

function extraerVuelosDelDataset(items: any[]): any[] {
  const vuelos: any[] = [];
  for (const item of items) {
    if (Array.isArray(item?.all_flights)) vuelos.push(...item.all_flights);
    else if (Array.isArray(item?.best_flights) || Array.isArray(item?.other_flights)) {
      if (Array.isArray(item.best_flights)) vuelos.push(...item.best_flights);
      if (Array.isArray(item.other_flights)) vuelos.push(...item.other_flights);
    } else if (item && typeof item === 'object' && ('price' in item || 'price_total' in item)) {
      // Compatibilidad con datasets que entreguen un vuelo por registro.
      vuelos.push(item);
    }
  }
  return vuelos;
}

export async function buscarVuelosApify(params: BuscarVuelosApifyParams): Promise<any[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');
  if (!params.origen.trim() || !params.destino.trim()) throw new Error('El origen y el destino son obligatorios.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaIda)) throw new Error('La fecha de ida debe tener formato YYYY-MM-DD.');
  if (params.fechaVuelta && !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaVuelta)) throw new Error('La fecha de vuelta debe tener formato YYYY-MM-DD.');

  const origin = resolverAeropuerto(params.origen, 'origen');
  const destination = resolverAeropuerto(params.destino, 'destino');
  const adults = Math.max(1, Math.min(9, Math.floor(params.pasajeros || 1)));
  const client = new ApifyClient({ token });
  const actorInput = {
    departure_id: origin,
    arrival_id: destination,
    outbound_date: params.fechaIda,
    adults,
    currency: 'EUR',
    hl: 'es',
    gl: 'es',
    max_pages: 1,
  };

  console.info('[APIFY_FLIGHTS] Starting search', JSON.stringify({
    actor: ACTOR_ID, origin, destination, outboundDate: params.fechaIda,
    adults, currency: actorInput.currency,
  }));

  const run = await client.actor(ACTOR_ID).call(actorInput, { waitSecs: 120 });
  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify no completó la búsqueda de vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }
  if (!run.defaultDatasetId) throw new Error('Apify no devolvió un dataset para los resultados de vuelos.');

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 10 });
  const flights = extraerVuelosDelDataset(items);
  console.info('[APIFY_FLIGHTS] Search completed', JSON.stringify({
    runId: run.id, datasetRecords: items.length, flightCount: flights.length,
    status: run.status, origin, destination, outboundDate: params.fechaIda,
  }));

  if (flights.length === 0) {
    throw new Error('Apify terminó correctamente, pero el dataset no contiene vuelos reconocibles. Revisa la pestaña JSON de esa ejecución.');
  }
  return flights.slice(0, MAX_RESULTS);
}
