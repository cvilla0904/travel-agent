// Hoteles con ofertas de varios proveedores: normalización (proveedor, precio, enlace, impuestos, agrupación), tarjetas y Trip Builder.
// Prueba automatizada + interfaz en Chromium con /api/chat interceptado; el proveedor (Apify) está simulado: no se ejecuta ningún actor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { normalizarFilasApify } from '../src/services/hoteles-apify-normalizar.ts';
import { bloqueHoteles, bloqueVuelos, bloqueActividades, agruparBloques } from '../src/services/resultados-estructurados.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

/* ---------- filas del actor (forma real: bookingOptions con provider/nightlyPrice/totalStayPrice/bookingUrl) ---------- */
const NOCHES = 4;
const oferta = (provider: string, noche: number, extra: Record<string, unknown> = {}) =>
  ({ provider, nightlyPrice: noche, totalStayPrice: noche * NOCHES, bookingUrl: `https://www.${provider.toLowerCase().replace(/\W/g, '')}.com/adagio`, ...extra });
const fila = (name: string, ofertas: unknown[], extra: Record<string, unknown> = {}) => ({
  recordType: 'hotel', name, currency: 'EUR', category: 'Apartahotel', rating: 4.3, reviewsCount: 1704, hotelClass: 4,
  latitude: 50.8403, longitude: 4.3822, address: 'Rue Montoyer, Bruselas', hotelId: `id-${name}`, bookingOptions: ofertas, ...extra,
});
const normalizar = (filas: unknown[]) => normalizarFilasApify(filas, { noches: NOCHES });
const bloque = (filas: unknown[]) => bloqueHoteles({
  destino: 'Bruselas', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null,
  hoteles: normalizar(filas).hoteles, diagnostico: { sinPrecio: 0 },
});

const ADAGIO = fila('Adagio Access Brussels Europe', [oferta('Booking.com', 89), oferta('Expedia', 89), oferta('Hotels.com', 89), oferta('Agoda', 89)]);

test('hotel con varios proveedores: cada oferta conserva proveedor, importes, moneda, enlace e identificador propio', () => {
  const b = bloque([ADAGIO]);
  assert.equal(b.opciones.length, 1, 'un solo hotel con sus ofertas agrupadas');
  const h = b.opciones[0]!;
  assert.deepEqual(h.ofertas.map((o) => o.proveedor).sort(), ['Agoda', 'Booking.com', 'Expedia', 'Hotels.com']);
  assert.equal(new Set(h.ofertas.map((o) => o.id)).size, 4, 'ids de oferta distintos');
  for (const o of h.ofertas) {
    assert.equal(o.moneda, 'EUR');
    assert.equal(o.porNoche, 89);
    assert.equal(o.totalMostrado, 356, 'total de la estancia = 89 × 4 noches');
    assert.equal(o.porNocheMostrado, 89);
    assert.match(o.enlace!, /^https:\/\/www\./);
  }
  const expedia = h.ofertas.find((o) => o.proveedor === 'Expedia')!;
  assert.equal(expedia.enlace, 'https://www.expedia.com/adagio', 'el enlace es el de ESA oferta');
});

test('hotel con un solo proveedor', () => {
  const h = bloque([fila('Hotel Solo', [oferta('Booking.com', 120)])]).opciones[0]!;
  assert.equal(h.ofertas.length, 1);
  assert.equal(h.ofertas[0]!.proveedor, 'Booking.com');
  assert.equal(h.ofertas[0]!.porNocheMostrado, 120);
});

test('oferta sin enlace o sin precio: el normalizador la descarta (no se inventa nada) y se cuenta como inválida', () => {
  const r = normalizar([fila('Hotel Mixto', [oferta('Booking.com', 100), oferta('Agoda', 90, { bookingUrl: '' }), { provider: 'Expedia', bookingUrl: 'https://www.expedia.com/x' }])]);
  assert.deepEqual(r.hoteles[0]!.ofertas.map((o) => o.proveedor), ['Booking.com']);
  assert.equal(r.diagnostico.ofertasInvalidas, 2);
});

