// Contrato backend → frontend de actividades: lo que devuelve la herramienta (estado/mensaje) y lo que
// termina pintando renderResultados en Chromium. El texto del agente se simula con la regla documentada en
// las instrucciones («Estado de actividades: <estado> — <mensaje>»); NO se prueba el LLM, solo el render.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { buscarActividadesDestino } from '../src/services/actividades-busqueda.ts';
import type { EjecucionActor } from '../src/services/apify.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const PARIS = { latitude: 48.8584, longitude: 2.2945 };
const BXL = { latitude: 50.8467, longitude: 4.3525 };
let n = 0;
const reg = (e: Record<string, unknown>) => ({ title: 'Tour', url: `https://www.civitatis.com/es/bruselas/t${++n}/`, platform: 'civitatis', priceFrom: 25, ...e });
const ejec = (items: any[], status = 'SUCCEEDED'): EjecucionActor => ({ items, status, runId: 'r1', datasetId: 'd1', consultas: [] });

/** Lo que el agente debe escribir según las instrucciones, a partir de la salida REAL de la herramienta. */
function markdownDelAgente(s: Awaited<ReturnType<typeof buscarActividadesDestino>>): string {
  const lineas = ['### Vuelos', '- **Aerolínea Ficticia**: 240 € | Directo | [Ver oferta](https://www.google.com/travel/flights?q=x)', ''];
  if (s.actividades.length) {
    lineas.push('### Actividades');
    for (const a of s.actividades) lineas.push(`- **${a.nombre}** — Desde ${a.precio} EUR por persona — [Ver actividad](${a.url})`);
  }
  if (s.estado !== 'ok') lineas.push(`Estado de actividades: ${s.estado} — ${s.mensaje}`);
  return lineas.join('\n');
}

async function pintar(markdown: string) {
  const root = path.resolve(import.meta.dirname, '..');
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
    await p.route('**/api/chat', (r: any) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ response: markdown }) }));
    await p.goto(base + '/');
    await p.evaluate(() => (globalThis as any).consultarAgente('x').then((t: string) => (globalThis as any).renderResultados(t)));
    return await p.evaluate(() => ({
      tarjetas: document.querySelectorAll('.activity-card').length,
      estado: document.querySelector('[data-estado-actividades]')?.getAttribute('data-estado-actividades') ?? null,
      nota: (document.querySelector('[data-estado-actividades]') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? null,
      texto: (document.getElementById('results') as HTMLElement).innerText.replace(/\s+/g, ' '),
    }));
  } finally { await b.close(); cerrar(); }
}
const skip = !chromium && 'playwright no disponible';

test('CASO REAL Bruselas (10× «Atracciones Paris»): el usuario ve «sin actividades verificadas», con el motivo, y ninguna tarjeta de París', { skip }, async () => {
  const diez = Array.from({ length: 10 }, (_, i) => reg({ title: `Paris ${i}`, city: 'Atracciones Paris', ...PARIS }));
  const salida = await buscarActividadesDestino({ destino: 'Brussels', tipos: [] }, async () => ejec(diez));
  const dom = await pintar(markdownDelAgente(salida));
  assert.equal(dom.estado, 'sin_resultados');
  assert.match(dom.nota!, /Sin actividades verificadas para este destino\..*10 resultados.*Atracciones Paris/);
  assert.equal(dom.tarjetas, 0);
  assert.doesNotMatch(dom.texto, /Paris \d/);
});

test('error del proveedor: se muestra «No se han podido consultar», distinto de «sin actividades»', { skip }, async () => {
  const salida = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => { throw new Error('timeout del proveedor'); });
  const dom = await pintar(markdownDelAgente(salida));
  assert.equal(dom.estado, 'error');
  assert.match(dom.nota!, /No se han podido consultar las actividades\..*timeout del proveedor/);
  assert.doesNotMatch(dom.texto, /Sin actividades verificadas|No se encontraron actividades/);
});

test('parcial: se pintan las tarjetas recibidas y un aviso de resultados incompletos', { skip }, async () => {
  const salida = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => ejec([reg({ title: 'Atomium', city: 'Brussels', ...BXL })], 'RUNNING'));
  const dom = await pintar(markdownDelAgente(salida));
  assert.equal(dom.estado, 'parcial');
  assert.equal(dom.tarjetas, 1);
  assert.match(dom.nota!, /Resultados de actividades incompletos/);
  assert.match(dom.texto, /Atomium/);
});

test('ok: tarjetas de Bruselas (también la de etiqueta errónea verificada por coordenadas), sin avisos, y ninguna de París', { skip }, async () => {
  const datos = [
    reg({ title: 'Atomium', city: 'Brussels', ...BXL }),
    reg({ title: 'Ruta del chocolate', city: 'Atracciones Paris', ...BXL }),
    reg({ title: 'Torre Eiffel', city: 'Atracciones Paris', ...PARIS }),
  ];
  const salida = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => ejec(datos));
  assert.equal(salida.estado, 'ok');
  const dom = await pintar(markdownDelAgente(salida));
  assert.equal(dom.estado, null);
  assert.equal(dom.tarjetas, 2);
  assert.match(dom.texto, /Atomium/);
  assert.match(dom.texto, /Ruta del chocolate/);
  assert.doesNotMatch(dom.texto, /Eiffel/);
});
