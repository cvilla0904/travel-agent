// «Solo hoteles»: el formulario pide fecha de entrada y de salida (sin origen), las valida y las transmite a /api/chat y al agente.
// Los demás modos conservan sus campos. Chromium real contra el frontend real; /api/chat interceptado (sin red ni proveedores).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { validarFechasHotel as validarServidor, mensajeConFechasHotel } from '../src/services/modo-busqueda.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

// ---- Validación en el cliente (código real de index.html, sin DOM) ----
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bloque = /\/\* === COMPOSICION_PETICION:INICIO === \*\/([\s\S]*?)\/\* === COMPOSICION_PETICION:FIN === \*\//.exec(html)!;
const { validarFechasHotel, ptFechaIsoValida } = new Function(`${bloque[1]}; return { validarFechasHotel, ptFechaIsoValida };`)() as any;
const HOY = '2026-11-26';

test('cliente: fechas de hotel válidas, vacías e inválidas', () => {
  assert.deepEqual(validarFechasHotel('2026-12-10', '2026-12-13', HOY), { ok: true, vacio: false, entrada: '2026-12-10', salida: '2026-12-13' });
  assert.equal(validarFechasHotel('', '', HOY).ok, true, 'sin fechas: válido (las puede pedir el agente)');
  assert.equal(validarFechasHotel('2026-12-10', '', HOY).ok, false, 'falta la salida');
  assert.equal(validarFechasHotel('', '2026-12-13', HOY).ok, false, 'falta la entrada');
  assert.match(validarFechasHotel('2026-12-13', '2026-12-10', HOY).error, /posterior/, 'salida anterior');
  assert.match(validarFechasHotel('2026-12-10', '2026-12-10', HOY).error, /posterior/, 'misma fecha');
  assert.match(validarFechasHotel('2026-11-01', '2026-11-05', HOY).error, /anterior a hoy/, 'entrada pasada');
  assert.equal(validarFechasHotel('2026-11-26', '2026-11-27', HOY).ok, true, 'entrada hoy permitida');
  assert.equal(validarFechasHotel('2027-02-30', '2027-03-05', HOY).ok, false, '30 de febrero');
  assert.equal(validarFechasHotel('hola', '2027-03-05', HOY).ok, false, 'texto');
  assert.equal(ptFechaIsoValida('2028-02-29'), true);
  assert.equal(ptFechaIsoValida('2027-02-29'), false);
});

// ---- Validación en el servidor ----
test('servidor: valida fechas solo en «hotels» y las añade al mensaje del agente', () => {
  assert.deepEqual(validarServidor('hotels', undefined), { ok: true, fechas: null });
  assert.deepEqual(validarServidor('hotels', { entrada: '2026-12-10', salida: '2026-12-13' }), { ok: true, fechas: { entrada: '2026-12-10', salida: '2026-12-13' } });
  for (const mal of [{ entrada: '2026-12-13', salida: '2026-12-10' }, { entrada: '2026-12-10', salida: '2026-12-10' }, { entrada: '2027-02-30', salida: '2027-03-05' }, { entrada: '2026-12-10' }, 'x', 5, { entrada: 1, salida: 2 }]) {
    const r = validarServidor('hotels', mal) as any;
    assert.equal(r.ok, false, JSON.stringify(mal));
    assert.equal(r.status, 400);
  }
  assert.deepEqual(validarServidor('flights', { entrada: 'basura', salida: 'x' }), { ok: true, fechas: null }, 'otros modos ignoran el campo');
  assert.equal(mensajeConFechasHotel('Hola', null), 'Hola');
  const m = mensajeConFechasHotel('Hola', { entrada: '2026-12-10', salida: '2026-12-13' });
  assert.match(m, /entrada 2026-12-10, salida 2026-12-13/);
});

// ---- Interfaz real ----
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

const visible = (p: any, id: string) => p.locator(`label:has(#${id})`).isVisible();
const textoEtiqueta = (p: any, id: string) => p.locator(`label:has(#${id})`).evaluate((l: HTMLElement) => (l.firstChild as Text).nodeValue);

const ESPERADO: Record<string, { origen: boolean; ida: boolean; vuelta: boolean; ida_txt: string; vuelta_txt: string }> = {
  complete: { origen: true, ida: true, vuelta: true, ida_txt: 'Fecha de ida', vuelta_txt: 'Fecha de vuelta' },
  flights: { origen: true, ida: true, vuelta: true, ida_txt: 'Fecha de ida', vuelta_txt: 'Fecha de vuelta' },
  hotels: { origen: false, ida: true, vuelta: true, ida_txt: 'Fecha de entrada', vuelta_txt: 'Fecha de salida' },
  activities: { origen: false, ida: false, vuelta: false, ida_txt: 'Fecha de ida', vuelta_txt: 'Fecha de vuelta' },
};

