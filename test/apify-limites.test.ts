/**
 * Límites de ejecución de los actores de Apify (vuelos y actividades), con clientes falsos: sin red ni créditos.
 * Distingue tiempo de espera (waitSecs), tiempo máximo de ejecución (timeout), límite económico (maxTotalChargeUsd) y cancelación (abort).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarVuelosApify } from '../src/services/apify-flights.ts';
import { buscarActividadesApifyDetallado, establecerClienteApify } from '../src/services/apify.ts';
import { MARGEN_TIMEOUT_SECS, opcionesLimite, topeCoste, TOPE_COSTE_ACTIVIDADES_USD_POR_DEFECTO, TOPE_COSTE_USD_MAXIMO, TOPE_COSTE_VUELOS_USD_POR_DEFECTO } from '../src/services/apify-limites.ts';

const silencio = () => {};
process.env.APIFY_API_TOKEN ||= 'token-de-prueba-no-real';
const vuelo = (price: number) => ({
  price, currency: 'EUR', airlines: 'Aerolínea Ficticia',
  departure_airport: { name: 'Madrid', id: 'MAD', time: '2027-01-13 08:00' },
  arrival_airport: { name: 'Bruselas', id: 'BRU', time: '2027-01-13 10:20' },
  duration: '2 h 20 min', stops: 0, flight_number: 'XX 100',
});
const P = { origen: 'MAD', destino: 'BRU', fechaIda: '2027-01-13', pasajeros: 2 };

function clienteVuelos(status: string, traza: { llamadas: any[]; abortos: string[] }, conRun = true, abortFalla = false) {
  return {
    actor: () => ({ call: async (input: any, opts: any) => { traza.llamadas.push({ input, opts }); return { id: 'run-v', status, defaultDatasetId: 'd1' }; } }),
    dataset: () => ({ listItems: async () => ({ items: [{ best_flights: [vuelo(120)], other_flights: [] }] }) }),
    ...(conRun ? { run: (id: string) => ({ abort: async () => { if (abortFalla) throw new Error('abort rechazado'); traza.abortos.push(id); } }) } : {}),
  };
}

test('el tope económico: por defecto 0,10 USD, acotado a [0,01; 0,25] y valores no válidos → por defecto', () => {
  assert.equal(TOPE_COSTE_VUELOS_USD_POR_DEFECTO, 0.1);
  assert.equal(TOPE_COSTE_ACTIVIDADES_USD_POR_DEFECTO, 0.1);
  assert.equal(topeCoste(undefined, 0.1), 0.1);
  assert.equal(topeCoste('0.05', 0.1), 0.05);
  assert.equal(topeCoste('50', 0.1), TOPE_COSTE_USD_MAXIMO);
  assert.equal(topeCoste('0.0001', 0.1), 0.01);
  for (const malo of ['', 'abc', '-1', '0', 'NaN']) assert.equal(topeCoste(malo, 0.1), 0.1, malo);
});

test('opcionesLimite: el tiempo máximo de ejecución en Apify es la espera del cliente más un margen (no son lo mismo)', () => {
  assert.deepEqual(opcionesLimite(60, 0.1), { maxTotalChargeUsd: 0.1, timeout: 60 + MARGEN_TIMEOUT_SECS });
  assert.deepEqual(opcionesLimite(44.2, 0.05), { maxTotalChargeUsd: 0.05, timeout: 45 + MARGEN_TIMEOUT_SECS });
});

test('vuelos: actor.call recibe maxTotalChargeUsd y timeout además de waitSecs, y sigue enviando max_pages 1', async () => {
  const t = { llamadas: [] as any[], abortos: [] as string[] };
  const antes = console.info; console.info = silencio;
  try { await buscarVuelosApify(P, { crearCliente: () => clienteVuelos('SUCCEEDED', t) }); } finally { console.info = antes; }
  assert.equal(t.llamadas.length, 1);
  const o = t.llamadas[0].opts;
  assert.equal(o.waitSecs, 60);
  assert.equal(o.maxTotalChargeUsd, 0.1);
  assert.equal(o.timeout, 60 + MARGEN_TIMEOUT_SECS);
  assert.equal(t.llamadas[0].input.max_pages, 1);
  assert.equal(t.llamadas[0].input.fetch_booking_options, false);
  assert.deepEqual(t.abortos, [], 'una ejecución terminada no se cancela');
});

test('vuelos: el tope se puede ajustar con APIFY_FLIGHTS_MAX_CHARGE_USD (y se acota)', async () => {
  const previo = process.env.APIFY_FLIGHTS_MAX_CHARGE_USD;
  const antes = console.info; console.info = silencio;
  try {
    for (const [valor, esperado] of [['0.05', 0.05], ['9', 0.25]] as const) {
      process.env.APIFY_FLIGHTS_MAX_CHARGE_USD = valor;
      const t = { llamadas: [] as any[], abortos: [] as string[] };
      await buscarVuelosApify(P, { crearCliente: () => clienteVuelos('SUCCEEDED', t) });
      assert.equal(t.llamadas[0].opts.maxTotalChargeUsd, esperado, valor);
    }
  } finally {
    console.info = antes;
    if (previo === undefined) delete process.env.APIFY_FLIGHTS_MAX_CHARGE_USD; else process.env.APIFY_FLIGHTS_MAX_CHARGE_USD = previo;
  }
});

test('vuelos: una ejecución que sigue RUNNING tras la espera se cancela (abort) para que no siga cobrando', async () => {
  const t = { llamadas: [] as any[], abortos: [] as string[] };
  const info = console.info, aviso = console.warn; console.info = silencio; console.warn = silencio;
  try { await buscarVuelosApify(P, { crearCliente: () => clienteVuelos('RUNNING', t) }); } finally { console.info = info; console.warn = aviso; }
  assert.deepEqual(t.abortos, ['run-v']);
});

test('vuelos: si el abort falla no se rompe la búsqueda (se registra) y si no hay cliente de runs tampoco', async () => {
  const info = console.info, aviso = console.warn; console.info = silencio; console.warn = silencio;
  try {
    const a = { llamadas: [] as any[], abortos: [] as string[] };
    const r1 = await buscarVuelosApify(P, { crearCliente: () => clienteVuelos('RUNNING', a, true, true) });
    assert.ok(r1.length > 0);
    const b = { llamadas: [] as any[], abortos: [] as string[] };
    const r2 = await buscarVuelosApify(P, { crearCliente: () => clienteVuelos('RUNNING', b, false) });
    assert.ok(r2.length > 0);
  } finally { console.info = info; console.warn = aviso; }
});

test('actividades: actor.call recibe maxTotalChargeUsd y timeout; un tope configurado se acota', async () => {
  const llamadas: any[] = [];
  establecerClienteApify(() => ({
    actor: () => ({ call: async (input: any, opts: any) => { llamadas.push({ input, opts }); return { id: 'run-a', status: 'SUCCEEDED', defaultDatasetId: 'd1' }; } }),
    dataset: () => ({ listItems: async () => ({ items: [] }) }),
  }));
  const previo = { ...process.env };
  process.env.APIFY_API_TOKEN = 'token-de-prueba-no-real';
  const info = console.info; console.info = silencio;
  try {
    await buscarActividadesApifyDetallado({ destino: 'Bruselas' });
    assert.equal(llamadas[0].opts.maxTotalChargeUsd, 0.1);
    assert.equal(llamadas[0].opts.timeout, 45 + MARGEN_TIMEOUT_SECS);
    assert.equal(llamadas[0].opts.waitSecs, 20);
    assert.deepEqual(llamadas[0].input.platforms, ['civitatis']);
    process.env.APIFY_ACTIVIDADES_MAX_CHARGE_USD = '3';
    await buscarActividadesApifyDetallado({ destino: 'Bruselas' });
    assert.equal(llamadas[1].opts.maxTotalChargeUsd, TOPE_COSTE_USD_MAXIMO);
  } finally {
    console.info = info;
    establecerClienteApify(undefined);
    delete process.env.APIFY_ACTIVIDADES_MAX_CHARGE_USD;
    if (previo.APIFY_API_TOKEN === undefined) delete process.env.APIFY_API_TOKEN;
  }
});

test('actividades: agotada la espera con la ejecución viva se cancela (abort) y el resultado se marca incompleto', async () => {
  let abortos = 0;
  establecerClienteApify(() => ({
    actor: () => ({ call: async () => ({ id: 'run-a', status: 'RUNNING', defaultDatasetId: 'd1' }) }),
    run: () => ({ waitForFinish: async () => { await new Promise((r) => setTimeout(r, 20)); return { status: 'RUNNING' }; }, abort: async () => { abortos++; } }),
    dataset: () => ({ listItems: async () => ({ items: [{ title: 'A', url: 'https://www.civitatis.com/es/bruselas/a/', platform: 'civitatis', city: 'Brussels', priceFrom: 10, priceCurrency: 'EUR', latitude: 50.8, longitude: 4.35 }] }) }),
  }));
  const previo = { ...process.env };
  process.env.APIFY_API_TOKEN = 'token-de-prueba-no-real';
  process.env.APIFY_ACTIVIDADES_WAIT_SECS = '1';
  const info = console.info, aviso = console.warn; console.info = silencio; console.warn = silencio;
  try {
    const r = await buscarActividadesApifyDetallado({ destino: 'Bruselas' });
    assert.equal(abortos, 1);
    assert.equal(r.completa, false);
    assert.equal(r.motivoIncompleta, 'tiempo_agotado');
  } finally {
    console.info = info; console.warn = aviso;
    establecerClienteApify(undefined);
    delete process.env.APIFY_ACTIVIDADES_WAIT_SECS;
    if (previo.APIFY_API_TOKEN === undefined) delete process.env.APIFY_API_TOKEN;
  }
});

test('una ejecución cortada por el límite económico (ABORTED/TIMED-OUT con datos) se devuelve como incompleta, no como completa', async () => {
  for (const estado of ['ABORTED', 'TIMED-OUT']) {
    establecerClienteApify(() => ({
      actor: () => ({ call: async () => ({ id: 'run-a', status: estado, defaultDatasetId: 'd1' }) }),
      dataset: () => ({ listItems: async () => ({ items: [{ title: 'A', url: 'https://www.civitatis.com/es/bruselas/a/', platform: 'civitatis', city: 'Brussels', priceFrom: 10, priceCurrency: 'EUR', latitude: 50.8, longitude: 4.35 }] }) }),
    }));
    process.env.APIFY_API_TOKEN = 'token-de-prueba-no-real';
    const info = console.info, aviso = console.warn; console.info = silencio; console.warn = silencio;
    try {
      const r = await buscarActividadesApifyDetallado({ destino: 'Bruselas' });
      assert.equal(r.completa, false, estado);
      assert.equal(r.motivoIncompleta, 'estado_final_no_exitoso', estado);
    } finally { console.info = info; console.warn = aviso; establecerClienteApify(undefined); delete process.env.APIFY_API_TOKEN; }
  }
});
