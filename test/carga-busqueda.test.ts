// Pantalla de carga de /resultados.html: estados honestos (buscando ≠ sin resultados), en Chromium,
// con respuestas FICTICIAS del agente retenidas a voluntad. Sin red externa.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

const CON_TODO = `## Madrid → Roma
**Fechas:** 2027-01-11 – 2027-01-18
**Viajeros:** 2

### Vuelos
- **Aerolínea Alfa**: 240 € | Directo | [Ver búsqueda](https://www.google.com/travel/flights?q=alfa&hl=es)

### Alojamientos
- **Hotel Ficticio Centro** — 120 € por noche — [Ver alojamiento](https://example.test/h1)
`;
const SIN_ACTIVIDADES = CON_TODO;
const SIN_NADA = `No he encontrado opciones para esa búsqueda.`;

async function montar(viewport = { width: 1280, height: 900 }) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  let liberar!: (v: { status?: number; texto?: string }) => void;
  const puerta = new Promise<{ status?: number; texto?: string }>((r) => { liberar = r; });
  let llamadas = 0;
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', async (r: any) => {
    llamadas++;
    const n = await puerta;
    r.fulfill({ status: n.status || 200, contentType: 'application/json', body: JSON.stringify(n.status && n.status >= 400 ? { error: 'Fallo simulado' } : { response: n.texto }) });
  });
  return { p, base, errores, liberar, llamadas: () => llamadas, cerrar: async () => { await b.close(); cerrar(); } };
}

async function lanzar(p: any, base: string, modo?: string) {
  await p.goto(base + '/');
  await p.fill('#ideaViaje', 'Quiero viajar de Madrid a Roma del 11 al 18 de enero de 2027 para 2 personas');
  if (modo) await p.click(`.search-tab[data-mode="${modo}"]`);
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
}

const estados = (p: any) => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#carga [data-recurso]')].map((e) => [e.getAttribute('data-recurso'), [e.getAttribute('data-estado'), (e.querySelector('.carga-estado') as HTMLElement).textContent]])));
const cargaVisible = (p: any) => p.evaluate(() => { const c = document.getElementById('carga')!; return !c.hidden && getComputedStyle(c).display !== 'none'; });

test('modelo: estadoRecursos distingue buscando, sin resultados, error y no solicitado', () => {
  const ctx: any = { window: {}, document: {} };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'public/carga-busqueda.js'), 'utf8'), ctx);
  const { estadoRecursos, recursosDelModo } = ctx.MogavelCarga;
  assert.deepEqual({ ...estadoRecursos('complete', 'buscando') }, { vuelos: 'buscando', hoteles: 'buscando', actividades: 'buscando' });
  assert.deepEqual({ ...estadoRecursos('complete', 'terminada', { vuelos: 2, hoteles: 0, actividades: 0 }) }, { vuelos: 'con_resultados', hoteles: 'sin_resultados', actividades: 'sin_resultados' });
  assert.deepEqual({ ...estadoRecursos('hotels', 'buscando') }, { vuelos: 'no_solicitado', hoteles: 'buscando', actividades: 'no_solicitado' });
  assert.deepEqual({ ...estadoRecursos('complete', 'error') }, { vuelos: 'error', hoteles: 'error', actividades: 'error' });
  assert.deepEqual([...recursosDelModo('desconocido')], ['vuelos', 'hoteles', 'actividades']);
});

