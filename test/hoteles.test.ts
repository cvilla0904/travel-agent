import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aNumero,
  buscarHotelesConEstado,
  buscarHotelesSearchApi,
  HotelesProveedorError,
  resolverDestinoBooking,
} from '../src/services/searchapi.js';
import { hotelOutputSchema } from '../src/schemas/hotels.js';
import { codigoPaisDesdeDestino } from '../src/services/ciudades.js';

// Datos SIMULADOS con la forma documentada del motor booking; no son respuestas reales.
const sug = (title: string, label: string, id: string, type: string, cc: string) => ({
  title, label, dest_id: id, dest_type: type, country_code: cc,
});
const AUTOCOMPLETE: Record<string, unknown[]> = {
  Florence: [
    sug('Florence Hotel', 'Florence Hotel, Rome, Italy', '9', 'hotel', 'it'),
    sug('Florence', 'Florence, Tuscany, Italy', '-117543', 'city', 'it'),
    sug('Florence', 'Florence, Alabama, United States', '555', 'city', 'us'),
  ],
  Amsterdam: [sug('Amsterdam', 'Amsterdam, North Holland, Netherlands', '-2140479', 'city', 'nl')],
};
const FLORENCE_ORIGINAL = AUTOCOMPLETE.Florence;
const PROPS = [
  { title: 'Hotel A', hotel_class: '4', rating: '8,6', reviews: '1,234 reviews', extracted_price: 480, link: 'https://www.booking.com/hotel/a.html?x=1', currency: 'EUR', has_free_cancellation: true },
  { title: 'Hotel B', rating: 9.1, reviews: 50, price: '€ 1.200,50', link: 'https://www.booking.com/hotel/b.html' },
  { title: 'Hotel C sin precio', rating: 7, reviews: 10, link: 'https://www.booking.com/hotel/c.html' },
  { title: 'Hotel A duplicado', link: 'https://www.booking.com/hotel/a.html?y=2', extracted_price: 1 },
];

function fakeFetch(opciones: { propiedades?: unknown[]; cuerpoBusqueda?: unknown; estado?: number } = {}) {
  const llamadas: URL[] = [];
  const f = (async (input: URL) => {
    const url = new URL(String(input));
    llamadas.push(url);
    const motor = url.searchParams.get('engine');
    const responder = (cuerpo: unknown, status = 200) =>
      new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (motor === 'booking_autocomplete') return responder({ suggestions: AUTOCOMPLETE[url.searchParams.get('q')!] ?? [] });
    if (motor === 'booking') {
      if (opciones.estado) return responder(opciones.cuerpoBusqueda ?? { error: 'fallo' }, opciones.estado);
      return responder(opciones.cuerpoBusqueda ?? { properties: opciones.propiedades ?? PROPS });
    }
    return responder({}, 404);
  }) as unknown as typeof fetch;
  return { f, llamadas };
}
const base = { fechaEntrada: '2026-12-10', fechaSalida: '2026-12-13', adultos: 2 };
const dep = (f: typeof fetch) => ({ apiKey: 'test-key', fetch: f, registrar: () => {} });

test('destino 1: "Florencia" (español) resuelve a Florence/Italia y devuelve hoteles con precio y enlace', async () => {
  const { f, llamadas } = fakeFetch();
  const r = await buscarHotelesConEstado({ destino: 'Florencia, Italia', paisCodigo: 'it', ...base }, dep(f));
  assert.equal(r.estado, 'ok');
  assert.equal(r.error, null);
  const busqueda = llamadas.find((u) => u.searchParams.get('engine') === 'booking')!;
  assert.equal(busqueda.searchParams.get('dest_id'), '-117543');
  assert.equal(busqueda.searchParams.get('dest_type'), 'city');
  assert.equal(busqueda.searchParams.get('check_in_date'), '2026-12-10');
  assert.equal(r.hoteles.length, 3); // duplicado eliminado
  const a = r.hoteles[0]!;
  assert.equal(a.precioTotal, 480);
  assert.equal(a.precioPorNoche, 160);
  assert.equal(a.precioCalculado, true);
  assert.equal(a.valoracion, 8.6);
  assert.equal(a.valoracionEscala, 10);
  assert.equal(a.numeroResenas, 1234);
  assert.equal(a.estrellas, 4);
  assert.match(a.url, /^https:\/\/www\.booking\.com/);
  assert.equal(r.hoteles[1]!.precioTotal, 1200.5);
  assert.equal(r.hoteles[2]!.precioDisponible, false);
  assert.equal(r.diagnostico.conPrecio, 2);
  assert.equal(r.diagnostico.sinPrecio, 1);
});

