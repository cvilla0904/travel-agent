// Fase 1 (sin créditos): límite de gasto, consultas geográficas, ruta agente→frontend y fechas por ciudad.
// Todo con cliente simulado y datos reales guardados; no se llama a Apify ni a ningún proveedor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PRESUPUESTO_ITINERARIO_USD_POR_DEFECTO, TOPE_COSTE_USD_MAXIMO,
  buscarHotelesApifyConEstado, construirConsulta, crearPresupuestoApify, topeCosteDesdeEntorno,
} from '../src/services/apify-hoteles.js';
import { buscarHotelesTramo, normalizarCiudadBusquedaMultidestino, obtenerCodigoPais } from '../src/services/hoteles-multidestino.js';
import { INSTRUCCIONES_HOTELES_APIFY_MANAGER } from '../src/services/hoteles-instrucciones.js';

const leer = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')) as any[];
const BUDAPEST = leer('hoteles-apify-budapest.json');
const COLOMBIA = leer('hoteles-apify-colombia.json');
const sinLog = () => {};
const fechas = { fechaEntrada: '2027-01-04', fechaSalida: '2027-01-08', adultos: 2 };

function cliente(opts: { filas?: any[] | ((input: any) => any[]); status?: string; usage?: number | null } = {}) {
  const llamadas: { input: any; opts: any }[] = [];
  const abortados: string[] = [];
  let ultimo: any[] = [];
  const c = {
    actor: () => ({
      call: async (input: any, o: any) => {
        llamadas.push({ input, opts: o });
        ultimo = typeof opts.filas === 'function' ? opts.filas(input) : (opts.filas ?? []);
        return { id: `run-${llamadas.length}`, status: opts.status ?? 'SUCCEEDED', defaultDatasetId: 'ds', usageTotalUsd: opts.usage === undefined ? 0.04 : opts.usage };
      },
    }),
    dataset: () => ({ listItems: async () => ({ items: ultimo }) }),
    run: (id: string) => ({ abort: async () => { abortados.push(id); } }),
  };
  return { c, llamadas, abortados };
}
const deps = (k: ReturnType<typeof cliente>, extra: Record<string, unknown> = {}) => ({ crearCliente: () => k.c, token: 't-prueba', registrar: sinLog, env: {}, ...extra });

const fetchOriginal = globalThis.fetch;
test.before(() => { globalThis.fetch = (() => { throw new Error('Red no permitida en pruebas'); }) as typeof fetch; });
test.after(() => { globalThis.fetch = fetchOriginal; });

/* ===================== 2. LÍMITE DE GASTO ===================== */

test('gasto: maxTotalChargeUsd se envía siempre a actor.call() (por defecto 0,10 USD)', async () => {
  const k = cliente({ filas: BUDAPEST });
  await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k));
  assert.equal(k.llamadas.length, 1);
  assert.equal(k.llamadas[0]!.opts.maxTotalChargeUsd, 0.1);
  assert.ok(k.llamadas[0]!.opts.waitSecs > 0);
});

test('gasto: la variable de entorno no puede superar el techo absoluto ni ser inválida', () => {
  assert.equal(topeCosteDesdeEntorno('50'), TOPE_COSTE_USD_MAXIMO);
  assert.equal(topeCosteDesdeEntorno('0.05'), 0.05);
  assert.equal(topeCosteDesdeEntorno('0.0001'), 0.01);
  for (const malo of [undefined, '', 'abc', '-1', '0', 'NaN', 'Infinity']) {
    assert.equal(topeCosteDesdeEntorno(malo), 0.1, `valor ${String(malo)}`);
  }
});

test('gasto: con APIFY_HOTELS_MAX_CHARGE_USD=1000 la llamada real lleva el techo (0,25), no 1000', async () => {
  const k = cliente({ filas: BUDAPEST });
  await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k, { env: { APIFY_HOTELS_MAX_CHARGE_USD: '1000' } }));
  assert.equal(k.llamadas[0]!.opts.maxTotalChargeUsd, TOPE_COSTE_USD_MAXIMO);
});

