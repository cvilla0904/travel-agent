// Panel «Tu selección» (public/trip-builder.js): total comparable real en lugar del aviso fijo de «precios pendientes».
// Chromium real con el script real y tarjetas pintadas por render-datos.js desde datos estructurados. Sin red ni proveedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bloqueVuelos, bloqueHoteles, bloqueActividades, agruparBloques } from '../src/services/resultados-estructurados.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

/* ---------- datos con la forma real de las herramientas ---------- */
const seg = (o: string, d: string) => ({ aeropuertoSalida: o, codigoSalida: o, horaSalida: '08:00', aeropuertoLlegada: d, codigoLlegada: d, horaLlegada: '10:00', duracionMinutos: 120, aerolinea: 'Iberia', numeroVuelo: 'IB1' });
const vuelo = (extra: Record<string, unknown> = {}) => ({
  aerolinea: 'Iberia', precioTotal: 240, precioPorPersona: 120, moneda: 'EUR', enlace: 'https://www.google.com/travel/flights?q=x', esIdaVuelta: true, tipo: 'Ida y vuelta',
  escalasIda: 0, escalasVuelta: 0, esDirecto: true,
  ida: { fecha: '2027-01-13', duracionMinutos: 120, segmentos: [seg('MAD', 'BRU')] }, vuelta: { fecha: '2027-01-17', duracionMinutos: 120, segmentos: [seg('BRU', 'MAD')] }, ...extra,
});
const hotel = (nombre: string, extra: Record<string, unknown> = {}) => ({
  nombre, estrellas: 4, valoracion: 8.5, valoracionEscala: 10, numeroResenas: 100, precioTotal: 332, precioPorNoche: 83, moneda: 'EUR', precioDisponible: true,
  precioCalculado: false, url: 'https://www.booking.com/hotel/' + encodeURIComponent(nombre), ...extra,
});
const act = (nombre: string, extra: Record<string, unknown> = {}) => ({
  nombre, precio: 20, moneda: 'EUR', esGratis: false, plataforma: 'civitatis', url: 'https://www.civitatis.com/es/' + encodeURIComponent(nombre), duracion: '2 h', ...extra,
});
const DATOS = agruparBloques([
  bloqueVuelos({ origen: 'Madrid', destino: 'Bruselas', aeropuertoOrigen: 'MAD', aeropuertoDestino: 'BRU', fechaIda: '2027-01-13', fechaVuelta: '2027-01-17', pasajeros: 2, estado: 'ok', error: null, direccionesConError: [], avisos: [], vuelos: [vuelo()] }),
  bloqueHoteles({ destino: 'Bruselas', fechaEntrada: '2027-01-13', fechaSalida: '2027-01-17', adultos: 2, estado: 'ok', error: null, hoteles: [hotel('Hotel Ochenta y Tres')], diagnostico: { sinPrecio: 0 } }),
  bloqueActividades({ destino: 'Bruselas', tipos: [], estado: 'ok', mensaje: null, actividades: [
    act('Atomium', { precio: 20 }), act('Chocolate', { precio: 25 }), act('Tour USD', { precio: 30, moneda: 'USD' }),
    act('Sin precio', { precio: null, moneda: '' }), act('Tour gratis', { precio: null, esGratis: true }),
  ] }),
]);

async function nueva() {
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const p = await b.newPage();
  await p.setContent('<input id="chatMessage"><div id="results"></div>');
  await p.addScriptTag({ content: 'window.__name = (f) => f;' });
  await p.addScriptTag({ path: path.join(root, 'public/render-datos.js') });
  await p.addScriptTag({ path: path.join(root, 'public/trip-builder.js') });
  await p.evaluate((d: any) => (globalThis as any).MogavelDatos.renderizar(d, document.getElementById('results')), DATOS);
  await p.waitForSelector('#results .mtb-select');
  return { b, p };
}
const elegir = async (p: any, tarjeta: string, nombre: string) => {
  await p.locator(`${tarjeta}:has-text("${nombre}") .mtb-select`).first().click();
};
const total = (p: any) => p.evaluate(() => {
  const e = document.querySelector('#mogavel-trip-builder .mtb-total') as HTMLElement;
  return { texto: (e.innerText || '').replace(/\s+/g, ' ').trim(), estado: e.dataset.estado };
});
const items = (p: any) => p.evaluate(() => [...document.querySelectorAll('#mogavel-trip-builder .mtb-item-copy')].map((e: any) => e.innerText.replace(/\s+/g, ' ').trim()));

/* ---------- escenarios reales del panel ---------- */

test('un único hotel de 83 € por noche muestra su importe y NO el aviso de precios pendientes', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.hotel-card', 'Hotel Ochenta y Tres');
    const t = await total(p);
    assert.equal(t.estado, 'total');
    assert.match(t.texto, /83,00\s?€ \/ noche/);
    assert.doesNotMatch(t.texto, /pendientes|monedas distintas/);
    assert.match((await items(p))[0]!, /83,00\s?€ por noche/, 'el importe individual del elemento se conserva');
  } finally { await b.close(); }
});

