// Flujo portada → /resultados.html con pestañas, en Chromium, con respuestas FICTICIAS del agente.
// Sin red externa: /api/chat se intercepta y se cuenta. Si Playwright/Chromium no están, se omite.
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

const U = 'https://www.civitatis.com/es/roma/tour-coliseo/';
const RESPUESTA = `## Madrid → Roma
**Fechas:** 2027-01-11 – 2027-01-18
**Viajeros:** 2

### Vuelos
- **Aerolínea Alfa**: 240 € | Directo | [Ver búsqueda](https://www.google.com/travel/flights?q=alfa&hl=es)
- **Aerolínea Beta**: 310 € | 1 escala | [Ver búsqueda](https://www.google.com/travel/flights?q=beta&hl=es)

### Alojamientos
- **Hotel Ficticio Centro** — 120 € por noche — [Ver alojamiento](https://example.test/h1)
- **Hotel Ficticio Dos** — 95 € por noche — [Ver alojamiento](https://example.test/h2)

### Actividades
- **Coliseo, Foro y Palatino** — Desde 62,10 EUR por persona — 3 h — [Ver actividad](${U})
- **Basílica de San Pedro** — Desde 30,34 € — 2 h — [Ver actividad](${U}2)
- **Free tour del centro** — GRATUITA — 2 h — [Ver actividad](${U}3)
- **Visita sin tarifa** — 1 h — [Ver actividad](${U}4)
`;
const SOLO_HOTELES = `### Alojamientos
- **Hotel Nuevo Trastevere** — 140 € por noche — [Ver alojamiento](https://example.test/h3)
`;
const PRESUPUESTO = `### Presupuesto
Total conocido: 240 €. Quedan importes pendientes de confirmar.`;

async function preparar(opciones: { respuestas?: Array<{ status?: number; texto?: string }>; viewport?: { width: number; height: number }; bloquearAlmacen?: boolean } = {}) {
  const { base, cerrar } = await servirFrontend(root);
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const ctx = await b.newContext({ viewport: opciones.viewport || { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const errores: string[] = [];
  p.on('pageerror', (e: Error) => errores.push(e.message));
  const peticiones: any[] = [];
  const cola = [...(opciones.respuestas || [{ texto: RESPUESTA }])];
  await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
  await p.route('**/api/chat', (r: any) => {
    peticiones.push(JSON.parse(r.request().postData() || '{}'));
    const n = cola.length > 1 ? cola.shift()! : cola[0]!;
    r.fulfill({ status: n.status || 200, contentType: 'application/json', body: JSON.stringify(n.status && n.status >= 400 ? { error: 'Fallo simulado' } : { response: n.texto }) });
  });
  if (opciones.bloquearAlmacen) {
    await p.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('bloqueado'); } }); });
  }
  return { p, base, peticiones, errores, cerrar: async () => { await b.close(); cerrar(); } };
}

async function buscarDesdePortada(p: any, base: string) {
  await p.goto(base + '/');
  await p.fill('#ideaViaje', 'Quiero viajar de Madrid a Roma del 11 al 18 de enero de 2027 para 2 personas');
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
  await p.waitForSelector('#panel-vuelos .flight-card');
}