test('gasto: si tras waitSecs la ejecución sigue en marcha, se ABORTA y se devuelve error (no sigue cobrando)', async () => {
  for (const status of ['RUNNING', 'READY']) {
    const k = cliente({ status, filas: [] });
    const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k));
    assert.deepEqual(k.abortados, ['run-1'], status);
    assert.equal(r.estado, 'error_proveedor');
    assert.equal(r.hoteles.length, 0);
  }
});

test('gasto: una ejecución terminada (SUCCEEDED/FAILED/ABORTED/TIMED-OUT) no se aborta de nuevo', async () => {
  for (const status of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']) {
    const k = cliente({ status, filas: BUDAPEST });
    await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k));
    assert.deepEqual(k.abortados, [], status);
  }
});

test('gasto: si el aborto falla, no se lanza excepción y el error no revela el token', async () => {
  const eventos: string[] = [];
  const k = cliente({ status: 'RUNNING' });
  (k.c as any).run = () => ({ abort: async () => { throw new Error('fallo con t-prueba'); } });
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k, { registrar: (e: string, d: any) => eventos.push(e + JSON.stringify(d)) }));
  assert.equal(r.estado, 'error_proveedor');
  assert.ok(eventos.some((e) => e.startsWith('aborto_fallido')));
  assert.ok(!JSON.stringify(eventos).includes('t-prueba'));
});

test('presupuesto: reserva el peor caso, liquida con el coste real y rechaza al agotarse', () => {
  const p = crearPresupuestoApify(0.3);
  assert.equal(p.reservar(0.1), true);
  p.liquidar(0.1, 0.04);
  assert.ok(Math.abs(p.gastadoOReservadoUsd() - 0.04) < 1e-9);
  assert.equal(p.reservar(0.1), true); assert.equal(p.reservar(0.1), true);
  assert.equal(p.reservar(0.1), false, 'no cabe una cuarta');
  assert.equal(crearPresupuestoApify(-5).limiteUsd, PRESUPUESTO_ITINERARIO_USD_POR_DEFECTO);
});

test('presupuesto: con el presupuesto agotado NO se llama a Apify y el estado es limite_uso', async () => {
  const k = cliente({ filas: BUDAPEST });
  const presupuesto = crearPresupuestoApify(0.05); // menos que un tope por ejecución (0,10)
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k, { presupuesto }));
  assert.equal(k.llamadas.length, 0);
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.codigoError, 'limite_uso');
});

test('presupuesto: un itinerario de 4 ciudades con presupuesto 0,25 lanza 2 búsquedas y bloquea las otras 2', async () => {
  const k = cliente({ filas: [], usage: null }); // sin coste conocido → se conserva la reserva completa
  const presupuesto = crearPresupuestoApify(0.25);
  const estados: string[] = [];
  for (const ciudad of ['Bogotá', 'Medellín', 'Cartagena', 'Salento']) {
    const r = await buscarHotelesTramo({ ciudad, ...fechas }, { pais: 'Colombia', adultos: 2 }, { apify: deps(k, { presupuesto }) });
    estados.push(String(r.codigoError ?? r.estado));
  }
  assert.equal(k.llamadas.length, 2);
  assert.deepEqual(estados.slice(2), ['limite_uso', 'limite_uso']);
});

test('presupuesto: un error de Apify tampoco libera la reserva (conservador)', async () => {
  const k = cliente();
  (k.c as any).actor = () => ({ call: async () => { throw Object.assign(new Error('boom'), { statusCode: 500 }); } });
  const presupuesto = crearPresupuestoApify(1);
  await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k, { presupuesto }));
  assert.ok(Math.abs(presupuesto.gastadoOReservadoUsd() - 0.1) < 1e-9);
});

/* ===================== 3. CONSULTAS GEOGRÁFICAS ===================== */

const filasCiudad = (consulta: string) => COLOMBIA.filter((f) => f.searchQuery === consulta);

