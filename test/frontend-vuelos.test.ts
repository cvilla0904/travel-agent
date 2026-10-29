// Comprobaciones del frontend real (index.html) en Chromium con respuestas FICTICIAS.
// Sin red: /api/chat se intercepta. Si Playwright/Chromium no están disponibles, se omite.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;

const G = 'https://www.google.com/travel/flights?q=MAD%20MIA&hl=es';
const V = (l: string) => `### Vuelos\n${l}\n`;
const casos: Array<[string, string, (r: any) => void]> = [
  ['enlace Markdown: botón con URL real y sin "undefined"', V(`- **Aerolínea Ficticia**: 240 € | Directo | [Ver búsqueda en Google Flights](${G})`), (r) => {
    assert.equal(r.cards, 1); assert.ok(!/undefined/.test(r.texto)); assert.deepEqual(r.hrefs, [G]);
  }],
  ['URL desnuda: se extrae y no queda "undefined"', V(`- **Aerolínea Ficticia**: 240 € | Directo | ${G}`), (r) => {
    assert.equal(r.cards, 1); assert.ok(!/undefined/.test(r.texto)); assert.deepEqual(r.hrefs, [G]);
  }],
  ['línea "Enlace:" aparte no crea una tarjeta falsa', V(`- **Aerolínea Ficticia**: 240 € | Directo\n- Enlace: [Ver en Google Flights](${G})`), (r) => {
    assert.equal(r.cards, 1); assert.ok(!/undefined/.test(r.texto)); assert.deepEqual(r.hrefs, [G]);
  }],
  ['dos vuelos mantienen su orden', V('- **Alfa**: 100 € | Directo\n- **Beta**: 250 € | 1 escala'), (r) => {
    assert.equal(r.cards, 2); assert.match(r.texto, /Alfa.*100.*Beta.*250/);
  }],
  ['precio con formato "€ 240" o "240 EUR"', V('- **Alfa**: EUR 240 | Directo\n- **Beta**: 1.250,50 EUR | 1 escala'), (r) => {
    assert.equal(r.cards, 2); assert.ok(!/Precio no disponible/.test(r.texto));
  }],
  ['fallo de consulta: no afirma "Sin vuelos disponibles"', '### Vuelos\nNo se pudo consultar la vuelta: Apify timeout\n', (r) => {
    assert.equal(r.cards, 0); assert.ok(!/Sin vuelos disponibles/.test(r.texto)); assert.match(r.texto, /No se han podido consultar los vuelos/);
  }],
  ['sin resultados reales: sí dice "Sin vuelos disponibles"', '### Vuelos\nSin vuelos para esas fechas.\n', (r) => {
    assert.match(r.texto, /Sin vuelos disponibles/);
  }],
];

test('frontend vuelos (Chromium)', { skip: omitir }, async () => {
  let respuesta = '';
  const root = path.resolve(import.meta.dirname, '..');
  const srv = http.createServer((q, r) => {
    if (q.url === '/') { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(path.join(root, 'index.html'))); } else { r.statusCode = 404; r.end(); }
  });
  await new Promise<void>((ok) => srv.listen(0, ok));
  const base = 'http://127.0.0.1:' + (srv.address() as any).port;
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    for (const [nombre, md, comprobar] of casos) {
      const p = await b.newPage();
      await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
      await p.route('**/api/chat', (r: any) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ response: respuesta }) }));
      await p.goto(base + '/');
      respuesta = md;
      await p.evaluate(() => (globalThis as any).consultarAgente('x').then((t: string) => (globalThis as any).renderResultados(t)));
      const r = await p.evaluate(() => ({
        cards: document.querySelectorAll('.flight-card').length,
        hrefs: [...document.querySelectorAll('.flight-card a')].map((a) => a.getAttribute('href')),
        texto: document.getElementById('results')!.innerText.replace(/\s+/g, ' '),
      }));
      try { comprobar(r); } catch (e: any) { e.message = `[${nombre}] ${e.message} :: ${JSON.stringify(r)}`; throw e; }
      await p.close();
    }
  } finally { await b.close(); srv.close(); }
});