const visibles = (p: any) => p.evaluate(() => ['vuelos', 'hoteles', 'actividades'].filter((t) => !(document.getElementById('panel-' + t) as HTMLElement).hidden));
const cuenta = (p: any, sel: string) => p.evaluate((s: string) => document.querySelectorAll(s).length, sel);
const itemsPanel = (p: any) => p.evaluate(() => [...document.querySelectorAll('#mogavel-trip-builder .mtb-item-copy')].map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

test('portada → resultados: una sola llamada al agente, tres paneles montados y solo uno visible', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    assert.equal(t.peticiones.length, 1, 'una sola llamada a /api/chat');
    const estado = await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer());
    assert.equal(t.peticiones[0].sessionId, estado.sessionId, 'el sessionId viaja a la página de resultados');
    assert.match(t.peticiones[0].message, /Madrid a Roma/);
    assert.deepEqual(await visibles(t.p), ['vuelos']);
    assert.equal(await cuenta(t.p, '#panel-vuelos .flight-card'), 2);
    assert.equal(await cuenta(t.p, '#panel-hoteles .hotel-card'), 2);
    assert.equal(await cuenta(t.p, '#panel-actividades .activity-card'), 4);
    const chips = await t.p.evaluate(() => [...document.querySelectorAll('.res-count')].map((e) => e.textContent));
    assert.deepEqual(chips, ['2', '2', '4']);
    assert.match(await t.p.evaluate(() => document.getElementById('resumen')!.innerText), /Madrid → Roma/);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('pestañas: cambiar de pestaña solo alterna hidden, sin nuevas llamadas ni pérdida de contenido', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    const antes = await t.p.evaluate(() => document.getElementById('panel-hoteles')!.innerHTML);
    // Marca el nodo para comprobar que NO se recrea al cambiar de pestaña.
    await t.p.evaluate(() => { (document.querySelector('#panel-hoteles .hotel-card') as any).__marca = 'mismo-nodo'; });
    await t.p.click('#tab-hoteles');
    assert.deepEqual(await visibles(t.p), ['hoteles']);
    assert.equal(await t.p.evaluate(() => location.hash), '#hoteles');
    await t.p.click('#tab-actividades');
    assert.deepEqual(await visibles(t.p), ['actividades']);
    await t.p.click('#tab-vuelos');
    await t.p.click('#tab-hoteles');
    assert.equal(await t.p.evaluate(() => (document.querySelector('#panel-hoteles .hotel-card') as any).__marca), 'mismo-nodo');
    assert.equal(await t.p.evaluate(() => document.getElementById('panel-hoteles')!.innerHTML), antes);
    assert.equal(t.peticiones.length, 1);
    // Los tres paneles siguen en el DOM.
    assert.equal(await cuenta(t.p, '.res-panel'), 3);
    // Teclado: flecha derecha pasa a la siguiente pestaña.
    await t.p.focus('#tab-hoteles'); await t.p.keyboard.press('ArrowRight');
    assert.deepEqual(await visibles(t.p), ['actividades']);
  } finally { await t.cerrar(); }
});

test('selecciones: se conservan al cambiar de pestaña, se cambian y se quitan sin perder las demás', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    await t.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
    await t.p.click('#tab-hoteles');
    await t.p.click('#panel-hoteles .hotel-card:nth-of-type(1) .mtb-select');
    await t.p.click('#tab-actividades');
    await t.p.click('#panel-actividades .activity-card:nth-of-type(1) .mtb-select');
    await t.p.click('#panel-actividades .activity-card:nth-of-type(2) .mtb-select');
    assert.equal((await itemsPanel(t.p)).length, 4);
    // Cambiar de pestaña no pierde nada y el botón sigue marcado.
    await t.p.click('#tab-vuelos');
    assert.equal(await t.p.getAttribute('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select', 'aria-pressed'), 'true');
    assert.equal((await itemsPanel(t.p)).length, 4);
    // Cambiar el vuelo: reemplaza solo el vuelo.
    await t.p.click('#panel-vuelos .flight-card:nth-of-type(2) .mtb-select');
    let items = await itemsPanel(t.p);
    assert.equal(items.length, 4);
    assert.ok(items.some((x: string) => /Beta/.test(x)) && !items.some((x: string) => /Alfa/.test(x)));
    // Quitar una actividad desde el panel «TU VIAJE»: las demás siguen.
    await t.p.evaluate(() => { document.querySelector('#mogavel-trip-builder').classList.remove('mtb-collapsed'); });
    await t.p.click('#mogavel-trip-builder .mtb-remove >> nth=-1');
    items = await itemsPanel(t.p);
    assert.equal(items.length, 3);
    assert.ok(items.some((x: string) => /Beta/.test(x)));
    assert.ok(items.some((x: string) => /Hotel Ficticio Centro/.test(x)));
    // Y el botón de la tarjeta quitada vuelve a «Añadir».
    await t.p.click('#tab-actividades');
    assert.equal(await t.p.getAttribute('#panel-actividades .activity-card:nth-of-type(2) .mtb-select', 'aria-pressed'), 'false');
    assert.equal(await t.p.getAttribute('#panel-actividades .activity-card:nth-of-type(1) .mtb-select', 'aria-pressed'), 'true');
    // Recuento en la pestaña.
    assert.equal(await t.p.getAttribute('[data-count="actividades"]', 'data-sel'), '1');
  } finally { await t.cerrar(); }
});

