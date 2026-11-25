// Tarjetas construidas desde datos estructurados (public/render-datos.js) y flujo real de /resultados.html en Chromium.
// /api/chat se intercepta con cuerpos {response, resultados} generados por las MISMAS funciones del servidor
// (bloqueVuelos/bloqueHoteles/bloqueActividades). Sin red externa; si no hay Chromium se omite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { bloqueVuelos, bloqueHoteles, bloqueActividades, agruparBloques } from '../src/services/resultados-estructurados.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

/* ---------- datos de herramienta (forma real de las salidas) ---------- */
const seg = (o: string, d: string, h1: string, h2: string, n: string) => ({
  aeropuertoSalida: o + ' Airport', codigoSalida: o, horaSalida: h1, aeropuertoLlegada: d + ' Airport', codigoLlegada: d, horaLlegada: h2,
  duracionMinutos: 145, aerolinea: 'Brussels Airlines', numeroVuelo: n,
});
const vueloRaw = (extra: Record<string, unknown> = {}) => ({
  aerolinea: 'Brussels Airlines', precioTotal: 240, precioPorPersona: 120, moneda: 'EUR', enlace: 'https://www.google.com/travel/flights?q=x', esIdaVuelta: true, tipo: 'Ida y vuelta',
  escalasIda: 0, escalasVuelta: 1, esDirecto: false,
  ida: { fecha: '2027-03-10', duracionMinutos: 145, segmentos: [seg('MAD', 'BRU', '08:05', '10:30', 'SN 3200')] },
  vuelta: { fecha: '2027-03-17', duracionMinutos: 300, segmentos: [seg('BRU', 'MAD', '11:00', '13:30', 'SN 3201')] }, ...extra,
});
const vuelosRaw = (vuelos: any[], estado = 'ok', extra: Record<string, unknown> = {}) => ({
  origen: 'Madrid', destino: 'Bruselas', aeropuertoOrigen: 'MAD', aeropuertoDestino: 'BRU', fechaIda: '2027-03-10', fechaVuelta: '2027-03-17', pasajeros: 2,
  estado, error: null, direccionesConError: [], avisos: [], vuelos, ...extra,
});
const hotelRaw = (nombre: string, extra: Record<string, unknown> = {}) => ({
  nombre, estrellas: 4, valoracion: 9, valoracionEscala: 10, numeroResenas: 800, precioTotal: 400, precioPorNoche: 100, moneda: 'EUR', precioDisponible: true,
  precioCalculado: false, url: 'https://www.booking.com/hotel/' + encodeURIComponent(nombre), ...extra,
});
const hotelesRaw = (hoteles: any[], estado = 'ok', extra: Record<string, unknown> = {}) => ({
  destino: 'Bruselas', fechaEntrada: '2027-03-10', fechaSalida: '2027-03-14', adultos: 2, estado, error: null, hoteles, diagnostico: { sinPrecio: 0 }, ...extra,
});
const actRaw = (nombre: string, extra: Record<string, unknown> = {}) => ({
  nombre, precio: 20, moneda: 'EUR', esGratis: false, plataforma: 'civitatis', url: 'https://www.civitatis.com/es/' + encodeURIComponent(nombre), duracion: '2 h', ...extra,
});
const actividadesRaw = (actividades: any[], estado = 'ok', extra: Record<string, unknown> = {}) => ({
  destino: 'Bruselas', tipos: [], estado, mensaje: null, actividades, ...extra,
});

const DATOS = agruparBloques([
  bloqueVuelos(vuelosRaw([vueloRaw(), vueloRaw({ aerolinea: 'Iberia', precioTotal: 300, moneda: 'USD', enlace: 'https://www.iberia.com/x' }), vueloRaw({ aerolinea: 'Vueling', precioTotal: 280, moneda: '', enlace: '' })])),
  bloqueHoteles(hotelesRaw([
    hotelRaw('Hotel Grand', { valoracion: 9.2, numeroResenas: 2000 }),
    hotelRaw('Hotel Barato', { precioPorNoche: 40, precioTotal: 160, valoracion: 8, numeroResenas: 90 }),
    hotelRaw('Hotel Sin Valoración', { valoracion: null, numeroResenas: null, estrellas: null }),
    hotelRaw('Hotel Sin Precio', { precioDisponible: false, precioTotal: 0, precioPorNoche: 0, valoracion: 7, numeroResenas: 10 }),
    hotelRaw('Hotel Bosnio', { moneda: 'BAM', precioPorNoche: 200 }),
  ]), 'apify'),
  bloqueActividades(actividadesRaw([
    actRaw('Atomium'), actRaw('Tour USD', { precio: 30, moneda: 'USD' }), actRaw('Sin precio', { precio: null, moneda: '' }), actRaw('Tour gratis', { precio: null, esGratis: true }),
  ])),
]);