test('campos visibles y etiquetas de cada modo (y al volver de uno a otro)', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    for (const modo of ['hotels', 'activities', 'flights', 'complete', 'hotels', 'complete'] as const) {
      await t.p.click(`.search-tab[data-mode="${modo}"]`);
      const e = ESPERADO[modo]!;
      assert.equal(await visible(t.p, 'origen'), e.origen, `${modo}: origen`);
      assert.equal(await visible(t.p, 'destino'), true, `${modo}: destino siempre`);
      assert.equal(await visible(t.p, 'ida'), e.ida, `${modo}: ida`);
      assert.equal(await visible(t.p, 'vuelta'), e.vuelta, `${modo}: vuelta`);
      assert.equal(await textoEtiqueta(t.p, 'ida'), e.ida_txt, `${modo}: etiqueta ida`);
      assert.equal(await textoEtiqueta(t.p, 'vuelta'), e.vuelta_txt, `${modo}: etiqueta vuelta`);
    }
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('«Solo hoteles» admite escribir entrada y salida y las envía con el modo, sin origen', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    await t.p.fill('#origen', 'Madrid'); // escrito antes de elegir el modo: no debe enviarse
    await t.p.click('.search-tab[data-mode="hotels"]');
    await t.p.fill('#destino', 'Bruselas');
    await t.p.fill('#ida', '2027-03-10');
    await t.p.fill('#vuelta', '2027-03-13');
    assert.equal(await t.p.inputValue('#ida'), '2027-03-10');
    await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
    await t.p.waitForSelector('#conversacion .conv-msg');
    assert.equal(t.peticiones.length, 1);
    const b = t.peticiones[0];
    assert.equal(b.modo, 'hotels');
    assert.deepEqual(b.fechas, { entrada: '2027-03-10', salida: '2027-03-13' });
    assert.match(b.message, /2027-03-10/);
    assert.match(b.message, /2027-03-13/);
    assert.doesNotMatch(b.message, /Madrid/, 'el origen oculto no viaja');
    assert.doesNotMatch(b.message, /vuelo|fecha de (ida|vuelta)/i);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

for (const [entrada, salida, patron] of [
  ['2027-03-13', '2027-03-10', /posterior a la fecha de entrada/],
  ['2027-03-10', '2027-03-10', /posterior a la fecha de entrada/],
  ['2027-03-10', '', /entrada y la de salida/],
  ['', '2027-03-13', /entrada y la de salida/],
  ['2020-01-01', '2020-01-05', /anterior a hoy/],
] as const) {
  test(`«Solo hoteles» rechaza fechas (${entrada || '—'} → ${salida || '—'}) sin llamar al backend`, { skip: omitir }, async () => {
    const t = await preparar();
    try {
      await t.p.goto(t.base + '/');
      await t.p.click('.search-tab[data-mode="hotels"]');
      await t.p.fill('#destino', 'Bruselas');
      if (entrada) await t.p.fill('#ida', entrada);
      if (salida) await t.p.fill('#vuelta', salida);
      await t.p.evaluate(() => (globalThis as any).buscarViaje());
      await t.p.waitForTimeout(300);
      assert.equal(t.peticiones.length, 0, 'no se llamó a /api/chat');
      assert.match(new URL(t.p.url()).pathname, /^\/(index\.html)?$/, 'no se navega a resultados');
      assert.match(await t.p.locator('#results').innerText(), patron);
      assert.deepEqual(t.errores, []);
    } finally { await t.cerrar(); }
  });
}

test('«Solo hoteles» sin fechas sigue permitido y no envía `fechas`', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    await t.p.click('.search-tab[data-mode="hotels"]');
    await t.p.fill('#destino', 'Bruselas');
    await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
    await t.p.waitForSelector('#conversacion .conv-msg');
    assert.equal(t.peticiones[0].modo, 'hotels');
    assert.equal('fechas' in t.peticiones[0], false);
  } finally { await t.cerrar(); }
});

test('sin regresiones: vuelos y completo envían origen y fechas como antes; actividades no envía fechas ni origen; ninguno envía `fechas`', { skip: omitir }, async () => {
  for (const modo of ['flights', 'complete', 'activities'] as const) {
    const t = await preparar();
    try {
      await t.p.goto(t.base + '/');
      await t.p.click(`.search-tab[data-mode="${modo}"]`);
      if (modo !== 'activities') await t.p.fill('#origen', 'Madrid');
      await t.p.fill('#destino', 'Bruselas');
      if (modo !== 'activities') { await t.p.fill('#ida', '2027-03-10'); await t.p.fill('#vuelta', '2027-03-13'); }
      await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
      await t.p.waitForSelector('#conversacion .conv-msg');
      const b = t.peticiones[0];
      assert.equal(b.modo, modo);
      assert.equal('fechas' in b, false, `${modo}: sin campo fechas`);
      if (modo === 'activities') assert.doesNotMatch(b.message, /Madrid|2027-03/);
      else { assert.match(b.message, /Madrid/); assert.match(b.message, /2027-03-10/); }
    } finally { await t.cerrar(); }
  }
});