/** Resultados sintéticos de Bruselas (ETIQUETADOS COMO SINTÉTICOS: no hay ejecución real de Bruselas). */
const sintetico = (n: number, direccion: string, extra: Record<string, unknown> = {}) => ({
  recordType: 'hotel', name: `Hotel sintético ${n}`, category: 'Hotel', rating: 4.2, reviewsCount: 300,
  pricePerNight: 100, totalPrice: 400, totalPriceBeforeTaxes: 400, taxesAndFees: 0, currency: 'EUR', nights: 4,
  address: direccion, latitude: 50.8467, longitude: 4.3525, countryCode: 'BE',
  bookingOptions: [
    { provider: 'Booking.com', totalStayPrice: 400, nightlyPrice: 100, bookingUrl: 'https://www.booking.com/hotel/be/x.html' },
    { provider: 'Hotels.com', totalStayPrice: 404, nightlyPrice: 101, bookingUrl: 'https://www.hotels.com/ho1' },
    { provider: 'Expedia', totalStayPrice: 408, nightlyPrice: 102, bookingUrl: 'https://www.expedia.com/h2' },
  ], ...extra,
});

test('geografía: la consulta conserva el texto del destino tal como llega (cuatro casos exigidos)', () => {
  assert.equal(construirConsulta('Budapest, Hungría'), 'hotels in Budapest, Hungría');
  assert.equal(construirConsulta('Bruselas, Bélgica'), 'hotels in Bruselas, Bélgica');
  assert.equal(construirConsulta('Bogotá, Colombia'), 'hotels in Bogotá, Colombia');
  assert.equal(construirConsulta('Salento, Quindío, Colombia'), 'hotels in Salento, Quindío, Colombia');
});

test('geografía: Budapest, Hungría → país HU deducido del texto; datos reales aceptados', async () => {
  const k = cliente({ filas: BUDAPEST });
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, deps(k));
  assert.equal(r.estado, 'ok');
  assert.ok(r.hoteles.length >= 8, `hoteles=${r.hoteles.length}`);
  assert.equal(k.llamadas[0]!.input.searchQueries[0], 'hotels in Budapest, Hungría');
});

test('geografía: Bogotá, Colombia y Salento, Quindío, Colombia con filas reales de cada consulta', async () => {
  for (const [destino, consulta, minimo] of [
    ['Bogotá, Colombia', 'hotels in Bogotá, Colombia', 8],
    ['Salento, Quindío, Colombia', 'hotels in Salento, Quindío, Colombia', 5],
  ] as const) {
    const k = cliente({ filas: filasCiudad(consulta) });
    const r = await buscarHotelesApifyConEstado({ destino, ...fechas, paisCodigo: 'co' }, deps(k));
    assert.equal(r.estado, 'ok', destino);
    assert.ok(r.hoteles.length >= minimo, `${destino}: ${r.hoteles.length}`);
  }
});

test('geografía: Bruselas, Bélgica — la validación es por countryCode ISO, no por el nombre del país en español', async () => {
  const filas = [
    sintetico(1, 'Rue Neuve 1, 1000 Bruxelles, Belgique'),
    sintetico(2, 'Nieuwstraat 5, 1000 Brussel, België'),
    sintetico(3, 'Rue Royale 10, 1000 Brussels, Belgium'),
    sintetico(4, 'Calle sin país ni ciudad 3'),
  ];
  for (const paisCodigo of [undefined, 'be']) {
    const k = cliente({ filas });
    const r = await buscarHotelesApifyConEstado({ destino: 'Bruselas, Bélgica', ...fechas, ...(paisCodigo ? { paisCodigo } : {}) }, deps(k));
    assert.equal(r.estado, 'ok');
    assert.equal(r.hoteles.length, 4, `paisCodigo=${paisCodigo}: ninguno se descarta por idioma (están dentro del radio)`);
  }
});

test('geografía: Bruselas — un alojamiento con otro countryCode (FR) se descarta; si todos lo son → destino_no_verificado', async () => {
  const mezcla = [sintetico(1, 'Rue Neuve 1, Bruxelles'), sintetico(2, 'Rue de Lille, Lille, France', { countryCode: 'FR', latitude: 50.63, longitude: 3.06 })];
  const r = await buscarHotelesApifyConEstado({ destino: 'Bruselas, Bélgica', ...fechas }, deps(cliente({ filas: mezcla })));
  assert.equal(r.hoteles.length, 1);
  const todos = [sintetico(1, 'Lille', { countryCode: 'FR', latitude: 50.63, longitude: 3.06 })];
  const r2 = await buscarHotelesApifyConEstado({ destino: 'Bruselas, Bélgica', ...fechas }, deps(cliente({ filas: todos })));
  assert.equal(r2.codigoError, 'destino_no_verificado');
});

