// Regresión: respuestas del agente con encabezados «a su manera» (emoji, numeración, negrita, fechas con dígitos)
// que antes caían al texto plano de renderResultados (vuelos y hoteles mezclados, sin tarjetas).
// Chromium real, respuestas FICTICIAS; sin red ni proveedores.
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
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

const VUELO = '- **Iberia**: 240 € | Ida: 07:00 Madrid (MAD) → 09:10 París (CDG) | 2 h 10 min | Directo | Vuelta: 20:00 París (CDG) → 22:10 Madrid (MAD) | 2 h 10 min | Directo | IB3412 | [Ver búsqueda en Google Flights](https://www.google.com/travel/flights?q=x&hl=es)';
const HOTEL = '- **Hotel Ficticio París** — 120 € por noche — 8,6/10 (1.200 reseñas) — [Ver alojamiento](https://example.test/h1)';
const ACT = '- **Torre Eiffel** — Desde 28,50 € — 2 h — [Ver actividad](https://www.civitatis.com/es/paris/torre-eiffel/)';
const CAB = '## Madrid → París\n**Fechas:** 2027-01-11 – 2027-01-18\n**Viajeros:** 2\n\n';

const VARIANTES: Record<string, string> = {
  'estándar (### Vuelos / ### Alojamientos / ### Actividades)': `${CAB}### Vuelos\n${VUELO}\n\n### Alojamientos\n#### Alojamientos recomendados\n${HOTEL}\n\n### Actividades\n${ACT}\n`,
  'dos almohadillas': `${CAB}## Vuelos\n${VUELO}\n\n## Alojamientos\n#### Alojamientos recomendados\n${HOTEL}\n\n## Actividades\n${ACT}\n`,
  'emoji y fechas con dígitos en el encabezado': `${CAB}## ✈️ Vuelos Madrid → París (11–18 ene)\n${VUELO}\n\n## 🏨 Alojamientos\n#### Alojamientos recomendados\n${HOTEL}\n\n## 🎟️ Actividades\n${ACT}\n`,
  'emoji con «Hoteles en París»': `${CAB}## ✈️ Vuelos\n${VUELO}\n\n## 🏨 Hoteles en París\n${HOTEL}\n\n## 🎭 Actividades en París\n${ACT}\n`,
  'secciones numeradas': `${CAB}### 1. Vuelos\n${VUELO}\n\n### 2. Alojamientos\n${HOTEL}\n\n### 3. Actividades\n${ACT}\n`,
  'etiquetas en negrita': `${CAB}**Vuelos**\n${VUELO}\n\n**Alojamientos**\n${HOTEL}\n\n**Actividades**\n${ACT}\n`,
  'negrita con dos puntos': `${CAB}**Vuelos:**\n${VUELO}\n\n**Alojamientos recomendados:**\n${HOTEL}\n\n**Actividades:**\n${ACT}\n`,
  'vuelo con raya en vez de dos puntos': `${CAB}### Vuelos\n- **Iberia** — 240 € | Directo | [Ver búsqueda](https://www.google.com/travel/flights?q=x)\n\n### Alojamientos\n${HOTEL}\n\n### Actividades\n${ACT}\n`,
};

async function nuevaPagina() {
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await b.newPage();
  await p.setContent('<div id="results"></div><div id="chatBox"></div>');
  await p.addScriptTag({ path: path.join(root, 'public/render-resultados.js') });
  return { p, cerrar: () => b.close() };
}
const cuenta = (p: any, md: string) => p.evaluate((m: string) => {
  const t = document.createElement('div'); (globalThis as any).renderResultados(m, t);
  return { vuelos: t.querySelectorAll('.flight-card').length, hoteles: t.querySelectorAll('.hotel-card').length, actividades: t.querySelectorAll('.activity-card').length, textoPlano: !!t.querySelector('.result-text'), texto: t.innerText };
}, md);

test('renderer: cada variante de encabezado produce tarjetas de vuelos, hoteles y actividades (no texto plano)', { skip: omitir }, async () => {
  const { p, cerrar } = await nuevaPagina();
  try {
    for (const [nombre, md] of Object.entries(VARIANTES)) {
      const r = await cuenta(p, md);
      assert.equal(r.textoPlano, false, `${nombre}: cayó a texto plano`);
      assert.equal(r.vuelos, 1, `${nombre}: vuelos`);
      assert.equal(r.hoteles, 1, `${nombre}: hoteles`);
      assert.equal(r.actividades, 1, `${nombre}: actividades`);
      assert.match(r.texto, /Iberia/); assert.match(r.texto, /Hotel Ficticio París/); assert.match(r.texto, /Torre Eiffel/);
    }
  } finally { await cerrar(); }
});

test('renderer: una respuesta realmente sin secciones reconocibles sigue mostrándose ÍNTEGRA como texto (no se pierde información)', { skip: omitir }, async () => {
  const { p, cerrar } = await nuevaPagina();
  try {
    const md = 'Lo siento, no he podido completar la búsqueda ahora mismo. Inténtalo de nuevo en unos minutos.';
    const r = await cuenta(p, md);
    assert.equal(r.textoPlano, true);
    assert.match(r.texto, /no he podido completar la búsqueda ahora mismo/);
  } finally { await cerrar(); }
});

test('renderer: las etiquetas normalizadas no rompen un vuelo con «Vuelos» dentro de una línea ni los subtítulos de hoteles', { skip: omitir }, async () => {
  const { p, cerrar } = await nuevaPagina();
  try {
    const md = `${CAB}### Vuelos\n${VUELO}\n- **Vueling**: 199 € | Vuelos directos de Vueling | [Ver](https://www.google.com/travel/flights?q=y)\n\n### Alojamientos\n#### Alojamientos recomendados\n${HOTEL}\n#### Alojamientos económicos\n- **Hotel Barato** — 60 € por noche — 8,0/10 (500 reseñas) — [Ver alojamiento](https://example.test/h2)\n`;
    const r = await cuenta(p, md);
    assert.equal(r.vuelos, 2); assert.equal(r.hoteles, 2);
    const cats = await p.evaluate((m: string) => { const t = document.createElement('div'); (globalThis as any).renderResultados(m, t); return [...t.querySelectorAll('.hotel-category')].length; }, md);
    assert.ok(cats >= 1, 'se conservan las categorías de hoteles');
  } finally { await cerrar(); }
});

test('flujo en /resultados.html: la respuesta con encabezados con emoji se reparte en pestañas con tarjetas (no en texto plano)', { skip: omitir }, async () => {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  try {
    await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
    await p.route('**/api/chat', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: VARIANTES['emoji y fechas con dígitos en el encabezado'] }) }));
    await p.goto(base + '/');
    await p.fill('#ideaViaje', 'Quiero viajar de Madrid a París del 11 al 18 de enero de 2027 para 2 personas');
    await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
    await p.waitForSelector('#panel-vuelos .flight-card');
    assert.equal(await p.locator('#panel-hoteles .hotel-card').count(), 1);
    assert.equal(await p.locator('#panel-actividades .activity-card').count(), 1);
    assert.equal(await p.locator('#conversacion .result-text').count(), 0, 'nada de texto plano en la conversación');
    assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.res-count')].map((e) => e.textContent)), ['1', '1', '1']);
    assert.deepEqual(errores, []);
  } finally { await b.close(); cerrar(); }
});