test('la estructura tolera una oferta sin enlace o sin precio (enlace/precio null, nunca inventados)', () => {
  const b = bloqueHoteles({
    destino: 'Bruselas', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null, diagnostico: null,
    hoteles: [{ nombre: 'Hotel X', precioDisponible: true, precioTotal: 400, precioPorNoche: 100, moneda: 'EUR', url: 'https://www.booking.com/x', ofertas: [
      { proveedor: 'Booking.com', url: 'https://www.booking.com/x', precioPorNocheSinImpuestos: 100, precioTotalSinImpuestos: 400, precioTotalConImpuestos: null },
      { proveedor: 'Agoda', url: '', precioPorNocheSinImpuestos: 95, precioTotalSinImpuestos: 380, precioTotalConImpuestos: null },
      { proveedor: 'Expedia', url: 'https://www.expedia.com/x' },
    ] }],
  });
  const [bk, ag, ex] = b.opciones[0]!.ofertas;
  assert.equal(ag!.enlace, null);
  assert.equal(ag!.porNocheMostrado, 95);
  assert.equal(ex!.totalMostrado, null);
  assert.equal(ex!.porNocheMostrado, null);
  assert.equal(ex!.moneda, null, 'sin importe no se atribuye moneda a la oferta');
  assert.equal(bk!.enlace, 'https://www.booking.com/x');
});

test('dos hoteles distintos con nombres parecidos NO se unen; el mismo hotel repetido (mismo id) sí', () => {
  const a = fila('Adagio Access Brussels Europe', [oferta('Booking.com', 89)]);
  const b2 = fila('Adagio Access Brussels Delta', [oferta('Booking.com', 95)], { hotelId: 'id-delta', latitude: 50.8189, longitude: 4.4000 });
  const mismoNombreOtraZona = fila('Adagio Access Brussels Europe', [oferta('Booking.com', 99)], { hotelId: undefined, placeId: undefined, latitude: 50.9, longitude: 4.5 });
  const sinIdA = fila('Hotel Sin Id', [oferta('Booking.com', 80)], { hotelId: undefined });
  const r = normalizar([a, b2, mismoNombreOtraZona, sinIdA, { ...sinIdA }, { ...a, bookingOptions: [oferta('Expedia', 90)] }]);
  const nombres = r.hoteles.map((h) => h.nombre);
  assert.equal(nombres.filter((n) => n === 'Adagio Access Brussels Europe').length, 2, 'mismo nombre y otra ubicación = otro alojamiento; mismo id = el mismo');
  assert.ok(nombres.includes('Adagio Access Brussels Delta'));
  assert.equal(nombres.filter((n) => n === 'Hotel Sin Id').length, 1, 'sin id: mismo nombre y coordenadas = duplicado');
  assert.equal(r.diagnostico.duplicadas, 2);
});

test('precios por noche y totales de la estancia; impuestos y monedas', () => {
  // Oferta con impuestos respaldados por Google: total con impuestos > total sin impuestos.
  const conImp = fila('Hotel Impuestos', [oferta('Booking.com', 100)], { lowestPrice: 100, lowestPriceProvider: 'Booking.com', totalPrice: 440, totalPriceBeforeTaxes: 400, taxesAndFees: 40 });
  const sinImp = fila('Hotel Sin Impuestos', [oferta('Booking.com', 100)]);
  const bam = fila('Hotel Bosnio', [oferta('Booking.com', 100)], { currency: 'BAM' });
  const b = bloque([conImp, sinImp, bam]);
  const por = (n: string) => b.opciones.find((h) => h.nombre === n)!.ofertas[0]!;
  assert.deepEqual([por('Hotel Impuestos').totalMostrado, por('Hotel Impuestos').impuestosIncluidos, por('Hotel Impuestos').porNocheMostrado], [440, true, 110]);
  assert.deepEqual([por('Hotel Sin Impuestos').totalMostrado, por('Hotel Sin Impuestos').impuestosIncluidos, por('Hotel Sin Impuestos').porNocheMostrado], [400, false, 100]);
  assert.equal(por('Hotel Bosnio').moneda, 'BAM');
  assert.equal(por('Hotel Impuestos').moneda, 'EUR');
});

test('sin noches válidas no se deriva ningún precio por noche', () => {
  const b = bloqueHoteles({ destino: 'X', fechaEntrada: '2027-01-17', fechaSalida: '2027-01-13', adultos: 2, estado: 'ok', error: null, diagnostico: null,
    hoteles: [{ nombre: 'H', precioDisponible: true, precioTotal: 400, precioPorNoche: 100, moneda: 'EUR', url: 'https://x.com/h', ofertas: [{ proveedor: 'Booking.com', url: 'https://x.com/h', precioPorNocheSinImpuestos: 100, precioTotalSinImpuestos: 400 }] }] });
  assert.equal(b.opciones[0]!.ofertas[0]!.porNocheMostrado, null);
  assert.equal(b.opciones[0]!.ofertas[0]!.totalMostrado, 400);
});

