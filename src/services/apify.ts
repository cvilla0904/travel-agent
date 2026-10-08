import { ApifyClient } from 'apify-client';

async function ejecutarActor(searchQueries: string[]) {
  const token = process.env.APIFY_API_TOKEN;

  if (!token) {
    throw new Error('APIFY_API_TOKEN no está configurada.');
  }

  const client = new ApifyClient({ token });
  const actor = client.actor('scrapesage/tours-activities-scraper');

  const run = await actor.call({
    searchQueries,
    platforms: ['civitatis', 'tiqets'],
    currency: 'EUR',
    language: 'es',
    includeActivityDetails: false,
    maxResults: Math.max(10, searchQueries.length * 10),
    maxResultsPerQuery: 10,
  });

  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems();

  return items;
}

export async function buscarActividadesApify(params: {
  destino: string;
  categoria?: string;
}) {
  const query = params.categoria
    ? `${params.destino} ${params.categoria}`
    : params.destino;

  return ejecutarActor([query]);
}

export async function buscarActividadesApifyMultidestino(destinos: string[]) {
  const consultas = destinos
    .map((destino) => destino.trim())
    .filter(Boolean);

  if (!consultas.length) return [];

  return ejecutarActor(consultas);
}