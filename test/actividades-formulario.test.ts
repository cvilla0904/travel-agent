// Formulario «¿Quieres añadir actividades a tu viaje?»: categorías, «Cualquier tipo», transmisión al backend y al agente, seguimientos
// y estados vacíos. Chromium real con /api/chat interceptado; el proveedor de actividades es simulado (nada llega a Apify).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { validarActividades, mensajeConActividades, instruccionesDeModo, CATEGORIAS_ACTIVIDADES } from '../src/services/modo-busqueda.ts';
import { buscarActividadesDestino } from '../src/services/actividades-busqueda.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

// ---- Servidor: validación y mensaje al agente ----
test('servidor: valida «actividades» y el mensaje al agente refleja lo que se pidió', () => {
  assert.deepEqual(validarActividades(undefined), { ok: true, actividades: null });
  assert.deepEqual(validarActividades({ solicitadas: false, tipos: [], cualquiera: false }), { ok: true, actividades: { solicitadas: false, tipos: [], cualquiera: false } });
  assert.deepEqual(validarActividades({ solicitadas: true, tipos: ['cultura', 'cultura', 'aventura'], cualquiera: false }), { ok: true, actividades: { solicitadas: true, tipos: ['cultura', 'aventura'], cualquiera: false } });
  for (const mal of [5, 'x', [], { solicitadas: 'si', tipos: [], cualquiera: false }, { solicitadas: true, tipos: ['museos'], cualquiera: false },
    { solicitadas: true, tipos: ['cultura'], cualquiera: true }, { solicitadas: false, tipos: ['cultura'], cualquiera: false }, { solicitadas: true, tipos: 'cultura', cualquiera: false }]) {
    const r = validarActividades(mal) as any;
    assert.equal(r.ok, false, JSON.stringify(mal)); assert.equal(r.status, 400);
  }
  assert.equal(mensajeConActividades('Hola', null), 'Hola');
  assert.match(mensajeConActividades('Hola', { solicitadas: false, tipos: [], cualquiera: false }), /NO ha pedido actividades.*No llames a activities_agent/);
  assert.match(mensajeConActividades('Hola', { solicitadas: true, tipos: ['cultura'], cualquiera: false }), /solicitadas en el formulario: cultura.*tipos = \["cultura"\]/);
  const todas = mensajeConActividades('Hola', { solicitadas: true, tipos: [], cualquiera: true });
  assert.match(todas, /cualquier tipo/);
  for (const c of CATEGORIAS_ACTIVIDADES) assert.ok(todas.includes(c), `incluye ${c}`);
});

test('«Solo actividades»: pregunta las fechas si faltan, nunca origen', () => {
  const b = instruccionesDeModo('activities');
  assert.match(b, /hacen falta el destino y las fechas del viaje/);
  assert.match(b, /pregúntaselas/);
  assert.match(b, /NO pidas ciudad de origen/);
  assert.doesNotMatch(b, /NO pidas fechas/);
});

// ---- Herramienta de actividades con proveedor simulado ----
let n = 0;
const ej = (items: any[]) => ({ items, status: 'SUCCEEDED', runId: 'r1', datasetId: 'd1', consultas: [] }) as any;
const it = (extra: Record<string, unknown>) => ({ title: 'Tour', url: `https://www.civitatis.com/es/bruselas/a${++n}/`, platform: 'civitatis', priceFrom: 20, city: 'Brussels', latitude: 50.8467, longitude: 4.3525, ...extra });

test('herramienta: categorías, «cualquier tipo» (las cuatro) y sin categorías devuelven resultados; ninguna impide buscar', async () => {
  const datos = [it({ title: 'Museo Magritte' }), it({ title: 'Ruta de la cerveza' })];
  for (const tipos of [[], ['cultura'], ['cultura', 'gastronomía'], [...CATEGORIAS_ACTIVIDADES]]) {
    let llamadas = 0;
    const r = await buscarActividadesDestino({ destino: 'Bruselas', tipos }, async () => { llamadas++; return ej(datos); });
    assert.equal(llamadas, 1, JSON.stringify(tipos));
    assert.equal(r.estado, 'ok', JSON.stringify(tipos));
    assert.equal(r.actividades.length, 2, `no se filtra por categoría: ${JSON.stringify(tipos)}`);
  }
});