async function nueva() {
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await b.newPage();
  await p.setContent('<div id="res"></div>');
  // Con tsx (esbuild keepNames) las funciones con nombre dentro de page.evaluate llaman a __name: se define en la página.
  await p.addScriptTag({ content: 'window.__name = (f) => f;' });
  await p.addScriptTag({ path: path.join(root, 'public/render-datos.js') });
  return { b, p };
}
const pinta = (p: any, datos: unknown) => p.evaluate((d: any) => {
  const t = document.getElementById('res')!; (globalThis as any).MogavelDatos.renderizar(d, t);
  const txt = (e: Element | null) => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  return {
    vuelos: [...t.querySelectorAll('.flight-card')].map((c: any) => ({ aerolinea: txt(c.querySelector('.flight-airline')), precio: txt(c.querySelector('.flight-price')), texto: txt(c), url: c.dataset.url || null, moneda: c.dataset.moneda || null, importe: c.dataset.importe || null, sinEnlace: !!c.querySelector('.flight-no-link') })),
    hoteles: [...t.querySelectorAll('.hotel-card')].map((c: any) => ({ nombre: txt(c.querySelector('.hotel-name')), detalle: txt(c.querySelector('.hotel-detail')), grupo: txt(c.closest('.hotel-category')?.querySelector('.hotel-category-title') ?? null), moneda: c.dataset.moneda || null, sinEnlace: !!c.querySelector('.hotel-no-link') })),
    actividades: [...t.querySelectorAll('.activity-card')].map((c: any) => ({ nombre: txt(c.querySelector('.activity-name')), badge: txt(c.querySelector('.activity-price-badge')), moneda: c.dataset.moneda || null, enlace: !!c.querySelector('a') })),
    notas: [...t.querySelectorAll('.estado-bloque')].map((n: any) => ({ estado: n.dataset.estado, texto: txt(n) })),
    html: t.innerHTML,
  };
}, datos);

test('vuelos: una tarjeta por opción, IATA, moneda del dato (EUR/USD/sin moneda) y enlace real', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const r = await pinta(p, DATOS);
    assert.equal(r.vuelos.length, DATOS.vuelos[0]!.total);
    const [bru, ib, vu] = r.vuelos;
    assert.match(bru!.texto, /MAD\)|\(MAD/);
    assert.match(bru!.texto, /\(BRU\)/);
    assert.match(bru!.texto, /08:05/);
    assert.match(bru!.precio, /240/); assert.match(bru!.precio, /€/);
    assert.equal(bru!.moneda, 'EUR');
    assert.match(ib!.precio, /300/); assert.doesNotMatch(ib!.precio, /€/); assert.equal(ib!.moneda, 'USD');
    assert.match(vu!.precio, /280/); assert.match(vu!.precio, /moneda no confirmada/); assert.equal(vu!.moneda, null);
    assert.equal(bru!.url, 'https://www.google.com/travel/flights?q=x');
    assert.equal(vu!.sinEnlace, true);
    assert.match(bru!.texto, /Directo/); assert.match(bru!.texto, /1 escala/);
  } finally { await b.close(); }
});

