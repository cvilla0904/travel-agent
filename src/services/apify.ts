import { ApifyClient } from 'apify-client';
import { consultasActividadesParaDestino as consultasParaDestino } from './actividades-ciudad.js';

export const ACTOR_ID = 'scrapesage/tours-activities-scraper';
const MAX_RESULTS_PER_QUERY = 10;
/** Espera inicial de actor.call() (las búsquedas rápidas terminan aquí). */
export const WAIT_SECS = 20;

/**
 * Ciclo de vida del actor de actividades.
 *  1. actor.call(input, { waitSecs: WAIT_SECS }) arranca la ejecución y espera hasta WAIT_SECS.
 *  2. Si sigue RUNNING/READY, se consulta su estado con client.run(id).waitForFinish() hasta agotar el presupuesto total
 *     (APIFY_ACTIVIDADES_WAIT_SECS, por defecto 45 s, máximo 120): NO se lee un dataset RUNNING como si fuera final.
 *  3. Si el presupuesto se agota, se lee el dataset (resultados parciales ya guardados), se informa de «incompleta» y se
 *     ABORTA la ejecución (best effort) para que no siga consumiendo créditos sin que nadie vaya a leer su resultado.
 * El presupuesto total debe caber en la duración máxima de la función de Vercel (maxDuration en vercel.json) junto con el
 * resto de la petición (modelos, vuelos y hoteles en paralelo): no se sube «a ciegas».
 */
export const ESPERA_TOTAL_POR_DEFECTO_SECS = 45;
export const ESPERA_TOTAL_MAXIMA_SECS = 120;
const ESTADOS_TERMINALES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

export function esperaTotalSecs(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.APIFY_ACTIVIDADES_WAIT_SECS);
  if (!Number.isFinite(n) || n <= 0) return ESPERA_TOTAL_POR_DEFECTO_SECS;
  return Math.min(ESPERA_TOTAL_MAXIMA_SECS, Math.max(1, Math.round(n)));
}

export { PLATAFORMAS_DISPONIBLES, PLATAFORMAS_ACTIVAS, etiquetaPlataformas, validarPlataformas, type PlataformaActividades } from './plataformas-actividades.js';
import { PLATAFORMAS_ACTIVAS, validarPlataformas } from './plataformas-actividades.js';
import { TOPE_COSTE_ACTIVIDADES_USD_POR_DEFECTO, opcionesLimite, topeCoste } from './apify-limites.js';
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

