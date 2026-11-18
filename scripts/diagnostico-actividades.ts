/**
 * Diagnóstico de UNA búsqueda real de actividades (una sola ejecución del actor de Apify).
 *
 *   APIFY_API_TOKEN=... npx tsx scripts/diagnostico-actividades.ts Bruselas
 *   APIFY_API_TOKEN=... npx tsx scripts/diagnostico-actividades.ts Bruselas --esperar
 *
 * Usa el MISMO input y la MISMA espera (20 s) que producción. Con --esperar, si el actor sigue RUNNING,
 * espera a que termine ESA misma ejecución (no lanza otra) para comparar el dataset parcial y el final.
 * Imprime estado, duración, nº de resultados, etiquetas de ciudad y cuántos descarta cada filtro.
 * No imprime el token. Consume créditos de Apify: una ejecución.
 */
import { ApifyClient } from 'apify-client';
import { ACTOR_ID, WAIT_SECS, inputActor } from '../src/services/apify.ts';
import { analizarDataset, consultasActividadesParaDestino } from '../src/services/actividades-ciudad.ts';

const destino = process.argv[2];
const esperar = process.argv.includes('--esperar');
const token = process.env.APIFY_API_TOKEN;
if (!destino) { console.error('Uso: tsx scripts/diagnostico-actividades.ts <destino> [--esperar]'); process.exit(1); }
if (!token) { console.error('Falta APIFY_API_TOKEN en el entorno.'); process.exit(1); }

const client = new ApifyClient({ token });
const input = inputActor(consultasActividadesParaDestino(destino));
console.log('INPUT al actor:', JSON.stringify({ actor: ACTOR_ID, ...input }));

const inicio = Date.now();
const run = await client.actor(ACTOR_ID).call(input, { waitSecs: WAIT_SECS });
const segundos = Math.round((Date.now() - inicio) / 100) / 10;
console.log('RUN:', JSON.stringify({ status: run.status, runId: run.id, datasetId: run.defaultDatasetId, segundos }));
if (!run.defaultDatasetId) { console.error('El actor no devolvió dataset.'); process.exit(2); }

const leer = async (etiqueta: string) => {
  const { items } = await client.dataset(run.defaultDatasetId!).listItems();
  console.log(`DATASET (${etiqueta}):`, JSON.stringify(analizarDataset(items as any[], destino), null, 2));
};
await leer(`tras ${WAIT_SECS}s, status ${run.status}`);
if (esperar && run.status === 'RUNNING') {
  const fin = await client.run(run.id).waitForFinish({ waitSecs: 120 });
  console.log('RUN FINAL:', JSON.stringify({ status: fin.status, segundosTotales: Math.round((Date.now() - inicio) / 100) / 10 }));
  await leer(`final, status ${fin.status}`);
}
