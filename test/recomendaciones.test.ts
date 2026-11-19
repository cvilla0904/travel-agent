// Carrusel de recomendaciones, las siete páginas y la navegación (Chromium real, sin red externa).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { DESTINOS } from '../scripts/destinos-datos.mjs';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');
const leer = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');

const ORDEN = ['/toscana.html', '/colombia.html', '/jordania.html', '/corcega.html', '/viena.html', '/rajastan.html', '/sarajevo.html'];

test('las tres páginas existentes no han cambiado (byte a byte)', () => {
  assert.equal(sha('toscana.html'), '78b9c7da4f9a86dc563240cc4983dbea1c2a5d064c1ad298509da22e3b0da5b9');
  assert.equal(sha('jordania.html'), '135550ed062feac60e61e83175fc9fc326041345c08a681b04172b1cd535f2be');
  assert.equal(sha('viena.html'), 'f1d9e9d73845e188d63226cb2893d4cb984cec3be902619dafa3e22dd35c7ede');
});

test('index: siete tarjetas mezcladas, con duración, título, resumen y «Descúbrelo al detalle»', () => {
  const html = leer('index.html');
  const tarjetas = [...html.matchAll(/<article class="journey-card[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]!);
  assert.equal(tarjetas.length, 7);
  assert.deepEqual(tarjetas.map((t) => /class="journey-cta" href="([^"]+)"/.exec(t)![1]), ORDEN);
  for (const t of tarjetas) {
    assert.match(t, /journey-meta">\d+ DÍAS · /);
    assert.match(t, /<h3>[^<]{5,}<\/h3>/);
    assert.match(t, /<p>[^<]{30,}<\/p>/);
    assert.match(t, /Descúbrelo al detalle/);
    assert.match(t, /<img [^>]*alt="[^"]{8,}"/);
  }
  // Las cuatro nuevas no están juntas al final.
  const posNuevas = ORDEN.map((u, i) => (['/colombia.html', '/corcega.html', '/rajastan.html', '/sarajevo.html'].includes(u) ? i : -1)).filter((i) => i >= 0);
  assert.notDeepEqual(posNuevas, [3, 4, 5, 6]);
  assert.ok(posNuevas[0]! < 3, 'una nueva aparece entre las primeras');
});

test('vercel.json sirve las cuatro páginas, sus imágenes y los dos scripts nuevos', () => {
  const v = JSON.parse(leer('vercel.json'));
  const builds = v.builds.map((b: any) => b.src);
  const rutas = new Map<string, string>(v.routes.filter((r: any) => r.dest).map((r: any) => [r.src, r.dest]));
  const catchAll = v.routes.findIndex((r: any) => r.src === '/(.*)');
  for (const d of DESTINOS) {
    assert.ok(builds.includes(d.fichero), `build de ${d.fichero}`);
    assert.ok(builds.includes(`public/destinos/${d.slug}.svg`), `build de la imagen de ${d.slug}`);
    assert.equal(rutas.get('/' + d.fichero), '/' + d.fichero);
    assert.equal(rutas.get(`/destinos/${d.slug}.svg`), `/public/destinos/${d.slug}.svg`);
    assert.ok(v.routes.findIndex((r: any) => r.src === '/' + d.fichero) < catchAll || catchAll === -1);
  }
  for (const j of ['carrusel-viajes', 'precarga-viaje', 'carga-busqueda']) {
    assert.ok(builds.includes(`public/${j}.js`));
    assert.equal(rutas.get(`/${j}.js`), `/public/${j}.js`);
  }
});

test('contenido de las cuatro páginas nuevas: duración, estructura y requisitos del encargo', () => {
  const esperado: Record<string, number> = { colombia: 14, corcega: 11, rajastan: 14, sarajevo: 4 };
  for (const d of DESTINOS) {
    const html = leer(d.fichero);
    assert.equal(d.dias_plan.length, esperado[d.slug], `${d.slug}: un bloque por día`);
    assert.equal((html.match(/<article class="day">/g) || []).length, d.dias_plan.length);
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.match(html, new RegExp(`${d.dias} días`));
    assert.match(html, /class="intro"/);
    assert.match(html, /id="lugares"/); assert.match(html, /id="experiencias"/); assert.match(html, /id="consejos"/);
    assert.match(html, /Planificar este viaje/);
    assert.ok(html.includes(`href="/index.html?destino=${encodeURIComponent(d.destinoForm)}&amp;dias=${d.dias}#inicio"`) || html.includes(`href="/index.html?destino=${encodeURIComponent(d.destinoForm)}&dias=${d.dias}#inicio"`));
    assert.ok(fs.existsSync(path.join(root, `public/destinos/${d.slug}.svg`)));
    assert.equal(d.experiencias.length, 3);
    // Sin precios ni horarios inventados.
    assert.doesNotMatch(html, /€|USD|\$\s?\d|\b\d{1,2}:\d{2}\b/);
  }
  assert.ok(DESTINOS.find((d) => d.slug === 'colombia')!.lugares.length >= 6, 'Colombia: al menos seis destinos');
  assert.match(leer('corcega.html'), /Cerdeña/, 'Córcega explica qué destino cercano se deja fuera y por qué');
});

test('el generador es reproducible: las páginas del repo coinciden con su salida', async () => {
  const { svgDestino } = await import('../scripts/generar-destinos.mjs');
  for (const d of DESTINOS) assert.equal(svgDestino(d), leer(`public/destinos/${d.slug}.svg`));
});

async function abrir(viewport: { width: number; height: number }, extra: any = {}) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport, ...extra });
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  const chat: any[] = [];
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => { chat.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'ok' }) }); });
  return { p, base, errores, chat, cerrar: async () => { await b.close(); cerrar(); } };
}

