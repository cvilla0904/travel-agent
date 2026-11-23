// GeoNames exige atribución (CC BY 4.0) mientras Mogavel use sus datos: debe estar visible en la portada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const root = path.resolve(import.meta.dirname, '..');

test('index.html incluye la atribución de GeoNames con enlace y licencia', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const bloque = /<p class="footer-atribucion[^"]*">[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
  assert.match(bloque, /href="https:\/\/www\.geonames\.org\/"/);
  assert.match(bloque, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"/);
  assert.match(bloque, /OurAirports/);
});

test('la atribución es visible en el pie, en escritorio y en móvil, sin desbordar', { skip: !chromium ? 'playwright no disponible' : false }, async () => {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    for (const [w, h] of [[1280, 800], [375, 700]] as const) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
      await p.goto(base + '/');
      const el = p.locator('footer .footer-atribucion');
      await el.scrollIntoViewIfNeeded();
      assert.equal(await el.isVisible(), true, `visible a ${w}px`);
      assert.match(await el.innerText(), /GeoNames/);
      const caja = await el.boundingBox();
      assert.ok(caja && caja.x >= 0 && caja.x + caja.width <= w + 1, `no desborda a ${w}px: ${JSON.stringify(caja)}`);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `sin scroll horizontal a ${w}px`);
      if (w === 375) await p.screenshot({ path: path.join(process.env.TMPDIR ?? '/tmp', 'atribucion-movil.png'), clip: { x: 0, y: Math.max(0, (caja?.y ?? 0) - 120), width: 375, height: 220 } }).catch(() => {});
      await p.close();
    }
  } finally { await b.close(); cerrar(); }
});