test('estados distintos: error de proveedor ≠ búsqueda sin resultados', async () => {
  const vacia = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => ej([]));
  const fallo = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => { throw new Error('boom'); });
  assert.equal(vacia.estado, 'sin_resultados');
  assert.equal(fallo.estado, 'error');
});

// ---- Interfaz ----
async function preparar(viewport = { width: 1280, height: 900 }) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport });
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  const peticiones: any[] = [];
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => { peticiones.push(JSON.parse(r.request().postData() || '{}')); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: 'Respuesta ficticia' }) }); });
  return { p, base, peticiones, errores, cerrar: async () => { await b.close(); cerrar(); } };
}
async function lanzar(t: any, modo: string, marcar: string[]) {
  await t.p.goto(t.base + '/');
  await t.p.click(`.search-tab[data-mode="${modo}"]`);
  await t.p.fill('#destino', 'Bruselas');
  for (const v of marcar) await t.p.check(`.actividades-form input[value="${v}"]`);
  await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
  await t.p.waitForSelector('#conversacion .conv-msg');
  return t.peticiones[0];
}

test('bloque visual: pregunta en negrita, texto explicativo, cinco opciones y coral de acento', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    assert.equal(await t.p.locator('#actividadesTitulo').innerText(), '¿Quieres añadir actividades a tu viaje?');
    assert.ok(Number(await t.p.locator('#actividadesTitulo').evaluate((e: Element) => getComputedStyle(e).fontWeight)) >= 600, 'pregunta en negrita');
    assert.match(await t.p.locator('#actividadesAyuda').innerText(), /experiencias y actividades adaptadas al destino y a las fechas/);
    const opciones = await t.p.locator('.actividades-form .preferences label').allInnerTexts();
    assert.deepEqual(opciones.map((x: string) => x.trim()), ['Cultura', 'Gastronomía', 'Naturaleza', 'Aventura', 'Cualquier tipo']);
    assert.equal(await t.p.locator('.actividades-form input:checked').count(), 0, 'selección opcional: nada marcado por defecto');
    await t.p.check('.actividades-form input[value="cultura"]');
    const borde = await t.p.locator('.actividades-form label:has(input[value="cultura"])').evaluate((e: Element) => getComputedStyle(e).borderColor);
    assert.equal(borde, 'rgb(231, 119, 95)', 'acento coral de Mogavel');
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('«Cualquier tipo» y categorías concretas se excluyen; varias categorías se pueden combinar', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    await t.p.check('.actividades-form input[value="cultura"]');
    await t.p.check('.actividades-form input[value="aventura"]');
    assert.equal(await t.p.locator('.actividades-form input:checked').count(), 2);
    await t.p.check('#actCualquiera');
    assert.equal(await t.p.locator('.actividades-form input:checked').count(), 1, 'al elegir «Cualquier tipo» se desmarcan las categorías');
    await t.p.check('.actividades-form input[value="naturaleza"]');
    assert.equal(await t.p.locator('#actCualquiera').isChecked(), false, 'al elegir una categoría se desmarca «Cualquier tipo»');
  } finally { await t.cerrar(); }
});

const CASOS: Array<[string, string[], { solicitadas: boolean; tipos: string[]; cualquiera: boolean }]> = [
  ['completa sin actividades', [], { solicitadas: false, tipos: [], cualquiera: false }],
  ['completa con Cultura', ['cultura'], { solicitadas: true, tipos: ['cultura'], cualquiera: false }],
  ['completa con varias categorías', ['cultura', 'gastronomía', 'aventura'], { solicitadas: true, tipos: ['cultura', 'gastronomía', 'aventura'], cualquiera: false }],
  ['completa con «Cualquier tipo»', ['cualquiera'], { solicitadas: true, tipos: [], cualquiera: true }],
];
for (const [nombre, marcar, esperado] of CASOS) {
  test(`búsqueda ${nombre}: llega al backend y el seguimiento conserva la selección`, { skip: omitir }, async () => {
    const t = await preparar();
    try {
      const b = await lanzar(t, 'complete', marcar);
      assert.equal(b.modo, 'complete');
      assert.deepEqual(b.actividades, esperado);
      if (!esperado.solicitadas) assert.doesNotMatch(b.message, /actividades/i, 'no se interpreta que quiere actividades');
      else if (esperado.cualquiera) assert.match(b.message, /actividades de cualquier tipo/);
      else assert.match(b.message, new RegExp(esperado.tipos[0]!));
      await t.p.fill('#chatMessage', 'Dime más opciones');
      await t.p.click('#enviarSeguimiento');
      await t.p.waitForFunction(() => document.querySelectorAll('#conversacion > .conv-msg').length >= 3);
      assert.equal(t.peticiones.length, 2);
      assert.deepEqual(t.peticiones[1].actividades, esperado, 'seguimiento: mismas preferencias');
      assert.equal(t.peticiones[1].modo, 'complete');
      assert.deepEqual(t.errores, []);
    } finally { await t.cerrar(); }
  });
}