/* ---------- interfaz ---------- */
const DATOS = agruparBloques([
  bloqueVuelos({ origen: 'Madrid', destino: 'Bruselas', aeropuertoOrigen: 'MAD', aeropuertoDestino: 'BRU', fechaIda: '2027-01-13', fechaVuelta: '2027-01-17', pasajeros: 2, estado: 'ok', error: null, direccionesConError: [], avisos: [],
    vuelos: [{ aerolinea: 'Iberia', precioTotal: 300, precioPorPersona: 150, moneda: 'EUR', enlace: 'https://www.iberia.com/x', esIdaVuelta: true, tipo: 'Ida y vuelta', escalasIda: 0, escalasVuelta: 0, esDirecto: true, ida: null, vuelta: null }] }),
  bloque([ADAGIO, fila('Hotel Solo', [oferta('Booking.com', 120)], { hotelId: 'solo' }), fila('Hotel Otro Parecido', [oferta('Expedia', 95), oferta('Booking.com', 99)], { hotelId: 'otro' })]),
  bloqueActividades({ destino: 'Bruselas', tipos: [], estado: 'ok', mensaje: null, actividades: [{ nombre: 'Atomium', precio: 20, moneda: 'EUR', esGratis: false, plataforma: 'civitatis', url: 'https://www.civitatis.com/es/bruselas/atomium/' }] }),
]);