test('hoteles: todas las opciones, cada una en UNA categoría, sin valoración≠0, sin precio≠0 y moneda propia (BAM)', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const r = await pinta(p, DATOS);
    assert.equal(r.hoteles.length, 5);
    assert.equal(new Set(r.hoteles.map((h: any) => h.nombre)).size, 5);
    const por = (n: string) => r.hoteles.find((h: any) => h.nombre === n)!;
    assert.equal(por('Hotel Grand').grupo, 'Alojamientos recomendados');
    assert.equal(por('Hotel Barato').grupo, 'Alojamientos económicos');
    assert.match(por('Hotel Sin Valoración').detalle, /Sin valoración/);
    assert.doesNotMatch(por('Hotel Sin Valoración').detalle, /\b0\/|★/);
    assert.notEqual(por('Hotel Sin Valoración').grupo, 'Alojamientos recomendados');
    assert.match(por('Hotel Sin Precio').detalle, /Precio no disponible/);
    assert.doesNotMatch(por('Hotel Sin Precio').detalle, /0,00|€/);
    assert.equal(por('Hotel Sin Precio').moneda, null);
    assert.equal(por('Hotel Bosnio').moneda, 'BAM');
    assert.doesNotMatch(por('Hotel Bosnio').detalle, /€/);
    assert.match(por('Hotel Grand').detalle, /9,2\/10 \(2\.?000 reseñas\)/);
  } finally { await b.close(); }
});

test('actividades: DESDE con su moneda, GRATUITA solo si el proveedor lo dice y sin precio = «no disponible»', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const r = await pinta(p, DATOS);
    assert.equal(r.actividades.length, 4);
    const por = (n: string) => r.actividades.find((a: any) => a.nombre === n)!;
    assert.match(por('Atomium').badge, /^DESDE .*20.*€/);
    assert.match(por('Tour USD').badge, /^DESDE/); assert.doesNotMatch(por('Tour USD').badge, /€/); assert.equal(por('Tour USD').moneda, 'USD');
    assert.equal(por('Sin precio').badge, 'PRECIO NO DISPONIBLE');
    assert.equal(por('Tour gratis').badge, 'GRATUITA');
    assert.ok(r.actividades.every((a: any) => a.enlace));
    assert.doesNotMatch(r.html, /tiqets/i);
  } finally { await b.close(); }
});

test('estados: error del proveedor ≠ sin resultados ≠ parcial; ninguno inventa tarjetas', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const datos = agruparBloques([
      bloqueVuelos(vuelosRaw([], 'error_proveedor', { error: 'Apify no responde' })),
      bloqueHoteles(hotelesRaw([], 'sin_resultados'), 'searchapi'),
      bloqueActividades(actividadesRaw([actRaw('Atomium')], 'parcial', { mensaje: 'La ejecución sigue en marcha.' })),
    ]);
    const r = await pinta(p, datos);
    assert.deepEqual([r.vuelos.length, r.hoteles.length, r.actividades.length], [0, 0, 1]);
    const nota = (e: string) => r.notas.filter((n: any) => n.estado === e).map((n: any) => n.texto).join(' ');
    assert.match(nota('error_proveedor'), /No se han podido consultar los vuelos.*Apify no responde.*no significa que no existan/);
    assert.match(nota('sin_resultados'), /respondió sin opciones/);
    assert.match(nota('parcial'), /parciales|sigue en marcha/);
    assert.doesNotMatch(nota('error_proveedor'), /Sin vuelos/);
  } finally { await b.close(); }
});

test('multidestino: varias ciudades → una sección por ciudad con su título y sus tarjetas', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const datos = agruparBloques([
      bloqueActividades(actividadesRaw([actRaw('Atomium')], 'ok', { destino: 'Bruselas' })),
      bloqueActividades(actividadesRaw([actRaw('Puente Latino'), actRaw('Baščaršija')], 'ok', { destino: 'Sarajevo' })),
    ]);
    const r = await p.evaluate((d: any) => {
      const t = document.getElementById('res')!; (globalThis as any).MogavelDatos.renderizar(d, t);
      return [...t.querySelectorAll('.multicity-section')].map((s: any) => ({ titulo: s.querySelector('.multicity-title').textContent, n: s.querySelectorAll('.activity-card').length }));
    }, datos);
    assert.deepEqual(r, [{ titulo: 'Bruselas', n: 1 }, { titulo: 'Sarajevo', n: 2 }]);
  } finally { await b.close(); }
});

