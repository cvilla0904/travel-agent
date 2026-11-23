import { ApifyClient } from 'apify-client';
import { consultasActividadesParaDestino as consultasParaDestino } from './actividades-ciudad.js';

export const ACTOR_ID = 'scrapesage/tours-activities-scraper';
const MAX_RESULTS_PER_QUERY = 10;
export const WAIT_SECS = 20;

/** Plataformas que el actor sabe consultar y que Mogavel tiene integradas (el resto de la integración es neutra respecto a la plataforma). */
export const PLATAFORMAS_DISPONIBLES = ['civitatis', 'tiqets'] as const;
export type PlataformaActividades = (typeof PLATAFORMAS_DISPONIBLES)[number];

/**
 * Plataformas que se envían AHORA al actor (única fuente de verdad para destino único, multidestino y script de diagnóstico).
 * Tiqets está DESACTIVADO desde el 2026-11-23: en la prueba real de Bruselas devolvió 15 resultados y 10 eran de Viena.
 * Su integración sigue intacta: para reactivarlo basta con dejar esta lista en ['civitatis', 'tiqets'].
 */
export const PLATAFORMAS_ACTIVAS: readonly PlataformaActividades[] = ['civitatis'];

const NOMBRE_PLATAFORMA: Record<PlataformaActividades, string> = { civitatis: 'Civitatis', tiqets: 'Tiqets' };

/** Texto legible de las plataformas activas para herramientas y prompts («Civitatis» o «Civitatis y Tiqets»). */
export function etiquetaPlataformas(plataformas: readonly string[] = PLATAFORMAS_ACTIVAS): string {
  const nombres = validarPlataformas(plataformas).map((p) => NOMBRE_PLATAFORMA[p]);
  return nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Valida la lista de plataformas antes de enviarla al actor. Nunca se envía una lista vacía (el actor podría usar todas
 * sus plataformas por defecto) ni una plataforma desconocida. Elimina duplicados conservando el orden.
 */
export function validarPlataformas(plataformas: readonly string[]): PlataformaActividades[] {
  if (!Array.isArray(plataformas) || plataformas.length === 0) {
    throw new Error('Plataformas de actividades no válidas: la lista no puede estar vacía.');
  }
  const desconocidas = plataformas.filter((p) => !(PLATAFORMAS_DISPONIBLES as readonly string[]).includes(p));
  if (desconocidas.length > 0) {
    throw new Error(`Plataformas de actividades no válidas: ${desconocidas.join(', ')}. Disponibles: ${PLATAFORMAS_DISPONIBLES.join(', ')}.`);
  }
  return [...new Set(plataformas)] as PlataformaActividades[];
}

/** Input exacto que recibe el actor (compartido con el script de diagnóstico para que no se desvíen). */
export function inputActor(consultas: string[], plataformas: readonly string[] = PLATAFORMAS_ACTIVAS) {
  return {
    searchQueries: consultas,
    platforms: validarPlataformas(plataformas),
    currency: 'EUR',
    language: 'es',
    includeActivityDetails: true,
    maxResults: Math.max(10, consultas.length * MAX_RESULTS_PER_QUERY),
    maxResultsPerQuery: MAX_RESULTS_PER_QUERY,
  };
}

export type EjecucionActor = { items: any[]; status: string; runId: string | null; datasetId: string | null; consultas: string[] };

const ERROR_EN_CURSO_SIN_RESULTADOS = 'Apify sigue buscando actividades y todavía no ha guardado resultados. La ejecución no ha fallado, pero no hay resultados disponibles en este momento.';

// Fábrica del cliente de Apify: solo se sustituye en pruebas (cliente falso, sin red ni créditos).
let crearCliente: (token: string) => any = (token) => new ApifyClient({ token });
export function establecerClienteApify(fabrica?: (token: string) => any): void {
  crearCliente = fabrica ?? ((token) => new ApifyClient({ token }));
}

async function ejecutarActorDetallado(searchQueries: string[]): Promise<EjecucionActor> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN no está configurada.');

  const consultas = [...new Set(searchQueries.map((q) => q.trim()).filter(Boolean))];
  if (consultas.length === 0) return { items: [], status: 'SUCCEEDED', runId: null, datasetId: null, consultas };

  const client = crearCliente(token);
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