export type EjecucionActor = {
  items: any[]; status: string; runId: string | null; datasetId: string | null; consultas: string[];
  /** true solo si el actor terminó con éxito: con false, los resultados pueden ser parciales. */
  completa?: boolean;
  /** Segundos esperados en total (call + sondeos). */
  esperaSegundos?: number;
  /** Por qué no está completa: 'tiempo_agotado' (presupuesto de espera) o 'estado_final_no_exitoso' (FAILED/ABORTED/TIMED-OUT con resultados). */
  motivoIncompleta?: 'tiempo_agotado' | 'estado_final_no_exitoso';
};

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
  const presupuestoMs = esperaTotalSecs() * 1000;
  const limites = opcionesLimite(esperaTotalSecs(), topeCoste(process.env.APIFY_ACTIVIDADES_MAX_CHARGE_USD, TOPE_COSTE_ACTIVIDADES_USD_POR_DEFECTO));
  let run = await actor.call(actorInput, { waitSecs: Math.min(WAIT_SECS, esperaTotalSecs()), ...limites });
  console.info('[APIFY_DIAG] Actor returned', JSON.stringify({
    status: run.status,
    runId: run.id,
    datasetId: run.defaultDatasetId ?? null,
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
  }));

  if (!run.defaultDatasetId) {
    throw new Error('Apify no devolvió un conjunto de resultados para las actividades.');
  }

  // actor.call({ waitSecs }) devuelve RUNNING si el actor tarda más que la espera inicial. Eso NO significa que haya fallado,
  // pero tampoco que lo guardado en el dataset sea el resultado final: se vuelve a consultar el estado hasta que termine o se
  // agote el presupuesto de espera.
  let sondeos = 0;
  while (!ESTADOS_TERMINALES.has(String(run.status)) && run.id && typeof client.run === 'function') {
    const restanteMs = presupuestoMs - (Date.now() - inicio);
    if (restanteMs <= 500) break;
    sondeos++;
    const antes = Date.now();
    try {
      const actualizado = await client.run(run.id).waitForFinish({ waitSecs: Math.max(1, Math.min(30, Math.floor(restanteMs / 1000))) });
      if (actualizado?.status) run = { ...run, ...actualizado };
    } catch (error) {
      console.warn('[APIFY_DIAG] No se pudo consultar el estado de la ejecución', JSON.stringify({ runId: run.id, error: error instanceof Error ? error.message : String(error) }));
      break;
    }
    if (Date.now() - antes < 250) await new Promise((r) => setTimeout(r, 250));
  }
  const terminada = ESTADOS_TERMINALES.has(String(run.status));
  if (!terminada) {
    // Presupuesto agotado con la ejecución viva: se detiene para que no siga cobrando y se lee lo ya guardado.
    console.warn('[APIFY_DIAG] Presupuesto de espera agotado', JSON.stringify({ runId: run.id, status: run.status, segundos: Math.round((Date.now() - inicio) / 100) / 10, sondeos }));
    try { if (run.id && typeof client.run === 'function') await client.run(run.id).abort(); } catch { /* best effort */ }
  }
  if (run.status === 'FAILED' || run.status === 'TIMED-OUT') {
    const parcial = await client.dataset(run.defaultDatasetId).listItems();
    if (!parcial.items.length) throw new Error(`El proveedor Apify no completó la búsqueda de actividades (estado: ${String(run.status)}).`);
    return finalizar(parcial.items as any[], run, consultas, inicio, 'estado_final_no_exitoso');
  }
  if (run.status === 'ABORTED' && terminada) {
    const parcial = await client.dataset(run.defaultDatasetId).listItems();
    if (!parcial.items.length) throw new Error(`El proveedor Apify no completó la búsqueda de actividades (estado: ${String(run.status)}).`);
    return finalizar(parcial.items as any[], run, consultas, inicio, 'estado_final_no_exitoso');
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return finalizar(items as any[], run, consultas, inicio, terminada ? undefined : 'tiempo_agotado');
}

function finalizar(items: any[], run: any, consultas: string[], inicio: number, motivo?: 'tiempo_agotado' | 'estado_final_no_exitoso'): EjecucionActor {
  const esperaSegundos = Math.round((Date.now() - inicio) / 100) / 10;
  console.info('[APIFY_DIAG] Dataset read', JSON.stringify({
    runId: run.id, status: run.status, datasetId: run.defaultDatasetId, itemCount: items.length, completa: !motivo, esperaSegundos,
    sampleFields: items[0] ? Object.keys(items[0] as Record<string, unknown>) : [],
    // Etiquetas de ciudad del dataset (máx. 10): permiten ver si el actor responde con otro nombre/idioma.
    ciudades: resumenCiudades(items),
  }));
  // Si se interrumpió por tiempo, el estado informado es el del momento de la lectura: nunca SUCCEEDED.
  const status = motivo === 'tiempo_agotado' && run.status === 'SUCCEEDED' ? 'RUNNING' : String(run.status);
  return {
    items, status, runId: run.id ?? null, datasetId: run.defaultDatasetId ?? null, consultas,
    completa: !motivo && status === 'SUCCEEDED', esperaSegundos, ...(motivo ? { motivoIncompleta: motivo } : {}),
  };
}

async function ejecutarActor(searchQueries: string[]) {
  const ejecucion = await ejecutarActorDetallado(searchQueries);
  if (ejecucion.items.length === 0 && ejecucion.completa === false) throw new Error(ERROR_EN_CURSO_SIN_RESULTADOS);
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

/** Multidestino conservando el estado de la ejecución (completa / parcial) para poder informar de «incompleta». */
export async function buscarActividadesApifyMultidestinoDetallado(destinos: string[]) {
  return ejecutarActorDetallado(destinos.flatMap(consultasParaDestino));
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