test('seguridad: textos con HTML se muestran como texto y los enlaces no http(s) se descartan', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    const datos = agruparBloques([bloqueActividades(actividadesRaw([actRaw('<img src=x onerror=alert(1)>', { url: 'javascript:alert(1)' })]))]);
    const r = await pinta(p, datos);
    assert.equal(r.actividades.length, 1);
    assert.equal(r.actividades[0]!.enlace, false);
    assert.ok(!/<img/i.test(r.html.replace(/&lt;img/g, '')), 'el HTML del proveedor no se interpreta');
  } finally { await b.close(); }
});

/* ---------- flujo real de la página con datos estructurados ---------- */

async function pagina(respuestas: Array<{ response: string; resultados: unknown; aviso?: string }>) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  await p.addInitScript('window.__name = (f) => f;');
  const cola = [...respuestas];
  const peticiones: any[] = [];
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => {
    peticiones.push(JSON.parse(r.request().postData() || '{}'));
    const n = cola.length > 1 ? cola.shift()! : cola[0]!;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(n) });
  });
  await p.goto(base + '/');
  await p.fill('#ideaViaje', 'Quiero viajar de Madrid a Bruselas del 10 al 17 de marzo de 2027 para 2 personas');
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
  await p.waitForSelector('#panel-vuelos .flight-card');
  return { p, errores, peticiones, cerrar: async () => { await b.close(); cerrar(); } };
}
const cuenta = (p: any, s: string) => p.evaluate((x: string) => document.querySelectorAll(x).length, s);
const chip = (p: any, t: string) => p.evaluate((x: string) => document.querySelector(`[data-count="${x}"]`)!.textContent, t);

