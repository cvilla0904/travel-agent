// Valoraciones de hoteles: el rating del actor llega tal cual (sin inventar), la categoría (hotelClass) no se convierte en
// valoración, se conserva el número de reseñas y cada búsqueda registra cuántas filas del actor traen rating.
// Datos: los datasets reales guardados como fixtures (Budapest y Colombia). Sin red ni créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { normalizarFilasApify } from '../src/services/hoteles-apify-normalizar.ts';
import { buscarHotelesApifyConEstado } from '../src/services/apify-hoteles.ts';
import { bloqueHoteles } from '../src/services/resultados-estructurados.ts';

const leer = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')) as any[];
const BUDAPEST = leer('hoteles-apify-budapest.json');
const COLOMBIA = leer('hoteles-apify-colombia.json');
const fila = (extra: Record<string, unknown>) => ({
  recordType: 'hotel', name: 'Hotel de prueba', hotelId: 'h1', category: 'Hotel', pricePerNight: 100, totalPrice: 400, currency: 'EUR',
  bookingOptions: [], ...extra,
});
const uno = (extra: Record<string, unknown>) => normalizarFilasApify([fila(extra)], { noches: 4, limite: 5 }).hoteles[0]!;

/* ---------- normalización ---------- */

test('rating disponible: se conserva tal cual con su escala y el número de reseñas', () => {
  const h = uno({ rating: 4.7, reviewsCount: 3821 });
  assert.equal(h.valoracion, 4.7);
  assert.equal(h.valoracionEscala, 5);
  assert.equal(h.numeroResenas, 3821);
  const s = uno({ rating: 8.6, reviewsCount: 120 });
  assert.equal(s.valoracionEscala, 10, 'una valoración sobre 10 se reconoce como tal');
});

test('rating nulo: valoración null (no 0 ni inventada)', () => {
  for (const rating of [null, undefined, 0, '', 'n/d']) {
    const h = uno({ rating });
    assert.equal(h.valoracion, null, `rating=${JSON.stringify(rating)}`);
    assert.equal(h.valoracionEscala, null);
  }
});

test('hotel con categoría (hotelClass) pero sin rating: las estrellas se conservan y NO se convierten en valoración', () => {
  const h = uno({ hotelClass: 4, rating: null, reviewsCount: null });
  assert.equal(h.estrellas, 4);
  assert.equal(h.valoracion, null);
  assert.equal(h.valoracionEscala, null);
  assert.equal(h.numeroResenas, null);
});

test('número de reseñas disponible aunque no haya rating: se conserva', () => {
  const h = uno({ rating: null, reviewsCount: 30 });
  assert.equal(h.valoracion, null);
  assert.equal(h.numeroResenas, 30);
});

test('dataset real de Budapest: 8 de 10 filas con categoría y sin rating; ninguna estrella se convierte en valoración', () => {
  const { hoteles, diagnostico } = normalizarFilasApify(BUDAPEST, { noches: 4, limite: 20 });
  assert.equal(hoteles.length, 10);
  assert.equal(hoteles.filter((h) => h.valoracion !== null).length, 2);
  assert.equal(hoteles.filter((h) => h.valoracion === null && h.estrellas !== null).length, 8);
  assert.deepEqual(
    [diagnostico.filasHotel, diagnostico.filasConRating, diagnostico.filasSinRating, diagnostico.filasConEstrellasSinRating, diagnostico.filasConResenas],
    [10, 2, 8, 8, 2],
  );
});

test('dataset real de Colombia: el diagnóstico cuenta 39 con rating de 40', () => {
  const { diagnostico } = normalizarFilasApify(COLOMBIA, { noches: 4, limite: 100 });
  assert.equal(diagnostico.filasHotel, 40);
  assert.equal(diagnostico.filasConRating, 39);
  assert.equal(diagnostico.filasSinRating, 1);
  assert.equal(diagnostico.filasConRating + diagnostico.filasSinRating, diagnostico.filasHotel);
});

test('el diagnóstico cuenta las filas recibidas del actor, también las que luego se descartan por ubicación', () => {
  const lejos = fila({ name: 'Hotel lejano', hotelId: 'h2', rating: 4.5, latitude: 10, longitude: 10, countryCode: 'ES' });
  const { hoteles, diagnostico } = normalizarFilasApify([lejos, fila({ rating: null })], { noches: 4, paisCodigo: 'BE', limite: 5 });
  assert.equal(diagnostico.filasHotel, 2);
  assert.equal(diagnostico.filasConRating, 1, 'la fila descartada por país también cuenta como recibida');
  assert.equal(diagnostico.filasSinRating, 1);
  assert.ok(hoteles.length <= 2);
});