test('persistencia: al recargar no se repite la búsqueda y se restauran respuesta, sessionId y selecciones', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    const sid = (await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer())).sessionId;
    await t.p.click('#tab-hoteles');
    await t.p.click('#panel-hoteles .hotel-card:nth-of-type(2) .mtb-select');
    await t.p.click('#tab-actividades');
    await t.p.click('#panel-actividades .activity-card:nth-of-type(1) .mtb-select');
    await t.p.reload();
    await t.p.waitForSelector('#panel-actividades .activity-card');
    assert.equal(t.peticiones.length, 1, 'recargar no vuelve a llamar al agente');
    assert.equal((await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer())).sessionId, sid);
    assert.equal(await t.p.evaluate(() => location.hash), '#actividades');
    assert.deepEqual(await visibles(t.p), ['actividades']);
    assert.equal(await cuenta(t.p, '#panel-vuelos .flight-card'), 2);
    assert.equal(await t.p.getAttribute('#panel-actividades .activity-card:nth-of-type(1) .mtb-select', 'aria-pressed'), 'true');
    // La selección de un panel oculto también se restaura (ids estables, independientes de la pestaña visible).
    assert.equal(await t.p.getAttribute('#panel-hoteles .hotel-card:nth-of-type(2) .mtb-select', 'aria-pressed'), 'true');
    assert.equal((await itemsPanel(t.p)).length, 2);
    // Volver a la portada y regresar conserva todo.
    await t.p.goto(t.base + '/'); await t.p.goBack();
    await t.p.waitForSelector('#panel-actividades .activity-card');
    assert.equal(t.peticiones.length, 1);
    assert.equal((await itemsPanel(t.p)).length, 2);
  } finally { await t.cerrar(); }
});

test('precios: cerrado, «desde», gratuito y pendiente se conservan en pestañas, panel y contexto enviado al agente', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: PRESUPUESTO }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await t.p.click('#tab-actividades');
    const badges = await t.p.evaluate(() => [...document.querySelectorAll('.activity-price-badge')].map((e) => (e as HTMLElement).innerText.trim()));
    assert.deepEqual(badges, ['DESDE 62,10 €', 'DESDE 30,34 €', 'GRATUITA', 'PRECIO POR CONFIRMAR']);
    for (let i = 1; i <= 4; i++) await t.p.click(`#panel-actividades .activity-card:nth-of-type(${i}) .mtb-select`);
    await t.p.click('#tab-hoteles'); await t.p.click('#panel-hoteles .hotel-card:nth-of-type(1) .mtb-select');
    await t.p.click('#tab-vuelos'); await t.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
    const snap = await t.p.evaluate(() => (globalThis as any).MogavelTripBuilder.snapshot());
    const precio = (n: string) => snap.find((s: any) => s.name.includes(n)).price;
    assert.deepEqual(precio('Coliseo'), { value: 62.1, currency: 'EUR', basis: 'desde' });
    assert.deepEqual(precio('San Pedro'), { value: 30.34, currency: 'EUR', basis: 'desde' });
    assert.equal(precio('Free tour').free, true);
    assert.equal(precio('Visita sin tarifa'), null);
    assert.equal(precio('Alfa').basis, undefined, 'el vuelo es precio cerrado, no «desde»');
    assert.equal(precio('Alfa').value, 240);
    const panel = (await itemsPanel(t.p)).join(' | ');
    assert.match(panel, /Coliseo, Foro y Palatino.*Desde 62,10/);
    assert.match(panel, /Free tour del centro Gratuita/);
    assert.match(panel, /Visita sin tarifa Precio por confirmar/);
    // Seguimiento: el mensaje lleva el contexto con los precios tal cual y el MISMO sessionId.
    await t.p.fill('#chatMessage', 'Calcula el presupuesto');
    await t.p.click('#enviarSeguimiento');
    await t.p.waitForSelector('#notas .res-nota');
    assert.equal(t.peticiones.length, 2);
    assert.equal(t.peticiones[1].sessionId, t.peticiones[0].sessionId);
    const m = t.peticiones[1].message as string;
    assert.match(m, /Coliseo, Foro y Palatino \(precio orientativo "desde" del proveedor: 62\.1 EUR; no es un precio final garantizado\)/);
    assert.match(m, /Free tour del centro \(gratuita según el proveedor\)/);
    assert.match(m, /Visita sin tarifa \(importe no identificado\)/);
    assert.match(m, /Vuelo: Aerolínea Alfa \(importe mostrado: 240 EUR\)/);
    // El presupuesto (texto) va a notas y no destruye las pestañas ni las selecciones.
    assert.match(await t.p.evaluate(() => document.getElementById('notas')!.innerText), /Total conocido: 240/);
    assert.equal(await cuenta(t.p, '.flight-card'), 2);
    assert.equal((await itemsPanel(t.p)).length, 6);
  } finally { await t.cerrar(); }
});