test('destino 2: "Ámsterdam" y "Amsterdam" se resuelven igual (y la consulta al proveedor va sin tilde)', async () => {
  for (const nombre of ['Ámsterdam', 'Amsterdam', 'ámsterdam', 'Ámsterdam, Países Bajos']) {
    const { f, llamadas } = fakeFetch();
    const r = await buscarHotelesConEstado({ destino: nombre, ...base }, dep(f));
    assert.equal(r.estado, 'ok', `${nombre}: ${r.error}`);
    assert.equal(r.diagnostico.destinoResuelto, 'Amsterdam, North Holland, Netherlands', nombre);
    const auto = llamadas.find((u) => u.searchParams.get('engine') === 'booking_autocomplete')!;
    assert.equal(auto.searchParams.get('q'), 'Amsterdam', nombre);
    const busqueda = llamadas.find((u) => u.searchParams.get('engine') === 'booking')!;
    assert.equal(busqueda.searchParams.get('dest_id'), '-2140479', nombre);
    assert.ok(r.hoteles.length > 0, nombre);
  }
});

// Alabama va ANTES que Italia: solo el país del destino evita elegir la ciudad equivocada.
const FLORENCE_ALABAMA_PRIMERO = [
  sug('Florence', 'Florence, Alabama, United States', '555', 'city', 'us'),
  sug('Florence', 'Florence, Tuscany, Italy', '-117543', 'city', 'it'),
];

test('país en el destino ("Florencia, Italia") se usa para resolver la ciudad correcta', async () => {
  AUTOCOMPLETE.Florence = FLORENCE_ALABAMA_PRIMERO;
  try {
    for (const [destino, esperado] of [
      ['Florencia, Italia', '-117543'],
      ['Florencia, Italy', '-117543'],
      ['Florence, United States', '555'],
      ['Florence, Estados Unidos', '555'],
    ] as const) {
      const { f, llamadas } = fakeFetch();
      const r = await buscarHotelesConEstado({ destino, ...base }, dep(f)); // sin paisCodigo explícito
      assert.equal(r.estado, 'ok', `${destino}: ${r.error}`);
      const busqueda = llamadas.find((u) => u.searchParams.get('engine') === 'booking')!;
      assert.equal(busqueda.searchParams.get('dest_id'), esperado, destino);
    }
    // Sin país en el destino, queda la primera coincidencia (comportamiento anterior, ambiguo a propósito).
    assert.equal(resolverDestinoBooking(FLORENCE_ALABAMA_PRIMERO, 'Florencia')?.destId, '555');
  } finally {
    AUTOCOMPLETE.Florence = FLORENCE_ORIGINAL;
  }
});

test('el paisCodigo explícito prevalece sobre el país escrito en el destino', async () => {
  AUTOCOMPLETE.Florence = FLORENCE_ALABAMA_PRIMERO;
  try {
    const { f, llamadas } = fakeFetch();
    const r = await buscarHotelesConEstado({ destino: 'Florencia, Estados Unidos', paisCodigo: 'it', ...base }, dep(f));
    assert.equal(r.estado, 'ok');
    assert.equal(llamadas.find((u) => u.searchParams.get('engine') === 'booking')!.searchParams.get('dest_id'), '-117543');
  } finally {
    AUTOCOMPLETE.Florence = FLORENCE_ORIGINAL;
  }
});

test('si el país del destino no existe en Booking para esa ciudad -> error explícito, no otra ciudad', async () => {
  const { f } = fakeFetch();
  const r = await buscarHotelesConEstado({ destino: 'Florencia, Francia', ...base }, dep(f));
  assert.equal(r.estado, 'error_proveedor');
  assert.match(r.error!, /"fr"/);
});

test('si la búsqueda devuelve otro país distinto del pedido -> error explícito', async () => {
  const { f } = fakeFetch({ cuerpoBusqueda: { search_information: { destination: { country_code: 'us' } }, properties: PROPS } });
  const r = await buscarHotelesConEstado({ destino: 'Florencia, Italia', ...base }, dep(f));
  assert.equal(r.estado, 'error_proveedor');
  assert.match(r.error!, /país/);
});

test('codigoPaisDesdeDestino', () => {
  assert.equal(codigoPaisDesdeDestino('Florencia, Italia'), 'it');
  assert.equal(codigoPaisDesdeDestino('Ámsterdam, Países Bajos'), 'nl');
  assert.equal(codigoPaisDesdeDestino('Florencia'), undefined);
  assert.equal(codigoPaisDesdeDestino('Florencia, Narnia'), undefined);
});

