import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'automation-lab/google-flights-scraper';
const MAX_RESULTS = 10;

export type BuscarVuelosApifyParams = {
  origen: string;
  destino: string;
  fechaIda: string;
  fechaVuelta?: string;
  pasajeros: number;
};

export async function buscarVuelosApify(params: BuscarVuelosApifyParams): Promise<any[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');

  if (!params.origen.trim() || !params.destino.trim()) {
    throw new Error('El origen y el destino son obligatorios para buscar vuelos.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaIda)) {
    throw new Error('La fecha de ida debe tener formato YYYY-MM-DD.');
  }
  if (params.fechaVuelta && !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaVuelta)) {
    throw new Error('La fecha de vuelta debe tener formato YYYY-MM-DD.');
  }

  const client = new ApifyClient({ token });
  const actorInput = {
    origin: params.origen.trim(),
    destination: params.destino.trim(),
    departureDate: params.fechaIda,
    ...(params.fechaVuelta ? { returnDate: params.fechaVuelta } : {}),
    adults: Math.max(1, Math.min(9, Math.floor(params.pasajeros || 1))),
    maxResults: MAX_RESULTS,
    currency: 'EUR',
    language: 'es',
    proxyConfiguration: { useApifyProxy: true },
  };

  console.info('[APIFY_FLIGHTS] Starting search', JSON.stringify({
    actor: ACTOR_ID,
    origin: actorInput.origin,
    destination: actorInput.destination,
    departureDate: actorInput.departureDate,
    returnDate: actorInput.returnDate ?? null,
    adults: actorInput.adults,
  }));

  const run = await client.actor(ACTOR_ID).call(actorInput, { waitSecs: 120 });
  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify no completó la búsqueda de vuelos (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }
  if (!run.defaultDatasetId) {
    throw new Error('Apify no devolvió un dataset para los resultados de vuelos.');
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: MAX_RESULTS });
  console.info('[APIFY_FLIGHTS] Search completed', JSON.stringify({
    runId: run.id,
    resultCount: items.length,
    status: run.status,
  }));
  return items as any[];
}