test('dos actividades comparables (mismo concepto «desde» y misma moneda) permiten calcular el total', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.activity-card', 'Atomium');
    await elegir(p, '.activity-card', 'Chocolate');
    const t = await total(p);
    assert.equal(t.estado, 'total');
    assert.match(t.texto, /Total estimado/);
    assert.match(t.texto, /Desde 45,00\s?€/);
    assert.doesNotMatch(t.texto, /pendientes/);
  } finally { await b.close(); }
});

test('una actividad gratuita no impide el total ni cambia su concepto', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.activity-card', 'Atomium');
    await elegir(p, '.activity-card', 'Tour gratis');
    const t = await total(p);
    assert.equal(t.estado, 'total');
    assert.match(t.texto, /Desde 20,00\s?€/);
  } finally { await b.close(); }
});

test('monedas diferentes generan el aviso y no se suman', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.activity-card', 'Atomium');
    await elegir(p, '.activity-card', 'Tour USD');
    const t = await total(p);
    assert.equal(t.estado, 'aviso');
    assert.match(t.texto, /monedas distintas/);
    assert.doesNotMatch(t.texto, /Desde 50|Desde 50,00/);
    const lineas = await items(p);
    assert.ok(lineas.some((l: string) => /20,00\s?€/.test(l)) && lineas.some((l: string) => /30,00\s?US\$/.test(l) || /30,00/.test(l)), 'cada importe individual se conserva');
  } finally { await b.close(); }
});

test('un precio desconocido genera el aviso con su causa concreta', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.activity-card', 'Atomium');
    await elegir(p, '.activity-card', 'Sin precio');
    const t = await total(p);
    assert.equal(t.estado, 'aviso');
    assert.match(t.texto, /sin importe confirmado/);
    assert.doesNotMatch(t.texto, /monedas distintas/, 'solo se indica la causa real');
  } finally { await b.close(); }
});

test('precio por noche + total de estancia no se suman: aviso de conceptos distintos', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.flight-card', 'Iberia');
    await elegir(p, '.hotel-card', 'Hotel Ochenta y Tres');
    const t = await total(p);
    assert.equal(t.estado, 'aviso');
    assert.match(t.texto, /conceptos distintos/);
    assert.doesNotMatch(t.texto, /323|240,00\s?€ \/ noche|\b323,00/);
    const lineas = await items(p);
    assert.equal(lineas.length, 2);
    assert.match(lineas.join(' | '), /240,00\s?€ total/);
    assert.match(lineas.join(' | '), /83,00\s?€ por noche/);
  } finally { await b.close(); }
});

test('sin selección el panel está oculto y al quitar el elemento desaparece el total', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    await elegir(p, '.hotel-card', 'Hotel Ochenta y Tres');
    await p.click('#mogavel-trip-builder .mtb-remove');
    assert.equal(await p.locator('#mogavel-trip-builder').isVisible(), false);
  } finally { await b.close(); }
});

/* ---------- función pura (la misma que usa el panel) ---------- */

const resumen = (p: any, lista: unknown[]) => p.evaluate((l: any) => (globalThis as any).MogavelTripBuilder.resumenPrecios(l), lista);
const P = (value: number, currency: string | null, basis: string) => ({ price: { value, currency, basis } });

test('resumenPrecios: sumas comparables, gratuitos y causas del aviso', { skip: omitir }, async () => {
  const { b, p } = await nueva();
  try {
    assert.deepEqual(await resumen(p, []), { total: null, motivos: [], aviso: null });
    assert.deepEqual((await resumen(p, [P(83, 'EUR', 'noche')])).total, { value: 83, currency: 'EUR', basis: 'noche' });
    assert.deepEqual((await resumen(p, [P(240, 'EUR', 'total'), P(332, 'EUR', 'total')])).total, { value: 572, currency: 'EUR', basis: 'total' });
    assert.deepEqual((await resumen(p, [P(0.1, 'EUR', 'desde'), P(0.2, 'EUR', 'desde')])).total, { value: 0.3, currency: 'EUR', basis: 'desde' }, 'sin errores de coma flotante');
    assert.deepEqual((await resumen(p, [{ price: { value: 0, currency: null, basis: 'gratuita', free: true } }])).total, { value: 0, currency: null, basis: 'gratuita' });
    assert.deepEqual((await resumen(p, [P(20, 'EUR', 'desde'), P(30, 'USD', 'desde')])).motivos, ['monedas_distintas']);
    assert.deepEqual((await resumen(p, [P(20, 'EUR', 'desde'), { price: null }])).motivos, ['sin_importe']);
    assert.deepEqual((await resumen(p, [P(20, null, 'desde')])).motivos, ['moneda_no_confirmada']);
    assert.deepEqual((await resumen(p, [P(83, 'EUR', 'noche'), P(240, 'EUR', 'total')])).motivos, ['conceptos_distintos']);
    assert.deepEqual((await resumen(p, [P(83, 'EUR', 'noche'), P(20, 'USD', 'desde'), { price: null }])).motivos, ['sin_importe', 'monedas_distintas', 'conceptos_distintos']);
    const r = await resumen(p, [P(83, 'EUR', 'noche'), P(240, 'EUR', 'total')]);
    assert.equal(r.total, null);
    assert.match(r.aviso, /No se calcula un total conjunto/);
  } finally { await b.close(); }
});
