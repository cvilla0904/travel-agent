// Fase 1 (revisión): indicador «Tu viaje» en la portada, orden cronológico de la conversación y presentación
// de presupuesto/itinerario. Chromium real, respuestas FICTICIAS del agente, sin red externa ni proveedores.
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

### Alojamientos
- **Hotel Ficticio Centro** — 120 € por noche — [Ver alojamiento](https://example.test/h1)

### Actividades
- **Coliseo, Foro y Palatino** — Desde 62,10 EUR por persona — 3 h — [Ver actividad](${U})
- **Basílica de San Pedro** — Desde 30,34 € — 2 h — [Ver actividad](${U}2)
- **Free tour del centro** — GRATUITA — 2 h — [Ver actividad](${U}3)
`;

const PLAN = `Te dejo el plan con lo que has elegido.

## Tu itinerario
### Día 1 · 2027-01-11
- Coliseo, Foro y Palatino · 3 h · Desde 62,10 EUR
- Paseo por Trastevere · 2 h · Gratis
### Día 2 · 2027-01-12
- Basílica de San Pedro · 2 h · Desde 30,34 €

## Presupuesto
- Vuelo Aerolínea Alfa: 240 €
- Hotel Ficticio Centro: 120 € por noche
- Coliseo, Foro y Palatino: desde 62,10 EUR
- Free tour del centro: gratuita
- Visita sin tarifa: precio por confirmar
- Total conocido: 422,10 €

## Experiencias complementarias
- Cena con espectáculo de flamenco · 45 €

## Gastronomía
- Trattoria da Enzo · cocina romana tradicional

Si quieres cambiar algo, dímelo.`;

async function preparar(opciones: { respuestas?: Array<{ texto: string }>; viewport?: { width: number; height: number } } = {}) {
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
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: n.texto }) });
  });
  return { p, base, peticiones, errores, cerrar: async () => { await b.close(); cerrar(); } };
}

async function buscarDesdePortada(p: any, base: string) {
  await p.goto(base + '/');
  await p.fill('#ideaViaje', 'Quiero viajar de Madrid a Roma del 11 al 18 de enero de 2027 para 2 personas');
  await Promise.all([p.waitForURL('**/resultados.html**'), p.evaluate(() => (globalThis as any).buscarViaje())]);
  await p.waitForSelector('#panel-vuelos .flight-card');
}

async function elegirYContinuar(p: any) {
  await p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
  await p.click('#tab-hoteles'); await p.click('#panel-hoteles .hotel-card:nth-of-type(1) .mtb-select');
  await p.click('#tab-actividades');
  await p.click('#panel-actividades .activity-card:nth-of-type(1) .mtb-select');
  await p.click('#mogavel-trip-builder .mtb-continue');
  await p.waitForSelector('#conversacion .conv-propuesta');
}

const orden = (p: any) => p.evaluate(() => [...document.querySelectorAll('#conversacion > .conv-msg')].map((e) => e.className.replace('conv-msg ', '').split(' ')[0]));
const enviar = async (p: any, texto: string, esperadas: number) => {
  await p.fill('#chatMessage', texto);
  await p.click('#enviarSeguimiento');
  await p.waitForFunction((n: number) => document.querySelectorAll('#conversacion > .conv-msg').length >= n, esperadas);
};

/* ---------- 1. Portada: indicador «Tu viaje» ---------- */

test('portada: sin viaje guardado no hay indicador; con selección aparece, sin duplicar el panel de selección', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    assert.equal(await t.p.locator('#mogavel-viaje-indicador').isVisible(), false);
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    await t.p.goto(t.base + '/');
    await t.p.waitForSelector('#mogavel-viaje-indicador:not([hidden])');
    assert.match(await t.p.innerText('#mogavel-viaje-indicador .mvi-btn'), /Tu viaje\s*3/);
    assert.equal(await t.p.locator('#mogavel-trip-builder').count(), 0, 'el panel flotante no se duplica en la portada');
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('portada → «Recuperar mi propuesta»: vuelve a resultados con la misma sesión, sin nueva llamada al agente', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    const sesion = await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer().sessionId);
    await t.p.goto(t.base + '/');
    await t.p.click('#mogavel-viaje-indicador .mvi-btn');
    await Promise.all([t.p.waitForURL('**/resultados.html**'), t.p.click('#mogavel-viaje-indicador a.mvi-main')]);
    await t.p.waitForSelector('#conversacion .conv-propuesta');
    assert.equal(await t.p.evaluate(() => (globalThis as any).MogavelEstado.leer().sessionId), sesion);
    assert.equal(t.peticiones.length, 1, 'recuperar no vuelve a buscar');
    assert.equal(await t.p.locator('#mogavel-trip-builder .mtb-item-copy').count(), 3);
    assert.match(await t.p.innerText('#conversacion .conv-propuesta'), /Un viaje elegido por ti/);
  } finally { await t.cerrar(); }
});

test('portada → «Empezar un viaje nuevo»: pide confirmación, cancelar no borra y confirmar limpia selección y conversación', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    await t.p.goto(t.base + '/');
    await t.p.click('#mogavel-viaje-indicador .mvi-btn');
    await t.p.click('[data-accion="nuevo"]');
    assert.match(await t.p.innerText('#mvi-pop'), /¿Empezar un viaje nuevo\?/);
    await t.p.click('[data-accion="cancelar"]');
    assert.ok(await t.p.evaluate(() => sessionStorage.getItem('mogavel:search:v1')), 'cancelar conserva el viaje');
    await t.p.click('[data-accion="nuevo"]'); await t.p.click('[data-accion="confirmar"]');
    assert.equal(await t.p.locator('#mogavel-viaje-indicador').isVisible(), false);
    assert.equal(await t.p.evaluate(() => sessionStorage.getItem('mogavel:search:v1')), null);
    // La selección queda vacía (ausente o sin elementos): nada del viaje anterior.
    assert.deepEqual(await t.p.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('mogavel:trip-selection:v1') || '{}'); return [!!s.flight, !!s.hotel, (s.activities || []).length]; }), [false, false, 0]);
    // Un viaje nuevo no hereda nada del anterior: otra sesión, sin selección y sin conversación previa.
    const sesionAntigua = (t.peticiones[0] as any).sessionId;
    await buscarDesdePortada(t.p, t.base);
    assert.notEqual(t.peticiones[1].sessionId, sesionAntigua);
    assert.equal(await t.p.locator('#mogavel-trip-builder .mtb-item-copy').count(), 0);
    assert.equal(await t.p.locator('#conversacion .conv-msg').count(), 0);
  } finally { await t.cerrar(); }
});

test('portada: con el almacenamiento vacío tras recargar la pestaña no aparece ningún indicador y no hay errores', { skip: omitir }, async () => {
  const t = await preparar();
  try {
    await t.p.goto(t.base + '/');
    await t.p.evaluate(() => sessionStorage.setItem('mogavel:search:v1', '{corrupto'));
    await t.p.reload();
    assert.equal(await t.p.locator('#mogavel-viaje-indicador').isVisible(), false);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

/* ---------- 2. Orden de la conversación ---------- */

test('conversación: propuesta → petición → respuesta, sin tocar el resumen inicial; varias rondas en orden y tras recargar', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: PLAN }, { texto: '## Presupuesto\n- Total conocido: 500 €' }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    assert.deepEqual(await orden(t.p), ['conv-propuesta']);
    const antes = await t.p.innerHTML('#conversacion .conv-propuesta');

    await enviar(t.p, 'Hazme un itinerario y un presupuesto', 3);
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario', 'conv-agente']);
    await enviar(t.p, 'Y ahora solo el presupuesto', 5);
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario', 'conv-agente', 'conv-usuario', 'conv-agente']);

    // El resumen inicial no se ha sobrescrito ni movido.
    assert.equal(await t.p.innerHTML('#conversacion .conv-propuesta'), antes);
    assert.equal(await t.p.locator('#mogavel-trip-review').count(), 1);
    assert.match(await t.p.innerText('#conversacion > :nth-child(2)'), /Hazme un itinerario y un presupuesto/);
    // Misma sesión del agente en todas las peticiones; el contexto de selección viaja con cada una.
    assert.equal(new Set(t.peticiones.map((x: any) => x.sessionId)).size, 1);
    assert.equal(t.peticiones.length, 3);

    // Tras recargar la página se reconstruye exactamente el mismo orden y no se llama de nuevo al agente.
    await t.p.reload(); await t.p.waitForSelector('#conversacion .conv-propuesta');
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario', 'conv-agente', 'conv-usuario', 'conv-agente']);
    assert.equal(t.peticiones.length, 3);
    assert.equal(await t.p.locator('#mogavel-trip-review').count(), 1);
    assert.deepEqual(t.errores, []);
  } finally { await t.cerrar(); }
});

test('conversación: el mensaje del usuario aparece al enviarlo (antes de que responda el agente) y «continuar» de nuevo no duplica la propuesta', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: PLAN }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    // Retiene la respuesta del agente para observar el estado intermedio.
    await t.p.unroute('**/api/chat');
    let liberar: () => void = () => {};
    const puerta = new Promise<void>((r) => { liberar = r; });
    await t.p.route('**/api/chat', async (r: any) => { await puerta; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ response: PLAN }) }); });
    await t.p.fill('#chatMessage', 'Quita el vuelo caro');
    await t.p.click('#enviarSeguimiento');
    await t.p.waitForFunction(() => document.querySelectorAll('#conversacion .conv-usuario').length === 1);
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario']);
    liberar();
    await t.p.waitForSelector('#conversacion .conv-agente');
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario', 'conv-agente']);
    // Pulsar «continuar» otra vez con la misma selección no añade otra propuesta.
    await t.p.click('#mogavel-trip-builder .mtb-continue');
    assert.equal(await t.p.locator('#conversacion .conv-propuesta').count(), 1);
    // Si cambia la selección, se añade una propuesta nueva AL FINAL (cronología) y la anterior se conserva.
    await t.p.click('#tab-actividades'); await t.p.click('#panel-actividades .activity-card:nth-of-type(2) .mtb-select');
    await t.p.click('#mogavel-trip-builder .mtb-continue');
    assert.deepEqual(await orden(t.p), ['conv-propuesta', 'conv-usuario', 'conv-agente', 'conv-propuesta']);
    assert.equal(await t.p.locator('#mogavel-trip-review').count(), 1, 'un solo id');
  } finally { await t.cerrar(); }
});

/* ---------- 3. Presentación de presupuesto e itinerario ---------- */

test('render: presupuesto destacado y desglosado (cerrado / desde / gratis / pendiente), itinerario por días y secciones complementarias', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: PLAN }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    await enviar(t.p, 'Hazme el itinerario y el presupuesto', 3);
    // Presupuesto
    assert.match(await t.p.innerText('.cv-presupuesto .cv-total'), /total conocido[\s\S]*422,10 €/i);
    const grupos = await t.p.evaluate(() => [...document.querySelectorAll('.cv-presupuesto .cv-grupo')].map((g) => [g.className.replace('cv-grupo cv-g-', ''), (g as HTMLElement).innerText.replace(/\s+/g, ' ')]));
    assert.deepEqual(grupos.map((g: any) => g[0]), ['cerrado', 'desde', 'gratis', 'pendiente']);
    assert.match(grupos[0][1], /Vuelo Aerolínea Alfa.*240 €/);
    assert.match(grupos[1][1], /Coliseo, Foro y Palatino.*62,10 EUR/);
    assert.match(grupos[2][1], /Free tour del centro/);
    assert.match(grupos[3][1], /Visita sin tarifa.*precio por confirmar/);
    // Itinerario día a día, con elegidas vs. adicionales (según lo seleccionado en la web)
    assert.equal(await t.p.locator('.cv-itinerario .cv-dia').count(), 2);
    assert.match(await t.p.innerText('.cv-itinerario .cv-dia:nth-child(1) .cv-dia-marca'), /Día 1[\s\S]*2027-01-11/);
    assert.equal(await t.p.locator('.cv-itinerario .cv-item.cv-elegida').count(), 1);
    assert.match(await t.p.innerText('.cv-itinerario .cv-elegida'), /Coliseo, Foro y Palatino[\s\S]*Elegida por ti/);
    assert.equal(await t.p.locator('.cv-itinerario .cv-item.cv-adicional').count(), 2);
    assert.match(await t.p.innerText('.cv-itinerario .cv-adicional'), /Propuesta adicional/);
    // Complementarias y gastronomía
    assert.match(await t.p.innerText('.cv-complementarias'), /flamenco[\s\S]*45 €/);
    assert.match(await t.p.innerText('.cv-gastronomia'), /Trattoria da Enzo[\s\S]*cocina romana/);
    // Texto del agente que no es una sección (introducción, cierre) se conserva íntegro
    const conv = await t.p.innerText('#conversacion .conv-agente');
    assert.match(conv, /Te dejo el plan con lo que has elegido\./);
    assert.match(conv, /Si quieres cambiar algo, dímelo\./);
    // La introducción va antes de las secciones y el cierre fuera de la última tarjeta.
    assert.match(await t.p.innerText('#conversacion .conv-agente .conv-cuerpo > :first-child'), /Te dejo el plan/);
    assert.doesNotMatch(await t.p.innerText('.cv-gastronomia'), /Si quieres cambiar algo/);
    assert.match(await t.p.innerText('#conversacion .conv-agente .conv-cuerpo > :last-child'), /Si quieres cambiar algo/);
    // La caja para pedir cambios sigue ahí, debajo de la conversación
    assert.equal(await t.p.locator('#chatMessage').isVisible(), true);
    assert.ok(await t.p.evaluate(() => document.getElementById('conversacion')!.getBoundingClientRect().bottom <= document.getElementById('chatMessage')!.getBoundingClientRect().top + 1));
    // Las pestañas no cambian por una respuesta de solo texto
    assert.equal(await t.p.locator('#panel-vuelos .flight-card').count(), 1);
  } finally { await t.cerrar(); }
});

test('render: respuesta que no se puede interpretar se muestra completa como texto; HTML del agente no se ejecuta', { skip: omitir }, async () => {
  const raro = 'Mira esto <img src=x onerror="window.__x=1"> y <script>window.__y=1</script> sin estructura ninguna, solo una frase útil.';
  const peligrosa = '## Presupuesto\n- <b onmouseover="window.__z=1">Hotel</b>: 100 €\n- [clic](javascript:window.__w=1): 20 €';
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: raro }, { texto: peligrosa }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    await enviar(t.p, 'Dime algo', 3);
    assert.match(await t.p.innerText('#conversacion .conv-agente'), /sin estructura ninguna, solo una frase útil/);
    await enviar(t.p, 'Y presupuesto', 5);
    assert.equal(await t.p.locator('#conversacion a[href^="javascript"]').count(), 0);
    const flags = await t.p.evaluate(() => [(window as any).__x, (window as any).__y, (window as any).__z, (window as any).__w]);
    assert.deepEqual(flags, [undefined, undefined, undefined, undefined]);
    assert.match(await t.p.innerText('.cv-presupuesto'), /100 €/);
  } finally { await t.cerrar(); }
});

test('render: presupuesto sin filas interpretables se muestra íntegro como texto', { skip: omitir }, async () => {
  const t = await preparar({ respuestas: [{ texto: RESPUESTA }, { texto: '## Presupuesto\nAún no puedo calcular nada fiable; faltan precios de varias actividades.' }] });
  try {
    await buscarDesdePortada(t.p, t.base);
    await elegirYContinuar(t.p);
    await enviar(t.p, 'presupuesto', 3);
    assert.equal(await t.p.locator('.cv-presupuesto .cv-total').count(), 0);
    assert.match(await t.p.innerText('.cv-presupuesto'), /Aún no puedo calcular nada fiable; faltan precios/);
  } finally { await t.cerrar(); }
});

/* ---------- 4. Móvil y escritorio ---------- */

for (const [nombre, viewport] of [['móvil', { width: 390, height: 844 }], ['escritorio', { width: 1280, height: 900 }]] as const) {
  test(`${nombre}: sin desbordamiento horizontal en resultados ni en la portada con el indicador`, { skip: omitir }, async () => {
    const t = await preparar({ viewport: { ...viewport }, respuestas: [{ texto: RESPUESTA }, { texto: PLAN }] });
    try {
      await buscarDesdePortada(t.p, t.base);
      // En móvil el panel es una hoja inferior plegada: se despliega para elegir y continuar.
      const abrir = async () => { await t.p.evaluate(() => document.querySelector('#mogavel-trip-builder')?.classList.remove('mtb-collapsed')); };
      await t.p.click('#panel-vuelos .flight-card:nth-of-type(1) .mtb-select');
      await t.p.click('#tab-actividades'); await t.p.click('#panel-actividades .activity-card:nth-of-type(1) .mtb-select');
      await abrir();
      await t.p.click('#mogavel-trip-builder .mtb-continue');
      await t.p.waitForSelector('#conversacion .conv-propuesta');
      await t.p.fill('#chatMessage', 'itinerario y presupuesto');
      await t.p.evaluate(() => (document.getElementById('enviarSeguimiento') as HTMLElement).click());
      await t.p.waitForSelector('.cv-presupuesto');
      const anchoDoc = () => t.p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      let [sw, cw] = await anchoDoc(); assert.ok(sw <= cw + 1, `resultados desborda: ${sw} > ${cw}`);
      await t.p.goto(t.base + '/'); await t.p.waitForSelector('#mogavel-viaje-indicador:not([hidden])');
      [sw, cw] = await anchoDoc(); assert.ok(sw <= cw + 1, `portada desborda: ${sw} > ${cw}`);
      const caja = await t.p.locator('#mogavel-viaje-indicador .mvi-btn').boundingBox();
      assert.ok(caja && caja.x >= 0 && caja.x + caja.width <= viewport.width, 'el indicador cabe en pantalla');
      await t.p.click('#mogavel-viaje-indicador .mvi-btn');
      const pop = await t.p.locator('#mvi-pop').boundingBox();
      assert.ok(pop && pop.x >= 0 && pop.x + pop.width <= viewport.width, 'el desplegable cabe en pantalla');
    } finally { await t.cerrar(); }
  });
}

test('móvil estrecho (320–414 px): la portada con el indicador no desborda y el botón «Crear cuenta» sigue visible', { skip: omitir }, async () => {
  for (const w of [320, 360, 375, 414]) {
    const t = await preparar({ viewport: { width: w, height: 700 } });
    try {
      await t.p.goto(t.base + '/');
      await t.p.evaluate(() => sessionStorage.setItem('mogavel:trip-selection:v1', JSON.stringify({ flight: { id: 'a' }, hotel: null, activities: [] })));
      await t.p.reload(); await t.p.waitForSelector('#mogavel-viaje-indicador:not([hidden])');
      const [sw, cw] = await t.p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(sw <= cw, `a ${w}px desborda: ${sw} > ${cw}`);
      const login = await t.p.locator('header .login').boundingBox();
      assert.ok(login && login.x + login.width <= w, `a ${w}px «Crear cuenta» queda fuera`);
    } finally { await t.cerrar(); }
  }
});