/* ---------- registro de diagnóstico de una búsqueda ---------- */

test('la búsqueda registra cuántos hoteles del actor traen rating y cuántos no (log busqueda_completada)', async () => {
  const eventos: { evento: string; datos: any }[] = [];
  const cliente = {
    actor: () => ({ call: async () => ({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' }) }),
    dataset: () => ({ listItems: async () => ({ items: BUDAPEST }) }),
  };
  const r = await buscarHotelesApifyConEstado(
    { destino: 'Budapest, Hungría', fechaEntrada: '2027-01-04', fechaSalida: '2027-01-08', adultos: 2 },
    { crearCliente: () => cliente, token: 'token-de-prueba', registrar: (evento: string, datos: any) => eventos.push({ evento, datos }), env: {} } as any,
  );
  assert.equal(r.estado, 'ok');
  const fin = eventos.find((e) => e.evento === 'busqueda_completada');
  assert.ok(fin, 'se registra busqueda_completada');
  assert.equal(fin!.datos.filasConRating, 2);
  assert.equal(fin!.datos.filasSinRating, 8);
  assert.equal(fin!.datos.filasConEstrellasSinRating, 8);
  assert.equal(r.diagnosticoApify!.filasSinRating, 8);
});

/* ---------- presentación en la tarjeta (Chromium real, render-datos.js) ---------- */

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

const hotelRaw = (nombre: string, extra: Record<string, unknown>) => ({
  nombre, estrellas: null, valoracion: null, valoracionEscala: null, numeroResenas: null, precioTotal: 332, precioPorNoche: 83, moneda: 'EUR',
  precioDisponible: true, precioCalculado: false, url: 'https://www.booking.com/hotel/' + encodeURIComponent(nombre), ...extra,
});
const DATOS = { version: 1, vuelos: [], actividades: [], hoteles: [bloqueHoteles({
  destino: 'Bruselas', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null, diagnostico: { sinPrecio: 0 },
  hoteles: [
    hotelRaw('Hotel Con Valoración', { valoracion: 8.6, valoracionEscala: 10, numeroResenas: 1200, estrellas: 4 }),
    hotelRaw('Hotel Solo Estrellas', { estrellas: 4 }),
    hotelRaw('Hotel Solo Reseñas', { numeroResenas: 30 }),
    hotelRaw('Hotel Sin Datos', {}),
  ],
})] };

test('tarjetas: rating real con reseñas; sin rating «Sin valoración del proveedor»; estrellas aparte; reseñas conservadas', { skip: omitir }, async () => {
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.setContent('<div id="res"></div>');
    await p.addScriptTag({ content: 'window.__name = (f) => f;' });
    await p.addScriptTag({ path: path.join(root, 'public/render-datos.js') });
    const detalle: Record<string, string> = await p.evaluate((d: any) => {
      (globalThis as any).MogavelDatos.renderizar(d, document.getElementById('res'));
      const o: Record<string, string> = {};
      document.querySelectorAll('.hotel-card').forEach((c: any) => { o[c.querySelector('.hotel-name').textContent.trim()] = c.querySelector('.hotel-top').textContent.replace(/\s+/g, ' ').trim(); });
      return o;
    }, DATOS);
    assert.match(detalle['Hotel Con Valoración']!, /8,6\/10 \(1\.?200 reseñas\)/);
    assert.doesNotMatch(detalle['Hotel Con Valoración']!, /Sin valoración/);
    assert.match(detalle['Hotel Solo Estrellas']!, /★★★★/);
    assert.match(detalle['Hotel Solo Estrellas']!, /Sin valoración del proveedor/);
    assert.doesNotMatch(detalle['Hotel Solo Estrellas']!, /\d\/10|\d\/5/, 'las estrellas no se muestran como valoración de usuarios');
    assert.match(detalle['Hotel Solo Reseñas']!, /Sin valoración del proveedor \(30 reseñas\)/);
    assert.match(detalle['Hotel Sin Datos']!, /Sin valoración del proveedor/);
    assert.doesNotMatch(detalle['Hotel Sin Datos']!, /reseñas|★/);
  } finally { await b.close(); }
});
