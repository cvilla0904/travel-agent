/** SearchAPI: un único reintento ante HTTP 429 respetando Retry-After, sin bucles ni esperas excesivas. Respuestas simuladas. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarHotelesConEstado, esperaReintento429, REINTENTO_429_ESPERA_MAXIMA_MS, REINTENTO_429_ESPERA_POR_DEFECTO_MS } from '../src/services/searchapi.js';

const base = { destino: 'Amsterdam', paisCodigo: 'nl', fechaEntrada: '2026-12-10', fechaSalida: '2026-12-13', adultos: 2 };
const SUG = { suggestions: [{ title: 'Amsterdam', label: 'Amsterdam, North Holland, Netherlands', dest_id: '-2140479', dest_type: 'city', country_code: 'nl' }] };
const HOTEL = { properties: [{ title: 'Hotel A', link: 'https://www.booking.com/hotel/a.html', extracted_price: 480, currency: 'EUR', rating: 8.5, reviews: 100 }] };

/** respuestas por etapa, en orden de llamada; la última se repite. */
function fetchGuion(guion: { autocomplete?: Array<[number, unknown, Record<string, string>?]>; booking?: Array<[number, unknown, Record<string, string>?]> }) {
  const n = { autocomplete: 0, booking: 0 };
  const f = (async (input: URL) => {
    const motor = new URL(String(input)).searchParams.get('engine') === 'booking' ? 'booking' : 'autocomplete';
    const lista = guion[motor] ?? [[200, motor === 'booking' ? HOTEL : SUG]];
    const [status, cuerpo, cab] = lista[Math.min(n[motor]++, lista.length - 1)]!;
    return new Response(JSON.stringify(cuerpo), { status, headers: cab ?? {} });
  }) as unknown as typeof fetch;
  return { f, n };
}

async function ejecutar(guion: Parameters<typeof fetchGuion>[0]) {
  const { f, n } = fetchGuion(guion);
  const esperas: number[] = [];
  const eventos: Array<{ evento: string; datos: Record<string, unknown> }> = [];
  const r = await buscarHotelesConEstado(base, {
    apiKey: 'clave-de-prueba-123456', fetch: f,
    dormir: async (ms) => { esperas.push(ms); },
    registrar: (evento, datos) => eventos.push({ evento, datos }),
  });
  return { r, n, esperas, eventos };
}

test('esperaReintento429: respeta Retry-After (segundos/fecha), tiene tope y no reintenta si la cuota está agotada', () => {
  assert.equal(esperaReintento429(null, 'rechazo_sin_causa'), REINTENTO_429_ESPERA_POR_DEFECTO_MS);
  assert.equal(esperaReintento429('3', 'limite_peticiones'), 3000);
  assert.equal(esperaReintento429('0', 'limite_peticiones'), 250);
  assert.equal(esperaReintento429('120', 'limite_peticiones'), null, 'más de lo razonable: no se bloquea al usuario');
  assert.equal(esperaReintento429(String(REINTENTO_429_ESPERA_MAXIMA_MS / 1000), 'x'), REINTENTO_429_ESPERA_MAXIMA_MS);
  assert.equal(esperaReintento429('2', 'limite_uso'), null, 'cuota agotada: reintentar no sirve');
  assert.equal(esperaReintento429('2', 'autenticacion'), null);
  const fecha = new Date(Date.UTC(2026, 11, 1, 10, 0, 4)).toUTCString();
  assert.equal(esperaReintento429(fecha, 'x', Date.UTC(2026, 11, 1, 10, 0, 0)), 4000);
  assert.equal(esperaReintento429('basura', 'x'), REINTENTO_429_ESPERA_POR_DEFECTO_MS);
});

test('429 en el autocompletado y éxito en el reintento: la búsqueda sigue y devuelve hoteles', async () => {
  const { r, n, esperas, eventos } = await ejecutar({ autocomplete: [[429, { error: 'Rate limit exceeded: too many requests per second.' }, { 'Retry-After': '2' }], [200, SUG]] });
  assert.equal(r.estado, 'ok');
  assert.equal(r.hoteles.length, 1);
  assert.equal(n.autocomplete, 2);
  assert.deepEqual(esperas, [2000]);
  const ev = eventos.find((e) => e.evento === 'reintento_429')!;
  assert.equal(ev.datos.proveedor, 'searchapi');
  assert.equal(ev.datos.fase, 'autocompletado');
  assert.equal(ev.datos.httpStatus, 429);
  assert.equal(ev.datos.retryAfter, '2');
});

test('429 persistente: exactamente UN reintento por etapa, y el error se informa tal cual (con HTTP, Retry-After y reintento)', async () => {
  const { r, n, esperas, eventos } = await ejecutar({ autocomplete: [[429, { error: 'Rate limit exceeded: too many requests per second.' }, { 'Retry-After': '1' }]] });
  assert.equal(n.autocomplete, 2, 'intento + un reintento, nunca más');
  assert.equal(n.booking, 0);
  assert.deepEqual(esperas, [1000]);
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.httpStatus, 429);
  assert.equal(r.retryAfter, '1');
  assert.equal(r.etapaError, 'autocompletado');
  assert.equal(r.codigoError, 'limite_peticiones');
  assert.match(r.error!, /reintentó una vez/);
  const err = eventos.find((e) => e.evento === 'error_proveedor')!;
  assert.deepEqual([err.datos.proveedor, err.datos.fase, err.datos.httpStatus, err.datos.codigo], ['searchapi', 'autocompletado', 429, 'limite_peticiones']);
});

test('429 con Retry-After excesivo o cuota agotada: sin reintento ni espera', async () => {
  const largo = await ejecutar({ autocomplete: [[429, { error: 'Rate limit exceeded' }, { 'Retry-After': '120' }]] });
  assert.equal(largo.n.autocomplete, 1);
  assert.deepEqual(largo.esperas, []);
  assert.equal(largo.r.estado, 'error_proveedor');
  assert.equal(largo.r.retryAfter, '120');

  const cuota = await ejecutar({ booking: [[429, { error: 'You have exhausted your monthly credits.' }]] });
  assert.equal(cuota.n.booking, 1);
  assert.deepEqual(cuota.esperas, []);
  assert.equal(cuota.r.codigoError, 'limite_uso');
});

test('429 en la búsqueda y éxito en el reintento; otros errores (500) no se reintentan', async () => {
  const ok = await ejecutar({ booking: [[429, {}], [200, HOTEL]] });
  assert.equal(ok.r.estado, 'ok');
  assert.equal(ok.n.booking, 2);
  assert.deepEqual(ok.esperas, [REINTENTO_429_ESPERA_POR_DEFECTO_MS]);

  const e500 = await ejecutar({ booking: [[500, { error: 'boom' }]] });
  assert.equal(e500.n.booking, 1);
  assert.equal(e500.r.estado, 'error_proveedor');
  assert.equal(e500.r.httpStatus, 500);
});
