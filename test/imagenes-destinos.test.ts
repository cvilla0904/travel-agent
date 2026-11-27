// Las cuatro recomendaciones que no tenían foto (Colombia, Córcega, Rajastán, Sarajevo) muestran ahora la misma foto en el carrusel de la
// portada y en su página de destino, sin imágenes rotas. Chromium real; las fotos de Unsplash se sustituyen por un PNG de prueba (sin red).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { DESTINOS, urlFoto } from '../scripts/destinos-datos.mjs';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');
const leer = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('las cuatro tarjetas y sus páginas usan foto propia y distinta, con la misma fuente de datos', () => {
  const index = leer('index.html');
  const ids = new Set<string>();
  assert.equal(DESTINOS.length, 4);
  for (const d of DESTINOS) {
    assert.match(d.foto, /^photo-[\w-]+$/, d.slug);
    assert.ok(d.fotoAlt.length >= 30, `alt descriptivo de ${d.slug}`);
    assert.ok(!ids.has(d.foto), `foto repetida: ${d.slug}`); ids.add(d.foto);
    const tarjeta = new RegExp(`<article class="journey-card[^>]*>(?:(?!</article>)[\\s\\S])*?<img src="([^"]+)"[^>]*alt="([^"]+)"[^>]*onerror="[^"]*/destinos/${d.slug}\\.svg`).exec(index);
    assert.ok(tarjeta, `tarjeta de ${d.slug} con foto y respaldo local`);
    assert.ok(tarjeta![1]!.includes(d.foto), `${d.slug}: el carrusel usa la foto de destinos-datos`);
    assert.equal(tarjeta![2], d.fotoAlt);
    const pagina = leer(d.fichero);
    assert.ok(pagina.includes(urlFoto(d.foto, 1800)), `${d.slug}: la página usa la misma foto`);
    assert.ok(pagina.includes(`this.src='/destinos/${d.slug}.svg'`), `${d.slug}: respaldo local`);
    assert.doesNotMatch(pagina, /Ilustración original de Mogavel/);
  }
  // Las tres que ya tenían foto no se tocan.
  for (const id of ['photo-1516483638261-f4dbaf036963', 'photo-1516550893923-42d28e5677af']) assert.ok(index.includes(id));
});

async function abrir(viewport: { width: number; height: number }, fotosFallan = false, extra: any = {}) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport, ...extra });
  const p = await ctx.newPage();
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => (/^https:\/\/images\.(unsplash|pexels)\.com\//.test(r.request().url()) && !fotosFallan
    ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.abort()));
  return { p, base, cerrar: async () => { await b.close(); cerrar(); } };
}
const estado = (p: any, sel: string) => p.evaluate((s: string) => [...document.querySelectorAll(s)].map((i: any) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })), sel);

for (const [nombre, vp, extra] of [['escritorio', { width: 1280, height: 900 }, {}], ['móvil', { width: 375, height: 760 }, { hasTouch: true, isMobile: true }]] as const) {
  test(`${nombre}: carrusel y páginas de destino muestran las fotos sin imágenes rotas`, { skip: omitir }, async () => {
    const t = await abrir(vp, false, extra);
    try {
      await t.p.goto(t.base + '/');
      await t.p.evaluate(() => document.querySelectorAll('.journey-card img').forEach((i: any) => { i.loading = 'eager'; }));
      await t.p.waitForFunction(() => [...document.querySelectorAll('.journey-card img')].every((i: any) => i.complete));
      const imgs = await estado(t.p, '.journey-card img');
      assert.equal(imgs.length, 7);
      for (const i of imgs) assert.ok(i.ok, `imagen rota en el carrusel: ${i.src}`);
      for (const d of DESTINOS) assert.ok(imgs.some((i: any) => i.src.includes(d.foto)), `${d.slug} aparece con su foto`);
      assert.ok(imgs.every((i: any) => !i.src.endsWith('.svg')), 'ninguna usa ya la ilustración');
      for (const d of DESTINOS) {
        await t.p.goto(`${t.base}/${d.fichero}`);
        await t.p.waitForFunction(() => (document.querySelector('.cover img') as any)?.complete);
        const [img] = await estado(t.p, '.cover img');
        assert.ok(img.ok && img.src.includes(d.foto), `página de ${d.slug}`);
        const caja = await t.p.locator('.cover').boundingBox();
        assert.ok(caja!.width > 200 && caja!.height > 100, 'la portada de la página tiene tamaño');
        assert.ok(await t.p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${d.slug}: sin desbordamiento`);
      }
    } finally { await t.cerrar(); }
  });
}

test('si la foto no carga se muestra la ilustración local (nunca una imagen rota)', { skip: omitir }, async () => {
  const t = await abrir({ width: 1280, height: 900 }, true);
  try {
    await t.p.goto(t.base + '/');
    await t.p.evaluate(() => document.querySelectorAll('.journey-card img').forEach((i: any) => { i.loading = 'eager'; }));
    await t.p.waitForFunction(() => document.querySelectorAll('.journey-card img[src$=".svg"]').length === 4);
    await t.p.waitForFunction(() => [...document.querySelectorAll('.journey-card img[src$=".svg"]')].every((i: any) => i.complete && i.naturalWidth > 0));
    const imgs = await estado(t.p, '.journey-card img[src$=".svg"]');
    for (const i of imgs) assert.ok(i.ok, i.src);
    await t.p.goto(`${t.base}/sarajevo.html`);
    await t.p.waitForFunction(() => (document.querySelector('.cover img') as any)?.src.endsWith('.svg') && (document.querySelector('.cover img') as any).complete && (document.querySelector('.cover img') as any).naturalWidth > 0);
    assert.ok((await estado(t.p, '.cover img'))[0].ok);
  } finally { await t.cerrar(); }
});
