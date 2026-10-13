import { ApifyClient } from 'apify-client';

const ACTOR_ID = 'scrapesage/tours-activities-scraper';
const PLATFORMS = ['civitatis', 'tiqets'];
const MAX_RESULTS_PER_QUERY = 10;
const WAIT_SECS = 20;

// Consultamos el nombre local y el habitual en inglés. El actor puede responder
// de forma diferente según el idioma de la búsqueda, aunque el destino sea el mismo.
const ALIASES_DESTINO: Record<string, string[]> = {
  roma: ['Rome', 'Roma'],
  rome: ['Rome', 'Roma'],
  florencia: ['Florence', 'Florencia'],
  florence: ['Florence', 'Florencia'],
  venecia: ['Venice', 'Venecia'],
  venice: ['Venice', 'Venecia'],
  londres: ['London', 'Londres'],
  london: ['London', 'Londres'],
  munich: ['Munich', 'Múnich'],
  múnich: ['Munich', 'Múnich'],
  paris: ['Paris', 'París'],
  parís: ['Paris', 'París'],
  amsterdam: ['Amsterdam'],
  barcelona: ['Barcelona'],
  madrid: ['Madrid'],
};

function consultasParaDestino(destino: string): string[] {
  const limpio = destino.trim();
  const clave = limpio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const alias = ALIASES_DESTINO[clave];
  return alias ? [...new Set([limpio, ...alias])] : [limpio];
}

async function ejecutarActor(searchQueries: string[]) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');

  const consultas = [...new Set(searchQueries.map((q) => q.trim()).filter(Boolean))];
  if (consultas.length === 0) return [];

  const client = new ApifyClient({ token });
  const actor = client.actor(ACTOR_ID);
  const actorInput = {
    searchQueries: consultas,
    platforms: PLATFORMS,
    currency: 'EUR',
    language: 'en',
    includeActivityDetails: true,
    maxResults: Math.max(10, consultas.length * MAX_RESULTS_PER_QUERY),
    maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
  };

  console.info('[APIFY_DIAG] Starting actor', JSON.stringify({ actor: ACTOR_ID, input: actorInput }));
  const run = await actor.call(actorInput, { waitSecs: WAIT_SECS });
  console.info('[APIFY_DIAG] Actor returned', JSON.stringify({
    status: run.status,
    runId: run.id,
    datasetId: run.defaultDatasetId ?? null,
  }));

  if (!run.defaultDatasetId) {
    throw new Error('Apify no devolvió un conjunto de resultados para las actividades.');
  }

  // actor.call({ waitSecs }) puede devolver RUNNING si el actor tarda más que
  // el tiempo de espera. Eso NO significa que la búsqueda haya fallado: el
  // dataset ya puede contener actividades válidas. Leerlo antes de descartar
  // la ejecución evita perder resultados parciales que Apify ya ha guardado.
  if (run.status !== 'SUCCEEDED' && run.status !== 'RUNNING') {
    throw new Error(`El proveedor Apify no completó la búsqueda de actividades (estado: ${String(run.status ?? 'UNKNOWN')}).`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  console.info('[APIFY_DIAG] Dataset read', JSON.stringify({
    runId: run.id,
    status: run.status,
    datasetId: run.defaultDatasetId,
    itemCount: items.length,
    sampleFields: items[0] ? Object.keys(items[0] as Record<string, unknown>) : [],
  }));

  if (items.length === 0 && run.status === 'RUNNING') {
    throw new Error('Apify sigue buscando actividades y todavía no ha guardado resultados. La ejecución no ha fallado, pero no hay resultados disponibles en este momento.');
  }

  return items;
}

export async function buscarActividadesApify(params: {
  destino: string;
  categoria?: string;
}) {
  return ejecutarActor(consultasParaDestino(params.destino));
}

export async function buscarActividadesApifyMultidestino(destinos: string[]) {
  return ejecutarActor(destinos.flatMap(consultasParaDestino));
}
