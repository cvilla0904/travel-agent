import { ApifyClient } from 'apify-client';
import { consultasActividadesParaDestino as consultasParaDestino } from './actividades-ciudad.js';

export const ACTOR_ID = 'scrapesage/tours-activities-scraper';
const PLATFORMS = ['civitatis', 'tiqets'];
const MAX_RESULTS_PER_QUERY = 10;
export const WAIT_SECS = 20;

/** Input exacto que recibe el actor (compartido con el script de diagnóstico para que no se desvíen). */
export function inputActor(consultas: string[]) {
  return {
    searchQueries: consultas,
    platforms: PLATFORMS,
    currency: 'EUR',
    language: 'es',
    includeActivityDetails: true,
    maxResults: Math.max(10, consultas.length * MAX_RESULTS_PER_QUERY),
    maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
  };
}

export type EjecucionActor = { items: any[]; status: string; runId: string | null; datasetId: string | null; consultas: string[] };

const ERROR_EN_CURSO_SIN_RESULTADOS = 'Apify sigue buscando actividades y todavía no ha guardado resultados. La ejecución no ha fallado, pero no hay resultados disponibles en este momento.';

async function ejecutarActorDetallado(searchQueries: string[]): Promise<EjecucionActor> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');

  const consultas = [...new Set(searchQueries.map((q) => q.trim()).filter(Boolean))];
  if (consultas.length === 0) return { items: [], status: 'SUCCEEDED', runId: null, datasetId: null, consultas };

  const client = new ApifyClient({ token });
  const actor = client.actor(ACTOR_ID);
  const actorInput = inputActor(consultas);

  console.info('[APIFY_DIAG] Starting actor', JSON.stringify({ actor: ACTOR_ID, input: actorInput }));
  const inicio = Date.now();
  const run = await actor.call(actorInput, { waitSecs: WAIT_SECS });
  console.info('[APIFY_DIAG] Actor returned', JSON.stringify({
    status: run.status,
    runId: run.id,
    datasetId: run.defaultDatasetId ?? null,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
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
    // Etiquetas de ciudad del dataset (máx. 10): permiten ver si el actor responde con otro nombre/idioma.
    ciudades: resumenCiudades(items as any[]),
  }));

  return { items: items as any[], status: String(run.status), runId: run.id ?? null, datasetId: run.defaultDatasetId ?? null, consultas };
}

async function ejecutarActor(searchQueries: string[]) {
  const ejecucion = await ejecutarActorDetallado(searchQueries);
  if (ejecucion.items.length === 0 && ejecucion.status === 'RUNNING') throw new Error(ERROR_EN_CURSO_SIN_RESULTADOS);
  return ejecucion.items;
}

/** Como buscarActividadesApify, pero conserva el estado de la ejecución para poder informar de «incompleta». */
export async function buscarActividadesApifyDetallado(params: { destino: string }) {
  return ejecutarActorDetallado(consultasParaDestino(params.destino));
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

function resumenCiudades(items: any[]): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const item of items) {
    const ciudad = String(item?.city ?? '(sin ciudad)');
    if (Object.keys(cuenta).length < 10 || ciudad in cuenta) cuenta[ciudad] = (cuenta[ciudad] ?? 0) + 1;
  }
  return cuenta;
}