test('«Solo actividades»: destino sin origen ni fechas en el formulario; siempre pide actividades (sin categoría = cualquiera)', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    const b = await lanzar(t, 'activities', []);
    assert.equal(b.modo, 'activities');
    assert.deepEqual(b.actividades, { solicitadas: true, tipos: [], cualquiera: true });
    assert.doesNotMatch(b.message, /Madrid|vuelo|2027/);
    assert.equal('fechas' in b, false);
  } finally { await t.cerrar(); }
  const t2 = await preparar();
  try {
    const b = await lanzar(t2, 'activities', ['gastronomía']);
    assert.deepEqual(b.actividades, { solicitadas: true, tipos: ['gastronomía'], cualquiera: false });
  } finally { await t2.cerrar(); }
});

test('vuelos y hoteles: el bloque no se muestra y no se envía «actividades»', { skip: omitir }, async () => {
  for (const modo of ['flights', 'hotels'] as const) {
    const t = await preparar();
    try {
      await t.p.goto(t.base + '/');
      await t.p.check('.actividades-form input[value="cultura"]');
      await t.p.click(`.search-tab[data-mode="${modo}"]`);
      assert.equal(await t.p.locator('#actividadesForm').isVisible(), false, `${modo}: bloque oculto`);
      await t.p.fill('#destino', 'Bruselas');
      if (modo === 'flights') await t.p.fill('#origen', 'Madrid');
      await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
      await t.p.waitForSelector('#conversacion .conv-msg');
      assert.equal('actividades' in t.peticiones[0], false);
      assert.doesNotMatch(t.peticiones[0].message, /cultura|actividades/i, 'una categoría marcada y luego oculta no viaja');
    } finally { await t.cerrar(); }
  }
});

test('estado vacío de actividades: «no solicitadas» se distingue de «sin resultados todavía», y el bloque con estado propio gana', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await lanzar(t, 'complete', []);
    assert.match(await t.p.locator('#panel-actividades').evaluate((e: HTMLElement) => e.dataset.vacio!), /No has pedido actividades para este viaje/);
  } finally { await t.cerrar(); }
  const t2 = await preparar();
  try {
    await lanzar(t2, 'complete', ['cultura']);
    assert.match(await t2.p.locator('#panel-actividades').evaluate((e: HTMLElement) => e.dataset.vacio!), /Aún no hay actividades/);
    // Con bloques reales: sin resultados y error de proveedor tienen cada uno su aviso (no se confunden con «no solicitadas»).
    const avisos = await t2.p.evaluate(() => {
      const D = (globalThis as any).MogavelDatos;
      const bloque = (estado: string, error: string | null) => ({ version: 1, vuelos: [], hoteles: [], actividades: [{ tipo: 'actividades', estado, error, avisos: [], completo: estado !== 'error_proveedor', consulta: { destino: 'Bruselas', tipos: [] }, total: 0, opciones: [], diagnostico: {} }] });
      return ['sin_resultados', 'error_proveedor'].map((e) => { const p = D.paneles(bloque(e, e === 'error_proveedor' ? 'Apify caído' : null)); return p.actividades.map((n: HTMLElement) => n.textContent).join(' | '); });
    });
    assert.match(avisos[0]!, /Sin actividades/i);
    assert.match(avisos[1]!, /No se han podido consultar/i);
    assert.match(avisos[1]!, /Apify caído/);
  } finally { await t2.cerrar(); }
});