test('geografía: Salento — los resultados de Armenia/Pereira (otras ciudades de CO) no entran bajo Salento', async () => {
  const filas = [...filasCiudad('hotels in Salento, Quindío, Colombia'), { ...filasCiudad('hotels in Bogotá, Colombia')[0] }];
  const r = await buscarHotelesApifyConEstado({ destino: 'Salento, Quindío, Colombia', ...fechas, paisCodigo: 'co' }, deps(cliente({ filas })));
  assert.ok(!r.hoteles.some((h: any) => /Teleport Royal/.test(h.nombre)), 'el hotel de Bogotá no aparece en Salento');
});

test('geografía: país en español sin código explícito → se deduce (Hungría, Bélgica, Colombia)', () => {
  assert.equal(obtenerCodigoPais('Colombia'), 'co');
});

/* ===================== 5. FECHAS POR CIUDAD ===================== */

test('multidestino: cada ciudad recibe SUS fechas y su consulta (Bogotá, Medellín, Cartagena, Salento)', async () => {
  const k = cliente({ filas: [] });
  const tramos = [
    { ciudad: 'Bogotá', fechaEntrada: '2027-01-04', fechaSalida: '2027-01-07' },
    { ciudad: 'Medellín', fechaEntrada: '2027-01-07', fechaSalida: '2027-01-11' },
    { ciudad: 'Cartagena', fechaEntrada: '2027-01-11', fechaSalida: '2027-01-15' },
    { ciudad: 'Salento', fechaEntrada: '2027-01-15', fechaSalida: '2027-01-17' },
  ];
  for (const t of tramos) await buscarHotelesTramo(t, { pais: 'Colombia', adultos: 3 }, { apify: deps(k) });
  assert.equal(k.llamadas.length, 4);
  assert.deepEqual(k.llamadas.map((l) => [l.input.searchQueries[0], l.input.checkInDate, l.input.checkOutDate, l.input.adults]), [
    ['hotels in Bogotá, Colombia', '2027-01-04', '2027-01-07', 3],
    ['hotels in Medellín, Colombia', '2027-01-07', '2027-01-11', 3],
    ['hotels in Cartagena de Indias, Colombia', '2027-01-11', '2027-01-15', 3],
    ['hotels in Salento, Quindío, Colombia', '2027-01-15', '2027-01-17', 3],
  ]);
});

test('multidestino: las noches de cada ciudad se calculan con sus propias fechas (precio por noche coherente)', async () => {
  const fila = (n: number) => sintetico(n, 'Calle 1, Bogotá', { countryCode: 'CO', latitude: 4.711, longitude: -74.0721, nights: n });
  const k = cliente({ filas: (input) => {
    const noches = (Date.parse(input.checkOutDate) - Date.parse(input.checkInDate)) / 864e5;
    return [{ ...fila(noches), totalPrice: 100 * noches, totalPriceBeforeTaxes: 100 * noches, pricePerNight: 100,
      bookingOptions: [{ provider: 'Booking.com', totalStayPrice: 100 * noches, nightlyPrice: 100, bookingUrl: 'https://www.booking.com/h' }] }];
  } });
  const r3 = await buscarHotelesTramo({ ciudad: 'Bogotá', fechaEntrada: '2027-01-04', fechaSalida: '2027-01-07' }, { pais: 'Colombia', adultos: 2 }, { apify: deps(k) });
  const r4 = await buscarHotelesTramo({ ciudad: 'Bogotá', fechaEntrada: '2027-01-07', fechaSalida: '2027-01-11' }, { pais: 'Colombia', adultos: 2 }, { apify: deps(k) });
  assert.equal((r3.hoteles[0] as any).precioTotal, 300);
  assert.equal((r4.hoteles[0] as any).precioTotal, 400);
  assert.equal((r3.hoteles[0] as any).precioPorNoche, 100);
  assert.equal((r4.hoteles[0] as any).precioPorNoche, 100);
});

