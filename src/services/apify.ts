import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'scrapesage/tours-activities-scraper';
const PLATFORMS = ['civitatis', 'tiqets'];
const MAX_RESULTS_PER_QUERY = 10;
const WAIT_SECS = 90;

async function ejecutarActor(searchQueries: string[]) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');

  const consultas = [...new Set(searchQueries.map((q) => q.trim()).filter(Boolean))];
  if (consultas.length === 0) return [];

  const client = new ApifyClient({ token });
  const actor = client.actor(ACTOR_ID);
  const run = await actor.call({
    searchQueries: consultas,
    platforms: PLATFORMS,
    currency: 'EUR',
    language: 'es',
    includeActivityDetails: false,
    maxResults: consultas.length * PLATFORMS.length * MAX_RESULTS_PER_QUERY,
    maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
  }, { waitSecs: WAIT_SECS });

  if (run.status !== 'SUCCEEDED') {
    const status = String(run.status ?? 'UNKNOWN');
    throw new Error(`El proveedor Apify no completó la búsqueda de actividades (estado: ${status}).`);
  }

  if (!run.defaultDatasetId) {
    throw new Error('Apify completó la ejecución, pero no devolvió un conjunto de resultados.');
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items;
}

export async function buscarActividadesApify(params: {
  destino: string;
  categoria?: string;
}) {
  // Este actor espera ciudades en searchQueries; las categorías se usan
  // para ordenar los resultados, no se concatenan a la ciudad.
  return ejecutarActor([params.destino]);
}

export async function buscarActividadesApifyMultidestino(destinos: string[]) {
  return ejecutarActor(destinos);
}