async function pagina(viewport = { width: 1280, height: 900 }) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await (await b.newContext({ viewport })).newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  await p.addInitScript('window.__name = (f) => f;');
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'Aquí tienes.', resultados: DATOS }) }));
  await p.goto(base + '/');
  await p.fill('#ideaViaje', 'Quiero viajar de Madrid a Bruselas del 13 al 17 de enero de 2027 para 2 personas');
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
  await p.waitForSelector('#panel-hoteles .hotel-card', { state: 'attached' });
  await p.click('#tab-hoteles');
  return { p, errores, cerrar: async () => { await b.close(); cerrar(); } };
}
const tarjeta = (p: any, nombre: string) => p.locator(`#panel-hoteles .hotel-card:has(.hotel-name:text-is("${nombre}"))`);
const panelItems = (p: any) => p.evaluate(() => [...document.querySelectorAll('#mogavel-trip-builder .mtb-item-copy')].map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

test('tarjeta: datos del hotel arriba y las cuatro ofertas agrupadas en «Compara ofertas»', { skip: omitir }, async () => {
  const t = await pagina();
  try {
    const c = tarjeta(t.p, 'Adagio Access Brussels Europe');
    assert.equal(await t.p.locator('#panel-hoteles .hotel-card').count(), 3, 'tres hoteles, sin duplicados');
    const top = await c.locator('.hotel-top').innerText();
    assert.match(top, /★★★★/); assert.match(top, /4,3\/5 \(1\.?704 reseñas\)/); assert.match(top, /Rue Montoyer/); assert.match(top, /89,00\s?€ \/ noche/);
    assert.match(await c.locator('.hotel-compare-title').innerText(), /Compara ofertas/i);
    const filas = await c.locator('.hotel-offer').evaluateAll((els: any[]) => els.map((e) => ({ proveedor: e.querySelector('.hotel-offer-provider').textContent, texto: e.innerText.replace(/\s+/g, ' '), href: e.querySelector('a')?.href })));
    assert.deepEqual(filas.map((f: any) => f.proveedor), ['Agoda', 'Booking.com', 'Expedia', 'Hotels.com'], 'mismo precio: orden estable por proveedor, ninguno preferido');
    for (const f of filas) { assert.match(f.texto, /89,00\s?€ \/ noche/); assert.match(f.texto, /356,00\s?€ total/); assert.match(f.texto, /sin impuestos/); assert.ok(f.href.startsWith('https://www.')); }
    assert.equal(await c.locator('.hotel-offer .mtb-select').count(), 4, 'un botón por oferta');
    assert.equal(await c.locator(':scope > .mtb-select').count(), 0, 'sin botón único de tarjeta cuando hay ofertas');
    // La tarjeta ocupa el ancho de su columna (no queda comprimida) y no desborda.
    const cajas = await t.p.evaluate(() => { const c = document.querySelector('#panel-hoteles .hotel-card')!.getBoundingClientRect(); const p = document.querySelector('#panel-hoteles')!.getBoundingClientRect(); return { c: c.width, p: p.width, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    assert.ok(cajas.c > cajas.p * 0.9, `tarjeta a ancho completo (${cajas.c} de ${cajas.p})`);
    assert.ok(cajas.sw <= cajas.cw);
    if (process.env.CAPTURAS) await t.p.locator('#panel-hoteles').screenshot({ path: path.join(process.env.CAPTURAS, 'hoteles-escritorio.png') });
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('Trip Builder: elegir Expedia guarda Expedia (no la primera ni la más barata) con proveedor, importes, moneda, enlace y fechas', { skip: omitir }, async () => {
  const t = await pagina();
  try {
    const c = tarjeta(t.p, 'Adagio Access Brussels Europe');
    await c.locator('.hotel-offer:has(.hotel-offer-provider:text-is("Expedia")) .mtb-select').click();
    const snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.equal(snap.length, 1);
    const h = snap[0];
    assert.equal(h.proveedor, 'Expedia');
    assert.equal(h.name, 'Adagio Access Brussels Europe');
    assert.deepEqual([h.moneda, h.precioNoche, h.precioTotal, h.impuestosIncluidos, h.entrada, h.salida], ['EUR', 89, 356, false, '2027-01-13', '2027-01-17']);
    assert.equal(h.enlace, 'https://www.expedia.com/adagio');
    assert.deepEqual(h.price, { value: 89, currency: 'EUR', basis: 'noche' });
    const items = await panelItems(t.p);
    assert.match(items[0]!, /Proveedor: Expedia/); assert.match(items[0]!, /356,00\s?€ total \(sin impuestos\)/); assert.match(items[0]!, /13\/01\/2027 → 17\/01\/2027/);
    assert.match(await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.contexto('Hola')), /proveedor elegido: Expedia/);
    // Persiste al recargar.
    await t.p.reload(); await t.p.waitForSelector('#mogavel-trip-builder .mtb-item');
    assert.equal((await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot()))[0].proveedor, 'Expedia');
  } finally { await t.cerrar(); }
});

test('Trip Builder: cambiar de proveedor sustituye la oferta sin duplicar el hotel; quitar y elegir otro también; un solo alojamiento', { skip: omitir }, async () => {
  const t = await pagina();
  try {
    const c = tarjeta(t.p, 'Adagio Access Brussels Europe');
    const boton = (p: string) => c.locator(`.hotel-offer:has(.hotel-offer-provider:text-is("${p}")) .mtb-select`);
    await boton('Booking.com').click();
    await boton('Agoda').click();
    let snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.deepEqual(snap.map((x: any) => x.proveedor), ['Agoda'], 'sustituye, no duplica');
    assert.equal(await boton('Agoda').getAttribute('aria-pressed'), 'true');
    assert.equal(await boton('Booking.com').getAttribute('aria-pressed'), 'false');
    // Quitar desde el panel y elegir otro proveedor.
    await t.p.click('#mogavel-trip-builder .mtb-remove');
    assert.equal((await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot())).length, 0);
    assert.equal(await boton('Agoda').getAttribute('aria-pressed'), 'false');
    await boton('Hotels.com').click();
    snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.deepEqual(snap.map((x: any) => x.proveedor), ['Hotels.com']);
    // Volver a pulsar la oferta elegida la desmarca.
    await boton('Hotels.com').click();
    assert.equal((await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot())).length, 0);
    // Otro hotel (nombre parecido) es otro alojamiento: sustituye al anterior, solo hay un alojamiento.
    await boton('Hotels.com').click();
    await tarjeta(t.p, 'Hotel Otro Parecido').locator('.hotel-offer:has(.hotel-offer-provider:text-is("Booking.com")) .mtb-select').click();
    snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.deepEqual(snap.map((x: any) => [x.name, x.proveedor]), [['Hotel Otro Parecido', 'Booking.com']]);
  } finally { await t.cerrar(); }
});

test('Trip Builder: vuelo + hotel + actividad conviven; el total no mezcla conceptos y el aviso se conserva', { skip: omitir }, async () => {
  const t = await pagina();
  try {
    await t.p.click('#tab-vuelos'); await t.p.click('#panel-vuelos .flight-card .mtb-select');
    await t.p.click('#tab-hoteles');
    await tarjeta(t.p, 'Hotel Solo').locator('.hotel-offer .mtb-select').click();
    await t.p.click('#tab-actividades'); await t.p.click('#panel-actividades .activity-card .mtb-select');
    const snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.deepEqual(snap.map((x: any) => x.kind), ['flight', 'hotel', 'activity']);
    const total = await t.p.locator('#mogavel-trip-builder .mtb-total').innerText();
    assert.match(total, /conceptos distintos/i, 'vuelo (total) + hotel (por noche) + actividad («desde») no se suman');
    assert.doesNotMatch(total, /monedas distintas/i, 'todas en EUR: no hay aviso de monedas');
    assert.equal(await t.p.locator('#mogavel-trip-builder .mtb-total').getAttribute('data-estado'), 'aviso');
  } finally { await t.cerrar(); }
});

test('hotel sin ofertas por proveedor: botón de tarjeta como antes y enlace de respaldo (sin presentarlo como oferta)', { skip: omitir }, async () => {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.setContent('<div id="results"></div>');
    await p.addScriptTag({ content: 'window.__name = (f) => f;' });
    await p.addScriptTag({ path: path.join(root, 'public/render-datos.js') });
    const r = await p.evaluate((d: any) => {
      const t = document.getElementById('results')!; (globalThis as any).MogavelDatos.renderizar(d, t);
      const c = t.querySelector('.hotel-card')!;
      return { ofertas: c.querySelectorAll('.hotel-offer').length, enlace: c.querySelector('a.hotel-link')?.getAttribute('href') || null, comparar: !!c.querySelector('.hotel-compare') };
    }, agruparBloques([bloqueHoteles({ destino: 'X', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null, diagnostico: null,
      hoteles: [{ nombre: 'Hotel Sin Ofertas', precioDisponible: false, urlGoogleHoteles: 'https://www.google.com/travel/hotels/x', ofertas: [] }] })]));
    assert.deepEqual(r, { ofertas: 0, enlace: 'https://www.google.com/travel/hotels/x', comparar: false });
  } finally { await b.close(); cerrar(); }
});

test('oferta sin precio o sin enlace: se muestra lo que hay, sin botón engañoso', { skip: omitir }, async () => {
  const { cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.setContent('<div id="results"></div>');
    await p.addScriptTag({ content: 'window.__name = (f) => f;' });
    await p.addScriptTag({ path: path.join(root, 'public/render-datos.js') });
    const datos = agruparBloques([bloqueHoteles({ destino: 'X', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null, diagnostico: null,
      hoteles: [{ nombre: 'Hotel X', precioDisponible: true, precioTotal: 400, precioPorNoche: 100, moneda: 'EUR', url: 'https://www.booking.com/x', ofertas: [
        { proveedor: 'Booking.com', url: 'https://www.booking.com/x', precioPorNocheSinImpuestos: 100, precioTotalSinImpuestos: 400 },
        { proveedor: 'Agoda', url: '', precioPorNocheSinImpuestos: 95, precioTotalSinImpuestos: 380 },
        { proveedor: 'Expedia', url: 'https://www.expedia.com/x' },
      ] }] })]);
    const r = await p.evaluate((d: any) => {
      const t = document.getElementById('results')!; (globalThis as any).MogavelDatos.renderizar(d, t);
      return [...t.querySelectorAll('.hotel-offer')].map((o: any) => ({ proveedor: o.dataset.proveedor, importe: o.dataset.importe ?? null, enlace: o.querySelector('a.hotel-offer-link')?.href || null, sinEnlace: !!o.querySelector('.hotel-no-link'), texto: o.innerText.replace(/\s+/g, ' ') }));
    }, datos);
    const por = (n: string) => r.find((x: any) => x.proveedor === n)!;
    assert.equal(por('Agoda').enlace, null); assert.equal(por('Agoda').sinEnlace, true); assert.equal(por('Agoda').importe, '95');
    assert.equal(por('Expedia').importe, null); assert.match(por('Expedia').texto, /Precio no disponible/); assert.ok(por('Expedia').enlace);
    assert.ok(por('Booking.com').enlace && por('Booking.com').importe === '100');
  } finally { await b.close(); cerrar(); }
});

test('móvil: tarjeta legible, ofertas apiladas y sin desbordamiento horizontal', { skip: omitir }, async () => {
  const t = await pagina({ width: 390, height: 844 });
  try {
    const m = await t.p.evaluate(() => {
      const c = document.querySelector('#panel-hoteles .hotel-card')!.getBoundingClientRect();
      const filas = [...document.querySelectorAll('#panel-hoteles .hotel-card:first-child .hotel-offer')].map((f) => { const r = f.getBoundingClientRect(); return { w: r.width, derecha: r.right }; });
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, c: c.width, filas, derechaTarjeta: c.right };
    });
    assert.ok(m.sw <= m.cw, 'sin desbordamiento horizontal');
    assert.ok(m.c > 300);
    for (const f of m.filas) assert.ok(f.derecha <= m.derechaTarjeta + 1, 'las ofertas caben en la tarjeta');
    if (process.env.CAPTURAS) await t.p.locator('#panel-hoteles').screenshot({ path: path.join(process.env.CAPTURAS, 'hoteles-movil.png') });
  } finally { await t.cerrar(); }
});