test('multidestino: normalización de ciudad (Cartagena de Indias, ciudades sin equivalencia llevan el país)', () => {
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', 'Colombia'), 'Cartagena de Indias, Colombia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento', 'Colombia'), 'Salento, Quindío, Colombia', 'Quindío se conserva en el tramo');
});

/* ===================== 4. AGENTE Y FRONTEND ===================== */

test('agente: el prompt ya no dicta líneas markdown ni importes fijos en €; las tarjetas salen de los datos', () => {
  assert.doesNotMatch(INSTRUCCIONES_HOTELES_APIFY_MANAGER, /PRIMER importe en €/);
  assert.match(INSTRUCCIONES_HOTELES_APIFY_MANAGER, /sin impuestos/);
  assert.match(INSTRUCCIONES_HOTELES_APIFY_MANAGER, /Sin valoración/);
  assert.match(INSTRUCCIONES_HOTELES_APIFY_MANAGER, /Moneda no confirmada/);
  assert.match(INSTRUCCIONES_HOTELES_APIFY_MANAGER, /No muestres imágenes/);
});

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;
const root = path.resolve(import.meta.dirname, '..');

test('frontend: líneas con el formato Apify (total sin impuestos, oferta única, sin valoración, sin precio) se pintan sin inventar datos', { skip: omitir }, async () => {
  const md = [
    '## Madrid → Budapest', '**Fechas:** 2027-01-04 – 2027-01-08', '**Viajeros:** 2', '', '### Alojamientos',
    '- **Hotel Con Valoración** — hotel — 80 € por noche (320 € total, sin impuestos) — 4,7/5 (3.821 reseñas) — [Ver oferta en Booking.com](https://www.booking.com/h1) [Ver oferta en Agoda](https://www.agoda.com/h1)',
    '- **Apartamento Sin Valoración** — apartamento vacacional — 60 € por noche (240 € total, impuestos incluidos) — Sin valoración — [Ver oferta en Booking.com](https://www.booking.com/h2)',
    '- **Hostal Sin Precio** — hostal — Precio no disponible — Sin valoración',
  ].join('\n');
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    await p.setContent('<div id="results"></div>');
    await p.addScriptTag({ path: path.join(root, 'public/render-resultados.js') });
    const r = await p.evaluate((m: string) => {
      const t = document.createElement('div'); (globalThis as any).renderResultados(m, t);
      return {
        plano: !!t.querySelector('.result-text'),
        tarjetas: [...t.querySelectorAll('.hotel-card')].map((c: any) => ({
          nombre: c.querySelector('.hotel-name')?.textContent, detalle: c.querySelector('.hotel-detail')?.textContent,
          enlaces: [...c.querySelectorAll('a')].map((a: any) => a.getAttribute('href')),
          sinEnlace: !!c.querySelector('.hotel-no-link'),
          grupo: c.closest('.hotel-category')?.querySelector('.hotel-category-title')?.textContent,
          imagenes: c.querySelectorAll('img').length,
        })),
      };
    }, md);
    assert.equal(r.plano, false);
    assert.equal(r.tarjetas.length, 3);
    const [a, ap, h] = r.tarjetas;
    assert.match(a.detalle, /80 € por noche \(320 € total, sin impuestos\)/);
    assert.ok(a.enlaces.includes('https://www.booking.com/h1') && a.enlaces.includes('https://www.agoda.com/h1'), 'las dos ofertas conservan su enlace');
    assert.match(ap.detalle, /impuestos incluidos/);
    assert.deepEqual(ap.enlaces, ['https://www.booking.com/h2'], 'oferta única: un solo enlace');
    assert.match(ap.detalle, /Sin valoración/);
    assert.equal(h.sinEnlace, true);
    assert.match(h.detalle, /Precio no disponible/);
    assert.ok(!/\b0(,0)?\/5\b/.test(JSON.stringify(r)), 'no aparece una valoración 0');
    assert.equal(a.grupo, 'Alojamientos recomendados');
    assert.notEqual(ap.grupo, 'Alojamientos recomendados', 'sin valoración no se clasifica como recomendado');
    assert.equal(r.tarjetas.reduce((n: number, t: any) => n + t.imagenes, 0), 0, 'sin imágenes');
  } finally { await b.close(); }
});