test('mientras /api/chat sigue en vuelo: pantalla de carga, todo «Buscando…», sin pestañas ni «sin resultados»', { skip: omitir }, async () => {
  const t = await montar();
  try {
    await lanzar(t.p, t.base);
    await t.p.waitForSelector('#carga:not([hidden])');
    assert.match(await t.p.evaluate(() => document.querySelector('#carga h2')!.textContent!), /Estamos preparando el viaje que tienes en mente/);
    assert.match(await t.p.evaluate(() => document.querySelector('#carga p')!.textContent!), /Exploramos vuelos, alojamientos y experiencias para encontrar las mejores opciones para ti/);
    const e = await estados(t.p);
    for (const r of ['vuelos', 'hoteles', 'actividades']) assert.deepEqual(e[r], ['buscando', 'Buscando…']);
    assert.equal(await t.p.evaluate(() => document.getElementById('carga')!.getAttribute('aria-busy')), 'true');
    // Nada de resultados ni de textos de «vacío» visibles mientras se busca.
    assert.equal(await t.p.locator('.res-tabs').isVisible(), false);
    assert.equal(await t.p.locator('#results').isVisible(), false);
    assert.equal(await t.p.locator('#chatBox').isVisible(), false);
    assert.equal(await t.p.evaluate(() => document.getElementById('estado')!.innerText.trim()), '');
    assert.equal(t.llamadas(), 1);
    assert.equal(await t.p.evaluate(() => getComputedStyle(document.querySelector('.carga-avion')!).animationName), 'carga-vuelo');
    // Al llegar la respuesta, la carga desaparece y aparecen los resultados.
    t.liberar({ texto: CON_TODO });
    await t.p.waitForSelector('#panel-vuelos .flight-card');
    assert.equal(await cargaVisible(t.p), false);
    assert.equal(await t.p.locator('.res-tabs').isVisible(), true);
    assert.equal(await t.p.locator('#chatBox').isVisible(), true);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('respuesta sin actividades: se distingue «Sin resultados» de «Buscando» y los contadores son reales', { skip: omitir }, async () => {
  const t = await montar();
  try {
    t.liberar({ texto: SIN_ACTIVIDADES });
    await lanzar(t.p, t.base);
    await t.p.waitForSelector('#panel-vuelos .flight-card');
    const e = await estados(t.p);
    assert.deepEqual(e.vuelos, ['con_resultados', '1 resultado']);
    assert.deepEqual(e.hoteles, ['con_resultados', '1 resultado']);
    assert.deepEqual(e.actividades, ['sin_resultados', 'Sin resultados']);
    assert.equal(await cargaVisible(t.p), false);
  } finally { await t.cerrar(); }
});

test('respuesta sin ninguna opción: nunca queda en «Buscando» ni se muestra la carga', { skip: omitir }, async () => {
  const t = await montar();
  try {
    t.liberar({ texto: SIN_NADA });
    await lanzar(t.p, t.base);
    await t.p.waitForFunction(() => document.getElementById('carga')!.getAttribute('data-fase') === 'terminada');
    const e = await estados(t.p);
    for (const r of ['vuelos', 'hoteles', 'actividades']) assert.deepEqual(e[r], ['sin_resultados', 'Sin resultados']);
    assert.equal(await cargaVisible(t.p), false);
  } finally { await t.cerrar(); }
});

test('error del servidor: la carga se detiene, se ofrece reintentar y nada figura como completado', { skip: omitir }, async () => {
  const t = await montar();
  try {
    t.liberar({ status: 500 });
    await lanzar(t.p, t.base);
    await t.p.waitForSelector('#reintentar');
    assert.equal(await cargaVisible(t.p), false);
    const e = await estados(t.p);
    for (const r of ['vuelos', 'hoteles', 'actividades']) assert.deepEqual(e[r], ['error', 'No completada']);
    assert.equal(await t.p.evaluate(() => document.getElementById('carga')!.getAttribute('aria-busy')), 'false');
    assert.match(await t.p.evaluate(() => document.getElementById('estado')!.innerText), /Fallo simulado/);
  } finally { await t.cerrar(); }
});

test('recarga con la búsqueda interrumpida: no repite la llamada ni finge que sigue buscando', { skip: omitir }, async () => {
  const t = await montar();
  try {
    await lanzar(t.p, t.base);
    await t.p.waitForSelector('#carga:not([hidden])');
    assert.equal(t.llamadas(), 1);
    await t.p.reload();
    await t.p.waitForSelector('#reintentar');
    assert.equal(t.llamadas(), 1, 'la recarga no relanza la búsqueda');
    assert.equal(await cargaVisible(t.p), false);
    assert.match(await t.p.evaluate(() => document.getElementById('estado')!.innerText), /se interrumpió/);
  } finally { await t.cerrar(); }
});

test('modo hoteles: solo «Hoteles» busca; el resto figura «No solicitado»', { skip: omitir }, async () => {
  const t = await montar();
  try {
    await lanzar(t.p, t.base, 'hotels');
    await t.p.waitForSelector('#carga:not([hidden])');
    const e = await estados(t.p);
    assert.deepEqual(e.hoteles, ['buscando', 'Buscando…']);
    assert.deepEqual(e.vuelos, ['no_solicitado', 'No solicitado']);
    assert.deepEqual(e.actividades, ['no_solicitado', 'No solicitado']);
  } finally { await t.cerrar(); }
});

test('móvil 375 px: sin desbordamiento horizontal y con movimiento reducido el avión no se anima', { skip: omitir }, async () => {
  const t = await montar({ width: 375, height: 740 });
  try {
    await t.p.emulateMedia({ reducedMotion: 'reduce' });
    await lanzar(t.p, t.base);
    await t.p.waitForSelector('#carga:not([hidden])');
    const r = await t.p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, anim: getComputedStyle(document.querySelector('.carga-avion')!).animationName }));
    assert.ok(r.sw <= r.cw, `desborda: ${r.sw} > ${r.cw}`);
    assert.equal(r.anim, 'none');
    await t.p.screenshot({ path: process.env.CAPTURAS ? path.join(process.env.CAPTURAS, 'carga-movil.png') : undefined });
  } finally { await t.cerrar(); }
});