test('respuesta de seguimiento solo con hoteles: actualiza Hoteles y conserva Vuelos, Actividades y selecciones', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: SOLO_HOTELES }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await t.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
    await t.p.click('#tab-actividades'); await t.p.click('#panel-actividades .activity-card:nth-of-type(1) .mtb-select');
    await t.p.fill('#chatMessage', 'Busca otro hotel'); await t.p.click('#enviarSeguimiento');
    await t.p.waitForFunction(() => document.querySelectorAll('#panel-hoteles .hotel-card').length === 1);
    assert.equal(await cuenta(t.p, '.flight-card'), 2);
    assert.equal(await cuenta(t.p, '.activity-card'), 4);
    assert.equal((await itemsPanel(t.p)).length, 2, 'las selecciones previas siguen');
    assert.match(await t.p.evaluate(() => document.getElementById('panel-hoteles')!.innerText), /Nuevo Trastevere/);
    // Y tras recargar se reconstruye el mismo estado a partir de las dos respuestas guardadas.
    await t.p.reload(); await t.p.waitForSelector('#panel-actividades .activity-card', { state: 'attached' });
    assert.equal(await cuenta(t.p, '.hotel-card'), 1);
    assert.equal(await cuenta(t.p, '.flight-card'), 2);
    assert.equal(t.peticiones.length, 2);
  } finally { await t.cerrar(); }
});

test('multidestino: cada ciudad se reparte entre Hoteles y Actividades con su título', { skip: omitir }, async () => {
  const md = `### Roma — 3 días
#### Alojamientos recomendados
- **Hotel Roma Uno** — 100 € por noche — [Ver alojamiento](https://example.test/r1)
#### Actividades
- **Coliseo** — Desde 62,10 EUR por persona — 3 h — [Ver actividad](${U})

### Florencia — 2 días
#### Alojamientos recomendados
- **Hotel Florencia Uno** — 90 € por noche — [Ver alojamiento](https://example.test/f1)
#### Actividades
- **Uffizi** — Desde 25 € — 2 h — [Ver actividad](${U}9)
`;
  const t = await preparar({ respuestas: [{ texto: md }] });
  try {
    await buscarDesdePortada(t.p, t.base).catch(async () => { await t.p.waitForSelector('#panel-hoteles .hotel-card', { state: 'attached' }); });
    assert.equal(await cuenta(t.p, '#panel-hoteles .multicity-section'), 2);
    assert.equal(await cuenta(t.p, '#panel-actividades .multicity-section'), 2);
    assert.equal(await cuenta(t.p, '#panel-hoteles .hotel-card'), 2);
    assert.equal(await cuenta(t.p, '#panel-actividades .activity-card'), 2);
    assert.equal(await cuenta(t.p, '#panel-hoteles .activity-card'), 0);
    assert.equal(await cuenta(t.p, '#panel-actividades .hotel-card'), 0);
    assert.match(await t.p.evaluate(() => document.getElementById('panel-actividades')!.textContent), /Florencia/);
    // Sin vuelos: la pestaña activa pasa a la primera con contenido.
    assert.deepEqual(await visibles(t.p), ['hoteles']);
  } finally { await t.cerrar(); }
});

test('errores: fallo del agente muestra reintento explícito y no repite solo; sin búsqueda activa no se llama al agente', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ status: 500 }, { texto: RESPUESTA }] });
  try {
    await t.p.goto(t.base + '/');
    await t.p.fill('#ideaViaje', 'Quiero viajar de Madrid a Roma del 11 al 18 de enero de 2027 para 2 personas');
    await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.evaluate(() => (globalThis as any).buscarViaje())]);
    await t.p.waitForSelector('#reintentar');
    assert.match(await t.p.evaluate(() => document.getElementById('estado')!.innerText), /Fallo simulado/);
    assert.equal(t.peticiones.length, 1);
    await t.p.reload(); await t.p.waitForSelector('#reintentar');
    assert.equal(t.peticiones.length, 1, 'recargar tras un error no repite la búsqueda');
    await t.p.click('#reintentar');
    await t.p.waitForSelector('#panel-vuelos .flight-card');
    assert.equal(t.peticiones.length, 2);
    // Sin búsqueda activa (estado vacío): mensaje y ninguna llamada.
    await t.p.evaluate(() => (globalThis as any).MogavelEstado.limpiar());
    await t.p.reload();
    assert.match(await t.p.evaluate(() => document.getElementById('estado')!.innerText), /No hay ninguna búsqueda/);
    assert.equal(t.peticiones.length, 2);
  } finally { await t.cerrar(); }
});

