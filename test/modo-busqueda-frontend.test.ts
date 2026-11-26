// El modo elegido en la portada llega a /api/chat en la primera petición Y en los seguimientos de la conversación.
// Chromium real contra el frontend real; el endpoint /api/chat está interceptado (respuesta ficticia), sin red ni proveedores.
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

async function preparar() {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  const peticiones: any[] = [];
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => {
    peticiones.push(JSON.parse(r.request().postData() || '{}'));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'Respuesta ficticia' }) });
  });
  return { p, base, peticiones, errores, cerrar: async () => { await b.close(); cerrar(); } };
}

async function buscar(p: any, base: string, modo: string | null) {
  await p.goto(base + '/');
  if (modo) await p.click(`.search-tab[data-mode="${modo}"]`);
  await p.fill('#destino', 'Bruselas');
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
  await p.waitForSelector('#conversacion .conv-msg');
}

async function seguimiento(p: any, texto: string, esperadas: number, peticiones: any[]) {
  await p.fill('#chatMessage', texto);
  await p.click('#enviarSeguimiento');
  await p.waitForFunction((n: number) => document.querySelectorAll('#conversacion > .conv-msg').length >= n, esperadas);
  assert.ok(peticiones.length >= 2);
}

for (const modo of ['activities', 'hotels', 'flights', 'complete'] as const) {
  test(`portada → backend: el modo «${modo}» viaja en la primera petición y se repite en los turnos posteriores`, { skip: omitir }, async () => {
    const t = await preparar();
    try {
      await buscar(t.p, t.base, modo);
      assert.equal(t.peticiones.length, 1);
      assert.equal(t.peticiones[0].modo, modo, 'primera petición');
      assert.ok(t.peticiones[0].sessionId);
      // Seguimiento (el usuario escribe en la conversación): vuelve a llevar el modo y la misma sesión.
      await seguimiento(t.p, 'Dime más opciones', 3, t.peticiones);
      assert.equal(t.peticiones.length, 2);
      assert.equal(t.peticiones[1].modo, modo, 'seguimiento');
      assert.equal(t.peticiones[1].sessionId, t.peticiones[0].sessionId);
      // Un segundo seguimiento sigue igual: el modo no se pierde con los turnos.
      await seguimiento(t.p, 'Gracias', 5, t.peticiones);
      assert.equal(t.peticiones[2].modo, modo, 'segundo seguimiento');
      assert.deepEqual(t.errores, []);
    } finally { await t.cerrar(); }
  });
}

test('portada sin elegir pestaña: el modo por defecto es «complete» (viaje completo)', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscar(t.p, t.base, null);
    assert.equal(t.peticiones[0].modo, 'complete');
  } finally { await t.cerrar(); }
});

test('la pestaña de resultados inicial y el modo enviado coinciden con el estado guardado', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscar(t.p, t.base, 'activities');
    const modo = await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer().modo);
    assert.equal(modo, 'activities');
    assert.equal(t.peticiones[0].modo, modo);
  } finally { await t.cerrar(); }
});
