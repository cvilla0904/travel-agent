/**
 * Ciclo de vida del actor de actividades (RUNNING → sondeo → resultado), con un cliente de Apify falso: sin red ni créditos.
 * Comprueba que un dataset de una ejecución RUNNING no se da por final, que la espera está acotada y que lo incompleto se informa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarActividadesApifyDetallado, esperaTotalSecs, establecerClienteApify, WAIT_SECS } from '../src/services/apify.ts';
import { buscarActividadesDestino } from '../src/services/actividades-busqueda.ts';

const BXL = { latitude: 50.8467, longitude: 4.3525 };
const act = (n: number) => ({ title: `Actividad ${n}`, url: `https://www.civitatis.com/es/bruselas/a${n}/`, platform: 'civitatis', city: 'Brussels', priceFrom: 20, priceCurrency: 'EUR', ...BXL });

interface Traza { eventos: string[]; abortos: number }

/** secuencia: estados que devuelve cada sondeo (waitForFinish); datasets: contenido del dataset en cada lectura. */
function cliente(traza: Traza, opts: { inicial: string; sondeos: string[]; datasets: any[][]; sinRun?: boolean }) {
  let lecturas = 0, sondeo = 0;
  return () => ({
    actor: () => ({ call: async (_i: any, o: any) => { traza.eventos.push(`call(waitSecs=${o.waitSecs})`); return { id: 'run1', status: opts.inicial, defaultDatasetId: 'ds1' }; } }),
    ...(opts.sinRun ? {} : {
      run: () => ({
        waitForFinish: async (o: any) => { const s = opts.sondeos[Math.min(sondeo++, opts.sondeos.length - 1)]!; traza.eventos.push(`sondeo(${s})`); await new Promise((r) => setTimeout(r, 30)); return { status: s, waitSecs: o.waitSecs }; },
        abort: async () => { traza.abortos++; traza.eventos.push('abort'); },
      }),
    }),
    dataset: () => ({ listItems: async () => { const items = opts.datasets[Math.min(lecturas++, opts.datasets.length - 1)]!; traza.eventos.push(`dataset(${items.length})`); return { items }; } }),
  });
}

async function con<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const previo = { ...process.env };
  process.env.APIFY_API_TOKEN = 'token-de-prueba-no-real';
  Object.assign(process.env, env);
  console.info = () => {}; console.warn = () => {};
  try { return await fn(); } finally {
    establecerClienteApify(undefined);
    for (const k of Object.keys(env)) { if (previo[k] === undefined) delete process.env[k]; else process.env[k] = previo[k]; }
    if (previo.APIFY_API_TOKEN === undefined) delete process.env.APIFY_API_TOKEN;
  }
}

test('presupuesto de espera configurable y acotado (por defecto 45 s, máximo 120 s, no válido → por defecto)', () => {
  assert.equal(esperaTotalSecs({}), 45);
  assert.equal(esperaTotalSecs({ APIFY_ACTIVIDADES_WAIT_SECS: '30' }), 30);
  assert.equal(esperaTotalSecs({ APIFY_ACTIVIDADES_WAIT_SECS: '9999' }), 120);
  assert.equal(esperaTotalSecs({ APIFY_ACTIVIDADES_WAIT_SECS: 'abc' }), 45);
  assert.equal(esperaTotalSecs({ APIFY_ACTIVIDADES_WAIT_SECS: '-5' }), 45);
  assert.equal(WAIT_SECS, 20);
});

test('RUNNING tras la espera inicial → se sondea hasta SUCCEEDED y el dataset se lee DESPUÉS (resultado final, completa)', async () => {
  const t: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t, { inicial: 'RUNNING', sondeos: ['RUNNING', 'SUCCEEDED'], datasets: [[act(1), act(2), act(3)]] }));
  const r = await con({ APIFY_ACTIVIDADES_WAIT_SECS: '20' }, () => buscarActividadesApifyDetallado({ destino: 'Bruselas' }));
  assert.deepEqual(t.eventos, ['call(waitSecs=20)', 'sondeo(RUNNING)', 'sondeo(SUCCEEDED)', 'dataset(3)']);
  assert.equal(r.status, 'SUCCEEDED');
  assert.equal(r.completa, true);
  assert.equal(r.items.length, 3);
  assert.equal(t.abortos, 0);
});