test('no confunde Florence (Alabama) ni el hotel "Florence Hotel"', () => {
  const d = resolverDestinoBooking(AUTOCOMPLETE.Florence!, 'Florencia', 'it');
  assert.equal(d?.destId, '-117543');
  assert.equal(resolverDestinoBooking(AUTOCOMPLETE.Florence!, 'Florencia', 'fr'), null);
});

test('error HTTP 429 / 402 / 401 -> error_proveedor, nunca lista vacía "ok"', async () => {
  for (const estado of [429, 402, 401]) {
    const { f } = fakeFetch({ estado });
    const r = await buscarHotelesConEstado({ destino: 'Amsterdam', paisCodigo: 'nl', ...base }, dep(f));
    assert.equal(r.estado, 'error_proveedor', String(estado));
    assert.ok(r.error && r.error.includes(String(estado)));
  }
});

test('HTTP 200 con campo error -> error_proveedor (no sin_resultados)', async () => {
  const { f } = fakeFetch({ cuerpoBusqueda: { error: 'You have exhausted your credits.' } });
  const r = await buscarHotelesConEstado({ destino: 'Amsterdam', paisCodigo: 'nl', ...base }, dep(f));
  assert.equal(r.estado, 'error_proveedor');
  assert.match(r.error!, /exhausted/);
});

test('búsqueda sin propiedades -> sin_resultados (sin error)', async () => {
  const { f } = fakeFetch({ propiedades: [] });
  const r = await buscarHotelesConEstado({ destino: 'Amsterdam', paisCodigo: 'nl', ...base }, dep(f));
  assert.equal(r.estado, 'sin_resultados');
  assert.equal(r.error, null);
});

test('sin clave / fechas inválidas -> HotelesProveedorError', async () => {
  const { f } = fakeFetch();
  await assert.rejects(buscarHotelesSearchApi({ destino: 'Amsterdam', ...base }, { apiKey: '', fetch: f }), (e: unknown) => e instanceof HotelesProveedorError && e.codigo === 'configuracion');
  await assert.rejects(buscarHotelesSearchApi({ destino: 'Amsterdam', ...base, fechaSalida: '2026-12-10' }, dep(f)), (e: unknown) => e instanceof HotelesProveedorError && e.codigo === 'parametros');
  await assert.rejects(buscarHotelesSearchApi({ destino: 'Amsterdam', ...base, fechaEntrada: '10/12/2026' }, dep(f)), HotelesProveedorError);
});

test('destino no encontrado -> error explícito destino_no_verificado', async () => {
  const { f } = fakeFetch();
  const r = await buscarHotelesConEstado({ destino: 'Zzzland', ...base }, dep(f));
  assert.equal(r.estado, 'error_proveedor');
  assert.match(r.error!, /destino verificable/);
});

test('aNumero no devuelve NaN y entiende formatos', () => {
  assert.equal(aNumero('€ 1.234,50'), 1234.5);
  assert.equal(aNumero('1,234.50'), 1234.5);
  assert.equal(aNumero('8,6'), 8.6);
  assert.equal(aNumero('1,234 reviews'), 1234);
  assert.equal(aNumero('n/a'), null);
  assert.equal(aNumero(undefined), null);
});

test('la salida cumple el esquema Zod del agente (incl. error y diagnóstico)', async () => {
  const { f } = fakeFetch();
  const ok = await buscarHotelesConEstado({ destino: 'Florencia', paisCodigo: 'it', ...base }, dep(f));
  assert.doesNotThrow(() => hotelOutputSchema.parse(ok));
  const { f: f2 } = fakeFetch({ estado: 429 });
  const ko = await buscarHotelesConEstado({ destino: 'Amsterdam', paisCodigo: 'nl', ...base }, dep(f2));
  assert.doesNotThrow(() => hotelOutputSchema.parse(ko));
});

test('contrato estático: la herramienta usa buscarHotelesConEstado y no queda texto de Google Hotels', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /buscarHotelesConEstado\(\{ destino, fechaEntrada/);
  assert.doesNotMatch(src, /Google Hotels/);
  assert.doesNotMatch(src, /buscarHotelesSearchApi/);
});

test('UI: el parser de valoración admite /10 normalizado a /5', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const m = html.match(/const ratingMatch = text\.match\((\/.+\/i)\);/);
  assert.ok(m, 'regex de valoración no encontrada');
  const re = new RegExp(m![1]!.slice(1, -2), 'i');
  assert.equal(re.exec('Valoración 8,6/10 · 1.234 reseñas')![2], '10');
  assert.equal(re.exec('4,5/5')![2], '5');
  assert.match(html, /ratingMatch\[2\] === '10' \? 0\.5 : 1/);
});
