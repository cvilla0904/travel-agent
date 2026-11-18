// Frontend real (index.html + public/trip-builder.js) en Chromium con respuestas FICTICIAS. Sin red.
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
const U = 'https://www.civitatis.com/es/roma/tour-coliseo/';
const MD = `### Vuelos
- **Aerolínea Ficticia**: 240 € | Directo | [Ver oferta](https://www.google.com/travel/flights?q=x)

### Actividades
- **Coliseo, Foro y Palatino** — Desde 62,10 EUR por persona — 3 h — [Ver actividad](${U})
- **Basílica de San Pedro** — Desde 30,34 € — 2 h — [Ver actividad](${U}2)
- **Free tour del centro** — GRATUITA — 2 h — [Ver actividad](${U}3)
- **Visita sin tarifa** — 1 h — [Ver actividad](${U}4)
`;

test('actividades: el precio mostrado se conserva en la selección y en el contexto enviado al agente', { skip: !chromium && 'playwright no disponible' }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
    let enviado = '';
    await p.route('**/api/chat', (r: any) => { try { enviado = JSON.parse(r.request().postData() || '{}').message; } catch { /* */ } r.fulfill({ contentType: 'application/json', body: JSON.stringify({ response: MD }) }); });
    await p.goto(base + '/');
    await p.evaluate(() => (globalThis as any).consultarAgente('x').then((t: string) => (globalThis as any).renderResultados(t)));
    const badges = await p.evaluate(() => [...document.querySelectorAll('.activity-price-badge')].map((e) => (e as HTMLElement).innerText.trim()));
    assert.deepEqual(badges, ['DESDE 62,10 €', 'DESDE 30,34 €', 'GRATUITA', 'PRECIO POR CONFIRMAR']);
    await p.evaluate(() => document.querySelectorAll('.activity-card .mtb-select').forEach((b) => (b as HTMLElement).click()));
    const snap = await p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    assert.equal(snap.length, 4);
    assert.deepEqual(snap.map((s: any) => s.price && (s.price.free ? 'gratis' : s.price.value)), [62.1, 30.34, 'gratis', null]);
    assert.equal(snap[0].price.basis, 'desde');
    const panel = await p.evaluate(() => (document.querySelector('#mogavel-trip-builder .mtb-items') as HTMLElement).innerText.replace(/\s+/g, ' '));
    assert.match(panel, /Coliseo, Foro y Palatino.*Desde 62,10/);
    assert.match(panel, /Free tour del centro Gratuita/);
    assert.match(panel, /Visita sin tarifa Precio por confirmar/);
    await p.evaluate(() => (globalThis as any).consultarAgente('Genera el itinerario'));
    assert.match(enviado, /Coliseo, Foro y Palatino \(precio orientativo "desde" del proveedor: 62\.1 EUR/);
    assert.match(enviado, /Free tour del centro \(gratuita según el proveedor\)/);
    assert.match(enviado, /Visita sin tarifa \(importe no identificado\)/);
  } finally { await b.close(); cerrar(); }
});