test('presupuesto agotado con el actor vivo: se lee lo guardado, se marca incompleta (nunca SUCCEEDED), se aborta y no se bloquea', async () => {
  const t: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t, { inicial: 'RUNNING', sondeos: ['RUNNING'], datasets: [[act(1), act(2)]] }));
  const inicio = Date.now();
  const r = await con({ APIFY_ACTIVIDADES_WAIT_SECS: '1' }, () => buscarActividadesApifyDetallado({ destino: 'Bruselas' }));
  assert.ok(Date.now() - inicio < 3000, 'la espera está acotada por el presupuesto');
  assert.equal(r.completa, false);
  assert.equal(r.motivoIncompleta, 'tiempo_agotado');
  assert.equal(r.status, 'RUNNING');
  assert.equal(r.items.length, 2);
  assert.equal(t.abortos, 1);
  assert.ok(t.eventos.indexOf('abort') < t.eventos.indexOf('dataset(2)'), 'se aborta antes de la lectura final del dataset');
  assert.equal(t.eventos[0], 'call(waitSecs=1)', 'la espera inicial nunca supera el presupuesto');
});

test('la herramienta informa «parcial» (con motivo y espera) cuando la ejecución no terminó, y «ok» cuando sí', async () => {
  const t: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t, { inicial: 'RUNNING', sondeos: ['RUNNING'], datasets: [[act(1)]] }));
  const parcial = await con({ APIFY_ACTIVIDADES_WAIT_SECS: '1' }, () => buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }));
  assert.equal(parcial.estado, 'parcial');
  assert.equal(parcial.proveedor.completa, false);
  assert.equal(parcial.proveedor.motivoIncompleta, 'tiempo_agotado');
  assert.match(parcial.mensaje!, /parciales/);
  assert.equal(parcial.actividades.length, 1);

  const t2: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t2, { inicial: 'SUCCEEDED', sondeos: [], datasets: [[act(1), act(2)]] }));
  const ok = await con({}, () => buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }));
  assert.equal(ok.estado, 'ok');
  assert.equal(ok.proveedor.completa, true);
  assert.deepEqual(t2.eventos, ['call(waitSecs=20)', 'dataset(2)']);
});

test('RUNNING sin ningún resultado al agotar el presupuesto: parcial («no se han podido verificar»), no «sin resultados»', async () => {
  const t: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t, { inicial: 'RUNNING', sondeos: ['RUNNING'], datasets: [[]] }));
  const r = await con({ APIFY_ACTIVIDADES_WAIT_SECS: '1' }, () => buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }));
  assert.equal(r.estado, 'parcial');
  assert.equal(r.actividades.length, 0);
});

test('FAILED con resultados guardados → parcial; FAILED sin resultados → error del proveedor (no «sin actividades»)', async () => {
  establecerClienteApify(cliente({ eventos: [], abortos: 0 }, { inicial: 'FAILED', sondeos: [], datasets: [[act(1)]] }));
  const parcial = await con({}, () => buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }));
  assert.equal(parcial.estado, 'parcial');
  assert.equal(parcial.proveedor.motivoIncompleta, 'estado_final_no_exitoso');

  establecerClienteApify(cliente({ eventos: [], abortos: 0 }, { inicial: 'FAILED', sondeos: [], datasets: [[]] }));
  const error = await con({}, () => buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }));
  assert.equal(error.estado, 'error');
  assert.match(error.mensaje!, /FAILED/);
});

test('cliente sin run(): sin sondeo (compatibilidad), RUNNING se informa como incompleta y no se aborta', async () => {
  const t: Traza = { eventos: [], abortos: 0 };
  establecerClienteApify(cliente(t, { inicial: 'RUNNING', sondeos: [], datasets: [[act(1)]], sinRun: true }));
  const r = await con({}, () => buscarActividadesApifyDetallado({ destino: 'Bruselas' }));
  assert.equal(r.completa, false);
  assert.equal(t.abortos, 0);
});