test('búsqueda interrumpida (en curso al recargar): no se relanza sola', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/resultados.html');
    await t.p.evaluate(() => { const E = (globalThis as any).MogavelEstado; E.iniciar({ sessionId: 's-x', mensaje: 'Quiero un viaje a Roma', modo: 'complete', formulario: {} }); E.marcarEnCurso(); });
    await t.p.reload(); await t.p.waitForSelector('#reintentar');
    assert.equal(t.peticiones.length, 0);
  } finally { await t.cerrar(); }
});

test('respaldo: si el almacenamiento está bloqueado, la portada conserva el flujo anterior en la misma página', { skip: omitir }, async () => {
  const t = await preparar({ bloquearAlmacen: true });
  try {
    await t.p.goto(t.base + '/');
    await t.p.fill('#ideaViaje', 'Quiero viajar de Madrid a Roma del 11 al 18 de enero de 2027 para 2 personas');
    await t.p.evaluate(() => (globalThis as any).buscarViaje());
    await t.p.waitForSelector('#results .flight-card');
    assert.equal(new URL(t.p.url()).pathname, '/');
    assert.equal(t.peticiones.length, 1);
  } finally { await t.cerrar(); }
});

test('diseño: escritorio = panel flotante abajo a la derecha; móvil = desplegable inferior sin desbordes', { skip: omitir }, async () => {
  const d = await preparar({ viewport: { width: 1280, height: 900 } });
  try {
    await buscarDesdePortada(d.p, d.base);
    await d.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
    const r = await d.p.evaluate(() => { const b = document.getElementById('mogavel-trip-builder')!.getBoundingClientRect(); return { right: b.right, bottom: b.bottom, w: b.width, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth > innerWidth }; });
    assert.ok(Math.abs(r.vw - r.right - 18) <= 1 && Math.abs(r.vh - r.bottom - 18) <= 1, JSON.stringify(r));
    assert.ok(r.w <= 460 && !r.over);
  } finally { await d.cerrar(); }
  const m = await preparar({ viewport: { width: 390, height: 800 } });
  try {
    await buscarDesdePortada(m.p, m.base);
    await m.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
    let r = await m.p.evaluate(() => { const el = document.getElementById('mogavel-trip-builder')!; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, bottom: b.bottom, h: b.height, vw: innerWidth, vh: innerHeight, plegado: el.classList.contains('mtb-collapsed'), over: document.documentElement.scrollWidth > innerWidth }; });
    assert.equal(r.plegado, true, 'plegado al empezar en móvil');
    assert.ok(r.left === 0 && r.right === r.vw && Math.abs(r.vh - r.bottom) <= 1, JSON.stringify(r));
    assert.equal(r.over, false);
    // Se despliega tocando la cabecera y vuelve a plegarse.
    await m.p.click('#mogavel-trip-builder .mtb-head');
    r = await m.p.evaluate(() => { const el = document.getElementById('mogavel-trip-builder')!; return { plegado: el.classList.contains('mtb-collapsed'), h: el.getBoundingClientRect().height, vh: innerHeight } as any; });
    assert.equal(r.plegado, false);
    assert.ok(r.h <= r.vh * 0.73);
    await m.p.click('#mogavel-trip-builder .mtb-head');
    assert.equal(await m.p.evaluate(() => document.getElementById('mogavel-trip-builder')!.classList.contains('mtb-collapsed')), true);
    // Las tres pestañas caben sin scroll horizontal de la página.
    const tabs = await m.p.evaluate(() => [...document.querySelectorAll('.res-tab')].map((e) => { const b = e.getBoundingClientRect(); return [b.left >= 0, b.right <= innerWidth]; }));
    assert.deepEqual(tabs.flat(), [true, true, true, true, true, true]);
  } finally { await m.cerrar(); }
});
