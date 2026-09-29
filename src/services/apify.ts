import { ApifyClient } from 'apify-client';

export async function buscarActividadesApify(params: {
  destino: string;
  categoria?: string;
}) {
  const token = process.env.APIFY_API_TOKEN;

  if (!token) {
    throw new Error('APIFY_API_TOKEN no está configurada.');
  }

  const client = new ApifyClient({
    token,
  });

  const actor = client.actor('scrapesage/tours-activities-scraper');

  const input = {
    searchQueries: [
      params.categoria
        ? `${params.destino} ${params.categoria}`
        : params.destino,
    ],
    platforms: ['civitatis', 'tiqets'],
    currency: 'EUR',
    language: 'en',
    includeActivityDetails: true,
    maxResults: 10,
  };

  const run = await actor.call(input);

  const { items } = await client
    .dataset(run.defaultDatasetId)
    .listItems();

  return items;
}