test('página: tarjetas, contadores y texto explicativo salen de los datos (no del markdown) y no se duplican', { skip: omitir }, async () => {
  // El texto del modelo, aunque repita listas con formato distinto, no puede cambiar ni duplicar las tarjetas.
  const texto = 'He buscado vuelos y alojamiento en Bruselas.\n\n### Vuelos\n- Formato inventado que antes rompía el parseo\n\n### Alojamientos\n- **Otro hotel inventado** — 1 €\n\nElige lo que prefieras.';
  const t = await pagina([{ response: texto, resultados: DATOS }]);
  try {
    assert.equal(await cuenta(t.p, '#panel-vuelos .flight-card'), 3);
    assert.equal(await cuenta(t.p, '#panel-hoteles .hotel-card'), 5);
    assert.equal(await cuenta(t.p, '#panel-actividades .activity-card'), 4);
    assert.deepEqual([await chip(t.p, 'vuelos'), await chip(t.p, 'hoteles'), await chip(t.p, 'actividades')], ['3', '5', '4']);
    const conv = await t.p.evaluate(() => (document.getElementById('conversacion') as HTMLElement).innerText);
    assert.match(conv, /He buscado vuelos y alojamiento en Bruselas/);
    assert.match(conv, /Elige lo que prefieras/);
    assert.doesNotMatch(conv, /Otro hotel inventado|Formato inventado/, 'las listas duplicadas del modelo se quitan de la explicación');
    assert.equal(await cuenta(t.p, 'article.hotel-card:has(.hotel-name)'), 5);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('página: «Añadir a mi viaje» usa la moneda real del dato y respeta la base del precio', { skip: omitir }, async () => {
  const t = await pagina([{ response: 'Aquí tienes.', resultados: DATOS }]);
  try {
    await t.p.click('#panel-vuelos .flight-card:nth-child(2) .mtb-select');   // Iberia USD
    await t.p.click('#tab-hoteles'); await t.p.click('#panel-hoteles .hotel-card:has-text("Hotel Bosnio") .mtb-select');
    await t.p.click('#tab-actividades'); await t.p.click('#panel-actividades .activity-card:has-text("Tour USD") .mtb-select');
    await t.p.click('#panel-actividades .activity-card:has-text("Sin precio") .mtb-select');
    const items = await t.p.evaluate(() => [...document.querySelectorAll('#mogavel-trip-builder .mtb-item-copy')].map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    assert.equal(items.length, 4);
    assert.match(items[0]!, /Iberia/); assert.match(items[0]!, /300/); assert.doesNotMatch(items[0]!, /€/);
    assert.match(items[1]!, /Hotel Bosnio/); assert.match(items[1]!, /por noche/); assert.doesNotMatch(items[1]!, /€/);
    assert.match(items[2]!, /Desde/); assert.doesNotMatch(items[2]!, /€/);
    assert.match(items[3]!, /Precio por confirmar/);
    const snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.deepEqual(snap.map((x: any) => x.price && x.price.currency), ['USD', 'BAM', 'USD', null]);
    const ctx = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.contexto('Hola'));
    assert.match(ctx, /300 USD/); assert.match(ctx, /BAM por noche/);
  } finally { await t.cerrar(); }
});

test('página: un seguimiento sin búsquedas no borra los resultados y uno de hoteles solo sustituye los hoteles; los contadores siguen los datos', { skip: omitir }, async () => {
  const nuevosHoteles = agruparBloques([bloqueHoteles(hotelesRaw([hotelRaw('Hotel Nuevo')]), 'searchapi')]);
  const t = await pagina([
    { response: 'Primera.', resultados: DATOS },
    { response: 'Solo conversación.', resultados: { version: 1, vuelos: [], hoteles: [], actividades: [] } },
    { response: 'Otros hoteles.', resultados: nuevosHoteles },
  ]);
  try {
    const enviar = async (m: string) => { const antes = await cuenta(t.p, '.conv-agente'); await t.p.fill('#chatMessage', m); await t.p.click('#enviarSeguimiento'); await t.p.waitForFunction((n: number) => document.querySelectorAll('.conv-agente').length >= n, antes + 1); };
    await enviar('¿Cuál es mejor?');
    assert.deepEqual([await cuenta(t.p, '.flight-card'), await cuenta(t.p, '.hotel-card'), await cuenta(t.p, '.activity-card')], [3, 5, 4]);
    await enviar('Busca otros hoteles');
    assert.deepEqual([await cuenta(t.p, '.flight-card'), await cuenta(t.p, '.hotel-card'), await cuenta(t.p, '.activity-card')], [3, 1, 4]);
    assert.deepEqual([await chip(t.p, 'vuelos'), await chip(t.p, 'hoteles'), await chip(t.p, 'actividades')], ['3', '1', '4']);
    // Recarga: las pestañas se reconstruyen con los últimos datos de cada tipo.
    await t.p.reload(); await t.p.waitForSelector('#panel-vuelos .flight-card');
    assert.deepEqual([await cuenta(t.p, '.flight-card'), await cuenta(t.p, '.hotel-card'), await cuenta(t.p, '.activity-card')], [3, 1, 4]);
    assert.equal(t.peticiones.length, 3, 'la recarga no repite búsquedas');
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('página: aviso del servidor (resultados sin explicación) se muestra y las tarjetas se conservan', { skip: omitir }, async () => {
  const t = await pagina([{ response: '', resultados: DATOS, aviso: 'Se han obtenido los resultados de los proveedores, pero no se ha podido redactar la explicación.' }]);
  try {
    assert.equal(await cuenta(t.p, '.flight-card'), 3);
    assert.match(await t.p.evaluate(() => (document.getElementById('estado') as HTMLElement).innerText), /no se ha podido redactar/);
  } finally { await t.cerrar(); }
});

/* ---------- despliegue: todo recurso estático referenciado debe estar publicado ---------- */

test('vercel.json publica (build + ruta) cada script y hoja de estilo que cargan las páginas HTML', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const builds = new Set(v.builds.map((b: any) => b.src));
  const rutas = new Map(v.routes.map((r: any) => [r.src, r.dest]));
  for (const html of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
    const src = fs.readFileSync(path.join(root, html), 'utf8');
    for (const m of src.matchAll(/(?:src|href)="(\/[\w-]+\.(?:js|css))"/g)) {
      const ruta = m[1]!;
      const dest = rutas.get(ruta) as string | undefined;
      assert.ok(dest, `${html}: ${ruta} sin ruta en vercel.json (caería en index.html)`);
      assert.ok(builds.has(dest.slice(1)), `${html}: ${ruta} → ${dest} no está en builds`);
      assert.ok(fs.existsSync(path.join(root, dest.slice(1))), `${dest} no existe`);
    }
  }
  const chat = v.builds.find((b: any) => b.src === 'api/chat.ts');
  assert.ok(chat.config.maxDuration >= 120, 'api/chat.ts necesita maxDuration suficiente para vuelos + hoteles + actividades');
});