const geom = (p: any) => p.evaluate(() => {
  const pista = document.getElementById('journey-track')!;
  const pr = pista.getBoundingClientRect();
  const vis = [...pista.querySelectorAll('.journey-card')].filter((c) => { const r = c.getBoundingClientRect(); return r.left >= pr.left - 2 && r.right <= pr.right + 2; }).length;
  return { vis, left: pista.scrollLeft, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, prev: (document.querySelector('.jc-prev') as HTMLButtonElement).disabled, next: (document.querySelector('.jc-next') as HTMLButtonElement).disabled };
});

test('escritorio: cuatro tarjetas visibles y las flechas avanzan y retroceden', { skip: omitir }, async () => {
  const t = await abrir({ width: 1280, height: 900 });
  try {
    await t.p.goto(t.base + '/'); await t.p.locator('#carrusel-viajes').scrollIntoViewIfNeeded();
    let g = await geom(t.p);
    assert.equal(g.vis, 4); assert.equal(g.prev, true); assert.equal(g.next, false);
    await t.p.click('.jc-next'); await t.p.waitForFunction(() => document.getElementById('journey-track')!.scrollLeft > 100);
    await t.p.waitForTimeout(700);
    g = await geom(t.p);
    assert.ok(g.left > 100); assert.equal(g.prev, false);
    for (let i = 0; i < 4 && !(await geom(t.p)).next; i++) { await t.p.click('.jc-next'); await t.p.waitForTimeout(600); }
    g = await geom(t.p);
    assert.equal(g.next, true, 'al final, «siguiente» se desactiva');
    assert.equal(g.vis, 4);
    await t.p.click('.jc-prev'); await t.p.waitForTimeout(700);
    assert.ok((await geom(t.p)).left < g.left);
    assert.ok(g.sw <= g.cw, 'sin desbordamiento horizontal de la página');
    if (process.env.CAPTURAS) await t.p.locator('#planifica-tu-viaje').screenshot({ path: path.join(process.env.CAPTURAS, 'carrusel-escritorio.png') });
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('tablet (2 visibles) y móvil (desplazamiento táctil, sin flechas ni desbordamiento)', { skip: omitir }, async () => {
  let t = await abrir({ width: 820, height: 1000 });
  try {
    await t.p.goto(t.base + '/'); await t.p.locator('#carrusel-viajes').scrollIntoViewIfNeeded();
    assert.equal((await geom(t.p)).vis, 2);
  } finally { await t.cerrar(); }
  t = await abrir({ width: 375, height: 760 }, { hasTouch: true, isMobile: true });
  try {
    await t.p.goto(t.base + '/'); await t.p.locator('#carrusel-viajes').scrollIntoViewIfNeeded();
    const a = await geom(t.p);
    assert.ok(a.sw <= a.cw, `desborda: ${a.sw} > ${a.cw}`);
    assert.equal(await t.p.locator('.jc-next').isVisible(), false);
    const ancho = await t.p.evaluate(() => document.querySelector('.journey-card')!.getBoundingClientRect().width / document.documentElement.clientWidth);
    assert.ok(ancho > 0.7 && ancho < 0.95, 'la siguiente tarjeta asoma para invitar a deslizar');
    // Desplazamiento como lo haría un dedo (la pista es scrollable en horizontal).
    await t.p.evaluate(() => { const p = document.getElementById('journey-track')!; p.style.scrollBehavior = 'auto'; p.scrollLeft = p.scrollWidth; });
    await t.p.waitForTimeout(200);
    assert.ok((await geom(t.p)).left > 500);
    if (process.env.CAPTURAS) await t.p.locator('#planifica-tu-viaje').screenshot({ path: path.join(process.env.CAPTURAS, 'carrusel-movil.png') });
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('navegación: cada una de las siete tarjetas abre su página (200, h1) y desde ella se vuelve', { skip: omitir }, async () => {
  const t = await abrir({ width: 1280, height: 900 });
  try {
    for (const url of ORDEN) {
      await t.p.goto(t.base + '/');
      const resp = await Promise.all([t.p.waitForURL('**' + url), t.p.evaluate((u) => { (document.querySelector(`.journey-cta[href="${u}"]`) as HTMLElement).click(); }, url)]);
      void resp;
      assert.ok((await t.p.locator('h1').first().innerText()).length > 10, url);
      assert.ok(await t.p.locator('.back').isVisible());
      await t.p.click('.back'); await t.p.waitForURL('**/index.html#planifica-tu-viaje');
    }
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

for (const d of DESTINOS) {
  test(`«Planificar este viaje» (${d.slug}) precarga destino y duración, sin pisar lo escrito ni lanzar búsqueda`, { skip: omitir }, async () => {
    const t = await abrir({ width: 1280, height: 900 });
    try {
      await t.p.goto(t.base + '/' + d.fichero);
      await Promise.all([t.p.waitForURL('**/index.html?**'), t.p.click('#planificar')]);
      assert.equal(await t.p.inputValue('#destino'), d.destinoForm);
      const idea = await t.p.inputValue('#ideaViaje');
      assert.ok(idea.includes(d.destinoForm) && idea.includes(`${d.dias} días`), idea);
      assert.equal(t.chat.length, 0, 'no se lanza ninguna búsqueda sola');
      // Si ya había texto, no se pisa.
      await t.p.goto(t.base + '/index.html'); await t.p.fill('#ideaViaje', 'Mi idea propia'); await t.p.evaluate(() => (window as any).__x = 1);
      assert.equal(await t.p.inputValue('#ideaViaje'), 'Mi idea propia');
      assert.deepEqual(t.errores, []);
    } finally { await t.cerrar(); }
  });
}

test('precarga + búsqueda: el mensaje enviado al agente incluye destino y duración', { skip: omitir }, async () => {
  const t = await abrir({ width: 1280, height: 900 });
  try {
    await t.p.goto(t.base + '/index.html?destino=Colombia&dias=14#inicio');
    await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
    await t.p.waitForFunction(() => document.getElementById('carga')!.getAttribute('data-fase') === 'terminada');
    assert.equal(t.chat.length, 1);
    assert.match(t.chat[0].message, /Colombia/);
    assert.match(t.chat[0].message, /14 días/);
  } finally { await t.cerrar(); }
});

test('parámetros de precarga manipulados no inyectan HTML ni rellenan nada', { skip: omitir }, async () => {
  const t = await abrir({ width: 1280, height: 900 });
  try {
    await t.p.goto(t.base + '/index.html?destino=%3Cimg%20src%3Dx%3E&dias=14');
    assert.equal(await t.p.inputValue('#destino'), '');
    await t.p.goto(t.base + '/index.html?destino=Sarajevo&dias=9999');
    assert.equal(await t.p.inputValue('#destino'), 'Sarajevo');
    assert.doesNotMatch(await t.p.inputValue('#ideaViaje'), /días/);
  } finally { await t.cerrar(); }
});
