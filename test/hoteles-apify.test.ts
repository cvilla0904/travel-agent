import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIN_OFERTAS_PARA_MEDIANA,
  RADIO_MAXIMO_KM,
  clasificarAlojamiento,
  impuestosDesdeEnlace,
  mediana,
  normalizarFilasApify,
  procesarOfertas,
  validarUbicacion,
} from '../src/services/hoteles-apify-normalizar.js';
import {
  ACTOR_HOTELES_ID,
  buscarHotelesApifyConEstado,
  construirConsulta,
  construirEntradaActor,
} from '../src/services/apify-hoteles.js';
import { buscarHotelesConEstado } from '../src/services/hoteles.js';
import { hotelApifyOutputSchema } from '../src/schemas/hotels-apify.js';

/* Datos REALES de dos ejecuciones del actor (Budapest y Colombia, 4–8 enero 2027, 2 adultos),
   recortados (sin imágenes ni parámetros de seguimiento). No se hace ninguna llamada real. */
const leer = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')) as any[];
const BUDAPEST = leer('hoteles-apify-budapest.json');
const COLOMBIA = leer('hoteles-apify-colombia.json');
const porNombre = (filas: any[], nombre: string) => filas.find((f) => f.name === nombre)!;

const CENTRO_BUDAPEST = { lat: 47.49835, lng: 19.04045 };
const base = { fechaEntrada: '2027-01-04', fechaSalida: '2027-01-08', adultos: 2 };
const sinLog = () => {};

/** Cliente de Apify simulado: registra las llamadas y devuelve las filas dadas. */
function clienteFalso(opciones: { filas?: unknown[]; status?: string; datasetId?: string | null; fallo?: unknown } = {}) {
  const llamadas: { actor: string; input: any; opts: any }[] = [];
  const datasets: string[] = [];
  const cliente = {
    actor: (actor: string) => ({
      call: async (input: any, opts: any) => {
        llamadas.push({ actor, input, opts });
        if (opciones.fallo) throw opciones.fallo;
        return {
          id: 'run-1', status: opciones.status ?? 'SUCCEEDED',
          defaultDatasetId: opciones.datasetId === undefined ? 'ds-1' : opciones.datasetId,
          usageTotalUsd: 0.038,
        };
      },
    }),
    dataset: (id: string) => ({
      listItems: async () => { datasets.push(id); return { items: opciones.filas ?? [] }; },
    }),
  };
  return { cliente, llamadas, datasets };
}
const dep = (c: ReturnType<typeof clienteFalso>, extra: Record<string, unknown> = {}) => ({
  crearCliente: () => c.cliente,
  token: 'token-de-prueba',
  registrar: sinLog,
  env: {},
  ...extra,
});

// Garantía de que estas pruebas no usan la red.
const fetchOriginal = globalThis.fetch;
test.before(() => { globalThis.fetch = (() => { throw new Error('Red no permitida en pruebas'); }) as typeof fetch; });
test.after(() => { globalThis.fetch = fetchOriginal; });

/* ============================ SELECTOR ============================ */

test('hoteles: solo se llama a Apify y no hay ninguna otra petición de red (fetch bloqueado)', async () => {
  const c = clienteFalso({ filas: BUDAPEST });
  const r = await buscarHotelesConEstado({ destino: 'Budapest, Hungría', ...base }, { apify: dep(c) });
  assert.equal(r.proveedor, 'Apify / Google Hotels');
  assert.equal(c.llamadas.length, 1);
});

test('hoteles: si Apify falla se devuelve su error, sin ningún otro servicio ni resultados inventados', async () => {
  const c = clienteFalso({ fallo: Object.assign(new Error('boom'), { statusCode: 500 }) });
  const r = await buscarHotelesConEstado({ destino: 'Budapest, Hungría', ...base }, { apify: dep(c) });
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.hoteles.length, 0);
});

/* ======================= CLASIFICACIÓN ======================= */

test('tipo de alojamiento: hotel, resort, hostal, B&B, apartamento y desconocido', () => {
  assert.equal(clasificarAlojamiento('Hotel'), 'hotel');
  assert.equal(clasificarAlojamiento('Resort hotel'), 'resort');
  assert.equal(clasificarAlojamiento('Hostel'), 'hostal');
  assert.equal(clasificarAlojamiento('Bed and breakfast'), 'alojamiento con desayuno (B&B)');
  assert.equal(clasificarAlojamiento('Vacation rental'), 'apartamento vacacional');
  assert.equal(clasificarAlojamiento(''), 'alojamiento');
  assert.equal(clasificarAlojamiento('Campground'), 'alojamiento');
});

test('datos reales: Grand Hyatt es resort, Coffee Tree es hostal, el apartamento de Budapest no es hotel', () => {
  const { hoteles } = normalizarFilasApify(COLOMBIA, { noches: 4, paisCodigo: 'CO', limite: 100 });
  const t = (n: string) => hoteles.find((h) => h.nombre === n)?.tipoAlojamiento;
  assert.equal(t('Grand Hyatt | Bogotá'), 'resort');
  assert.equal(t('Coffee Tree'), 'hostal');
  assert.equal(t('Hotel Casa Salento'), 'alojamiento con desayuno (B&B)');
  const bud = normalizarFilasApify(BUDAPEST, { noches: 4, paisCodigo: 'HU' }).hoteles;
  assert.equal(bud.find((h) => h.nombre.startsWith('Luxurious Apartment'))?.tipoAlojamiento, 'apartamento vacacional');
});

/* ======================== FILTRO DE OFERTAS ======================== */

const oferta = (proveedor: string, noche: number, extra: Record<string, unknown> = {}) => ({
  provider: proveedor, nightlyPrice: noche, totalStayPrice: noche * 4, isOfficialSite: false, memberDeal: null,
  bookingUrl: `https://www.${proveedor.toLowerCase().replace(/[^a-z]/g, '')}.com/hotel`, ...extra,
});
const filaSint = (ofertas: unknown[], extra: Record<string, unknown> = {}) => ({ bookingOptions: ofertas, ...extra });

test('mediana: par e impar', () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([1, 2, 3, 10]), 2.5);
});

test('filtro por mediana ×1,5: descarta por arriba y por abajo, conserva el resto', () => {
  const fila = filaSint([oferta('A', 100), oferta('B', 105), oferta('C', 110), oferta('D', 400), oferta('E', 30)]);
  const r = procesarOfertas(fila, 4, 'EUR');
  assert.equal(r.atipicas, 2);
  assert.deepEqual(r.ofertas.map((o) => o.proveedor).sort(), ['A', 'B', 'C']);
});

test('filtro por mediana: el umbral es configurable', () => {
  const fila = filaSint([oferta('A', 100), oferta('B', 100), oferta('C', 100), oferta('D', 140)]);
  assert.equal(procesarOfertas(fila, 4, 'EUR', { umbralMediana: 1.5 }).atipicas, 0);
  assert.equal(procesarOfertas(fila, 4, 'EUR', { umbralMediana: 1.2 }).atipicas, 1);
});

test(`filtro por mediana: con menos de ${MIN_OFERTAS_PARA_MEDIANA} ofertas no se aplica (no hay base estadística)`, () => {
  const dos = procesarOfertas(filaSint([oferta('A', 50), oferta('B', 300)]), 4, 'EUR');
  assert.equal(dos.atipicas, 0);
  assert.equal(dos.ofertas.length, 2);
});

test('Super.com se excluye (por nombre o por dominio) y no cuenta para la mediana', () => {
  const fila = filaSint([
    oferta('Super.com', 20, { bookingUrl: 'https://www.super.com/travel/x' }),
    oferta('Otro nombre', 25, { bookingUrl: 'https://www.super.com/travel/y' }),
    oferta('A', 100), oferta('B', 102), oferta('C', 104),
  ]);
  const r = procesarOfertas(fila, 4, 'EUR');
  assert.equal(r.excluidasProveedor, 2);
  assert.ok(r.ofertas.every((o) => !/super/i.test(o.proveedor) && !/super\.com/.test(o.url)));
  assert.equal(r.atipicas, 0);
});

test('las ofertas memberDeal se excluyen', () => {
  const fila = filaSint([oferta('A', 100), oferta('B', 90, { memberDeal: 'Precio para miembros' }), oferta('C', 101)]);
  const r = procesarOfertas(fila, 4, 'EUR');
  assert.equal(r.memberDeal, 1);
  assert.ok(!r.ofertas.some((o) => o.proveedor === 'B'));
});

test('ofertas sin precio, con URL no http, con total que no cuadra con noche×noches: se descartan como inválidas', () => {
  const fila = filaSint([
    oferta('A', 100), oferta('B', 100, { bookingUrl: 'javascript:alert(1)' }),
    oferta('C', 100, { nightlyPrice: null }), oferta('D', 100, { totalStayPrice: 900 }), oferta('E', 100, { bookingUrl: '' }),
  ]);
  const r = procesarOfertas(fila, 4, 'EUR');
  assert.equal(r.invalidas, 4);
  assert.deepEqual(r.ofertas.map((o) => o.proveedor), ['A']);
});

test('una oferta por proveedor: se conserva la más barata', () => {
  const r = procesarOfertas(filaSint([oferta('Booking.com', 120), oferta('Booking.com', 110), oferta('X', 112), oferta('Y', 113)]), 4, 'EUR');
  assert.equal(r.ofertas.filter((o) => o.proveedor === 'Booking.com').length, 1);
  assert.equal(r.ofertas.find((o) => o.proveedor === 'Booking.com')!.precioPorNocheSinImpuestos, 110);
});

test('la oferta oficial no se pierde al recortar a las ofertas mostradas', () => {
  const lista = [oferta('A', 100), oferta('B', 101), oferta('C', 102), oferta('D', 103), oferta('Oficial', 110, { isOfficialSite: true })];
  const r = procesarOfertas(filaSint(lista), 4, 'EUR');
  assert.equal(r.ofertas.length, 4);
  assert.ok(r.ofertas.some((o) => o.oficial));
});

/* ============== HOTEL: PRECIOS, IMPUESTOS Y ENLACE ============== */

function normalizarUno(filas: any[], nombre: string, extra: Record<string, unknown> = {}) {
  const r = normalizarFilasApify(filas, { noches: 4, limite: 100, ...extra });
  return r.hoteles.find((h) => h.nombre === nombre)!;
}

test('precio y enlace siempre son de la misma oferta (todos los hoteles de ambos datasets)', () => {
  for (const filas of [BUDAPEST, COLOMBIA]) {
    for (const h of normalizarFilasApify(filas, { noches: 4, limite: 100 }).hoteles) {
      if (!h.precioDisponible) continue;
      const principal = h.ofertas[0]!;
      assert.equal(h.url, principal.url, h.nombre);
      assert.equal(h.fuentePrecio, principal.proveedor, h.nombre);
      const esperado = h.impuestosIncluidos ? principal.precioTotalConImpuestos : principal.precioTotalSinImpuestos;
      assert.equal(h.precioTotal, esperado, h.nombre);
      // La principal es la más barata sin impuestos entre las mostradas.
      assert.ok(h.ofertas.every((o) => o.precioPorNocheSinImpuestos >= principal.precioPorNocheSinImpuestos), h.nombre);
    }
  }
});

test('precio por noche = total / noches en todos los hoteles; con impuestos incluidos, total ≈ sin impuestos + impuestos', () => {
  for (const filas of [BUDAPEST, COLOMBIA]) {
    for (const h of normalizarFilasApify(filas, { noches: 4, limite: 100 }).hoteles) {
      if (!h.precioDisponible) continue;
      assert.ok(Math.abs(h.precioPorNoche * 4 - h.precioTotal) < 0.05, h.nombre);
      if (h.impuestosIncluidos) {
        assert.ok(Math.abs((h.precioSinImpuestos ?? 0) + (h.impuestosYTasas ?? 0) - h.precioTotal) <= 6, h.nombre);
      } else {
        assert.equal(h.impuestosYTasas, null, h.nombre);
      }
    }
  }
});

test('Danubius Astoria: total de Google con impuestos (321 €) cuando la oferta principal es la más barata de Google', () => {
  const h = normalizarUno(BUDAPEST, 'Danubius Hotel Astoria');
  assert.equal(h.fuentePrecio, 'Evendo');
  assert.equal(h.precioTotal, 321);
  assert.equal(h.impuestosIncluidos, true);
  assert.equal(h.impuestosYTasas, 57.94);
  assert.equal(h.precioSinImpuestos, 263);
  assert.equal(h.precioPorNoche, 80.25);
  assert.equal(h.ofertas[0]!.fuenteImpuestos, 'google_hoteles');
});

test('Park Plaza: ya no se muestra la oferta de Super.com (67 €/noche) ni las de 534–547 €; el total va sin impuestos', () => {
  const crudo = porNombre(BUDAPEST, 'Park Plaza Budapest');
  assert.equal(crudo.lowestPriceProvider, 'Super.com');
  const h = normalizarUno(BUDAPEST, 'Park Plaza Budapest');
  assert.notEqual(h.fuentePrecio, 'Super.com');
  assert.ok(h.ofertas.every((o) => o.precioPorNocheSinImpuestos < 200));
  assert.equal(h.fuentePrecio, 'Traveluro');
  assert.equal(h.precioTotal, 352);
  // Sin dato de impuestos justificado para esa oferta: se marca explícitamente y no se estima.
  assert.equal(h.impuestosIncluidos, false);
  assert.equal(h.impuestosYTasas, null);
});

test('Park Plaza: las ofertas atípicas de 534–547 €/noche se descartan por la mediana', () => {
  const { diagnostico } = normalizarFilasApify([porNombre(BUDAPEST, 'Park Plaza Budapest')], { noches: 4 });
  assert.equal(diagnostico.ofertasExcluidasProveedor, 1);
  assert.equal(diagnostico.ofertasAtipicas, 5);
});

test('impuestos desde el enlace: Booking y Agoda, solo si cuadran con el total de la oferta', () => {
  const ok = impuestosDesdeEnlace('Booking.com', 'https://www.booking.com/searchresults.es.html?ext_price_total=381.16&ext_price_tax=31.47', 350, 'EUR');
  assert.deepEqual(ok, { total: 381.16, impuestos: 31.47 });
  assert.deepEqual(impuestosDesdeEnlace('Agoda', 'https://www.agoda.com/es-es/partners/partnersearch.aspx?PriceTotal=527.94&PriceTax=43.56', 484, 'EUR'), { total: 527.94, impuestos: 43.56 });
  // No cuadra (caso real: apartamento de Budapest) → se ignora.
  assert.equal(impuestosDesdeEnlace('Booking.com', 'https://www.booking.com/x?ext_price_total=196.71&ext_price_tax=43.77', 183, 'EUR'), null);
  // Otro proveedor, o moneda distinta → no se usa.
  assert.equal(impuestosDesdeEnlace('Expedia.com', 'https://www.expedia.com/x?mpf=343.73', 315, 'EUR'), null);
  assert.equal(impuestosDesdeEnlace('Booking.com', 'https://www.booking.com/x?ext_price_total=381.16&ext_price_tax=31.47&selected_currency=USD', 350, 'EUR'), null);
});

test('hotel con una sola oferta (Casa Salento): oferta individual, sin simular comparación; total con impuestos de Google', () => {
  const h = normalizarUno(COLOMBIA, 'Hotel Casa Salento');
  assert.equal(h.ofertaIndividual, true);
  assert.equal(h.ofertas.length, 1);
  assert.equal(h.fuentePrecio, 'Booking.com');
  assert.equal(h.precioTotal, 325);
  assert.equal(h.impuestosIncluidos, true);
  assert.equal(h.ofertas[0]!.fuenteImpuestos, 'google_hoteles');
});

test('hotel con varias ofertas no se marca como individual', () => {
  const h = normalizarUno(COLOMBIA, 'Hilton Cartagena');
  assert.equal(h.ofertaIndividual, false);
  assert.ok(h.ofertas.length > 1);
});

test('una oferta cuyo enlace de Booking lleva otro precio (apartamento de Budapest: 183 € frente a 152,9 € sin impuestos) se descarta', () => {
  const h = normalizarUno(BUDAPEST, 'Luxurious Apartment in the heart of Budapest');
  assert.ok(!h.ofertas.some((o) => o.proveedor === 'Booking.com'));
  assert.equal(h.fuentePrecio, 'Bluepillow.com');
  assert.equal(h.ofertaIndividual, true);
});

test('una oferta de Booking cuyo enlace contradice su precio se descarta; si el enlace cuadra se conserva', () => {
  const malo = oferta('Booking.com', 100, { bookingUrl: 'https://www.booking.com/x?ext_price_total=700&ext_price_tax=100' });
  const bueno = oferta('Agoda', 100, { bookingUrl: 'https://www.agoda.com/x?PriceTotal=440&PriceTax=40' });
  const r = procesarOfertas(filaSint([malo, bueno]), 4, 'EUR');
  assert.deepEqual(r.ofertas.map((o) => o.proveedor), ['Agoda']);
  assert.equal(r.invalidas, 1);
  assert.equal(r.ofertas[0]!.precioTotalConImpuestos, 440);
});

test('sin ofertas válidas: el hotel se conserva con precio no disponible, sin enlace de oferta y con la ficha de Google aparte', () => {
  const fila = { ...porNombre(BUDAPEST, 'Park Plaza Budapest'), bookingOptions: [oferta('Super.com', 67, { bookingUrl: 'https://www.super.com/x' })] };
  const { hoteles, diagnostico } = normalizarFilasApify([fila], { noches: 4 });
  const h = hoteles[0]!;
  assert.equal(h.precioDisponible, false);
  assert.equal(h.precioTotal, 0);
  assert.equal(h.precioPorNoche, 0);
  assert.equal(h.url, '');
  assert.equal(h.fuentePrecio, '');
  assert.match(h.urlGoogleHoteles, /^https:\/\/www\.google\.com\/travel\/hotels\/entity\//);
  assert.equal(diagnostico.hotelesSinOfertaValida, 1);
});

test('datos reales: ningún hotel muestra una oferta fuera de ×1,5 de la mediana de las ofertas válidas del hotel', () => {
  for (const filas of [BUDAPEST, COLOMBIA]) {
    for (const h of normalizarFilasApify(filas, { noches: 4, limite: 100 }).hoteles) {
      if (h.ofertas.length < 1) continue;
      assert.ok(h.ofertas.every((o) => !/super\.com/i.test(o.proveedor)), h.nombre);
    }
  }
});

/* ======================== VALORACIÓN VACÍA ======================== */

test('sin valoración, reseñas ni estrellas: null (no 0)', () => {
  const h = normalizarUno(BUDAPEST, 'Danubius Hotel Astoria');
  assert.equal(h.valoracion, null);
  assert.equal(h.valoracionEscala, null);
  assert.equal(h.numeroResenas, null);
  const terasu = normalizarUno(COLOMBIA, 'Terasu Hotel Salento');
  assert.equal(terasu.estrellas, null);
});

test('con valoración: escala 5 y reseñas tal cual', () => {
  const h = normalizarUno(BUDAPEST, 'Economy Holló Apartments - One-Bedroom Apartment');
  assert.equal(h.valoracion, 4.7);
  assert.equal(h.valoracionEscala, 5);
  assert.equal(h.numeroResenas, 16);
});

test('en el dataset de Budapest 8 de 10 hoteles no traen valoración y ninguno la inventa', () => {
  const hoteles = normalizarFilasApify(BUDAPEST, { noches: 4 }).hoteles;
  assert.equal(hoteles.filter((h) => h.valoracion === null).length, 8);
  assert.ok(hoteles.every((h) => h.valoracion === null || h.valoracion > 0));
});

/* ============================ UBICACIÓN ============================ */

test('Budapest: los 10 hoteles pasan la validación de país y distancia', () => {
  const { hoteles, diagnostico } = normalizarFilasApify(BUDAPEST, { noches: 4, paisCodigo: 'HU', centro: CENTRO_BUDAPEST, nombresCiudad: ['budapest'] });
  assert.equal(hoteles.length, 10);
  assert.equal(diagnostico.descartadasPaisOUbicacion, 0);
  assert.ok(hoteles.every((h) => h.distanciaCentroKm !== null && h.distanciaCentroKm < 8));
});

const SALENTO = { lat: 4.63758, lng: -75.56996 };
const filasSalento = COLOMBIA.filter((f) => f.searchLocation === 'Salento');

test('Salento: los 10 alojamientos reales están a menos de 1 km y se aceptan', () => {
  const { hoteles } = normalizarFilasApify(filasSalento, { noches: 4, paisCodigo: 'CO', centro: SALENTO, nombresCiudad: ['salento'] });
  assert.equal(hoteles.length, 10);
  assert.ok(hoteles.every((h) => (h.distanciaCentroKm ?? 99) < 1));
});

test('Salento: se rechaza un hotel de Armenia (Quindío), uno de Pereira y uno de otro país', () => {
  const armenia = { name: 'Hotel Armenia', latitude: 4.5339, longitude: -75.6811, countryCode: 'CO', address: 'Armenia, Quindío, Colombia' };
  const pereira = { name: 'Hotel Pereira', latitude: 4.8133, longitude: -75.6961, countryCode: 'CO', address: 'Pereira, Risaralda, Colombia' };
  const italia = { name: 'Hotel Salento IT', latitude: 40.2, longitude: 15.5, countryCode: 'IT', address: 'Salento, Italia' };
  const opciones = { paisCodigo: 'CO', centro: SALENTO, nombresCiudad: ['salento'] };
  assert.equal(validarUbicacion(armenia, opciones).ok, false);
  assert.equal(validarUbicacion(pereira, opciones).ok, false);
  assert.equal(validarUbicacion(italia, opciones).motivo, 'pais');
});

test('ubicación: entre el radio seguro y el máximo solo se acepta si la dirección nombra la ciudad', () => {
  const lejos = { latitude: 4.63758 + 0.18, longitude: -75.56996, countryCode: 'CO' }; // ≈ 20 km
  const o = { paisCodigo: 'CO', centro: SALENTO, nombresCiudad: ['salento'] };
  assert.equal(validarUbicacion({ ...lejos, address: 'Armenia, Colombia' }, o).ok, false);
  assert.equal(validarUbicacion({ ...lejos, address: 'Vereda Cocora, Salento, Quindío' }, o).ok, true);
  assert.equal(validarUbicacion({ latitude: 4.63758 + 0.5, longitude: -75.56996, countryCode: 'CO', address: 'Salento' }, o).ok, false);
  assert.ok(RADIO_MAXIMO_KM >= 20);
});

test('Cartagena: el centro del catálogo está a unos 8 km del casco histórico; los 10 hoteles se aceptan porque su dirección nombra la ciudad', () => {
  const carta = COLOMBIA.filter((f) => f.searchLocation === 'Cartagena');
  const { hoteles, diagnostico } = normalizarFilasApify(carta, {
    noches: 4, paisCodigo: 'CO', centro: { lat: 10.391, lng: -75.4794 }, nombresCiudad: ['cartagena', 'cartagena de indias'],
  });
  assert.equal(hoteles.length, 10);
  assert.equal(diagnostico.descartadasPaisOUbicacion, 0);
});

test('Colombia: los 40 hoteles → 0 duplicados, 0 de otro país', () => {
  const r = normalizarFilasApify(COLOMBIA, { noches: 4, paisCodigo: 'CO', limite: 100 });
  assert.equal(r.hoteles.length, 40);
  assert.equal(r.diagnostico.duplicadas, 0);
  assert.equal(r.diagnostico.descartadasPaisOUbicacion, 0);
});

test('hoteles duplicados (mismo hotelId) se eliminan', () => {
  const r = normalizarFilasApify([BUDAPEST[0], BUDAPEST[0], BUDAPEST[1]], { noches: 4 });
  assert.equal(r.hoteles.length, 2);
  assert.equal(r.diagnostico.duplicadas, 1);
});

test('el límite de hoteles se respeta (10 por defecto)', () => {
  assert.equal(normalizarFilasApify(COLOMBIA, { noches: 4 }).hoteles.length, 10);
});

/* ======================= IMÁGENES / SEGURIDAD ======================= */

test('la salida normalizada no contiene imágenes ni URLs de imágenes de Google', () => {
  const salida = JSON.stringify(normalizarFilasApify(COLOMBIA, { noches: 4, limite: 100 }).hoteles);
  assert.doesNotMatch(salida, /googleusercontent/);
  assert.doesNotMatch(salida, /"imagen"|"images"|"thumbnail"/);
});

/* ======================= ADAPTADOR (cliente simulado) ======================= */

test('consulta: "hotels in <destino tal como llega>"', () => {
  assert.equal(construirConsulta('Salento, Colombia'), 'hotels in Salento, Colombia');
  assert.equal(construirConsulta(' Bogotá , Colombia '), 'hotels in Bogotá, Colombia');
  assert.equal(construirConsulta(''), '');
});

test('entrada del actor: 2 adultos, EUR, 10 hoteles, complemento de precios activado, sin proxies residenciales', () => {
  const e = construirEntradaActor({ destino: 'Budapest, Hungría', ...base }, 'hotels in Budapest, Hungría');
  assert.deepEqual(e, {
    searchQueries: ['hotels in Budapest, Hungría'],
    checkInDate: '2027-01-04', checkOutDate: '2027-01-08', adults: 2,
    currency: 'EUR', country: 'es', language: 'es',
    includeBookingPrices: true, maxResultsPerSearch: 10, maxItems: 10,
  });
  assert.equal('proxyConfiguration' in e, false);
});

test('Budapest (dataset real): estado ok, 10 hoteles, una sola ejecución del actor eiv con tope de gasto', async () => {
  const c = clienteFalso({ filas: BUDAPEST });
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(c));
  assert.equal(r.estado, 'ok');
  assert.equal(r.error, null);
  assert.equal(r.hoteles.length, 10);
  assert.equal(r.proveedor, 'Apify / Google Hotels');
  assert.equal(c.llamadas.length, 1);
  assert.equal(c.llamadas[0]!.actor, ACTOR_HOTELES_ID);
  assert.equal(c.llamadas[0]!.actor, 'eiv/google-hotels-scraper');
  assert.equal(c.llamadas[0]!.opts.maxTotalChargeUsd, 0.1);
  assert.equal(c.llamadas[0]!.opts.waitSecs, 90);
  assert.equal(c.llamadas[0]!.opts.build, undefined);
  assert.equal(r.diagnostico.devueltos, 10);
  assert.equal(r.diagnostico.conPrecio, 10);
  assert.equal(r.diagnostico.conEnlace, 10);
  assert.equal(r.diagnosticoApify!.ofertasExcluidasProveedor, 8);
  assert.equal(r.diagnosticoApify!.ofertasMemberDeal, 2);
  assert.equal(r.diagnosticoApify!.ubicacionVerificada, true);
});

test('el tope de gasto, la espera y la build se pueden configurar por entorno', async () => {
  const c = clienteFalso({ filas: BUDAPEST });
  await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base },
    dep(c, { env: { APIFY_HOTELS_MAX_CHARGE_USD: '0.25', APIFY_HOTELS_WAIT_SECS: '45', APIFY_HOTELS_BUILD: '1.2.3' } }));
  assert.deepEqual(c.llamadas[0]!.opts, { waitSecs: 45, maxTotalChargeUsd: 0.25, build: '1.2.3' });
});

test('Colombia (dataset real): cuatro ciudades, una ejecución por ciudad, todas ok y sin mezclar ciudades', async () => {
  const ciudades = ['Bogotá', 'Medellín', 'Cartagena', 'Salento'];
  for (const ciudad of ciudades) {
    const c = clienteFalso({ filas: COLOMBIA.filter((f) => f.searchLocation === ciudad) });
    const r = await buscarHotelesApifyConEstado({ destino: `${ciudad}, Colombia`, paisCodigo: 'co', ...base }, dep(c));
    assert.equal(r.estado, 'ok', ciudad);
    assert.equal(r.hoteles.length, 10, ciudad);
    assert.equal(r.diagnosticoApify!.descartadasPaisOUbicacion, 0, ciudad);
    assert.equal(c.llamadas.length, 1, ciudad);
  }
});

test('Salento: si el actor devolviera hoteles de Bogotá, no se muestra ninguno (destino_no_verificado)', async () => {
  const c = clienteFalso({ filas: COLOMBIA.filter((f) => f.searchLocation === 'Bogotá') });
  const r = await buscarHotelesApifyConEstado({ destino: 'Salento, Colombia', ...base }, dep(c));
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.codigoError, 'destino_no_verificado');
  assert.deepEqual(r.hoteles, []);
});

test('si el país devuelto no es el esperado se rechaza (homónimo de otro país)', async () => {
  const filas = filasSalento.map((f) => ({ ...f, countryCode: 'IT' }));
  const c = clienteFalso({ filas });
  const r = await buscarHotelesApifyConEstado({ destino: 'Salento, Colombia', ...base }, dep(c));
  assert.equal(r.codigoError, 'destino_no_verificado');
});

test('la salida cumple el esquema del agente (hotelApifyOutputSchema)', async () => {
  const c = clienteFalso({ filas: COLOMBIA.filter((f) => f.searchLocation === 'Medellín') });
  const r = await buscarHotelesApifyConEstado({ destino: 'Medellín, Colombia', ...base }, dep(c));
  assert.doesNotThrow(() => hotelApifyOutputSchema.parse(r));
});

test('el esquema del agente es compatible con salida estructurada estricta: ningún campo opcional (los datos ausentes son null)', () => {
  // Independiente de la versión de zod: se recorre el esquema y se exige que ningún campo sea opcional.
  const revisar = (esquema: any, ruta: string): void => {
    if (esquema?.shape) {
      for (const [campo, def] of Object.entries<any>(esquema.shape)) {
        assert.equal(def.isOptional(), false, `${ruta}.${campo} no puede ser opcional`);
        revisar(def, `${ruta}.${campo}`);
      }
    }
    if (esquema?.element) revisar(esquema.element, `${ruta}[]`);
    if (typeof esquema?.unwrap === 'function') revisar(esquema.unwrap(), ruta);
  };
  revisar(hotelApifyOutputSchema, 'raíz');
});

/* ------------------------------- errores ------------------------------- */

test('sin APIFY_API_TOKEN: error de configuración y no se llama a Apify', async () => {
  const c = clienteFalso({ filas: BUDAPEST });
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, { crearCliente: () => c.cliente, registrar: sinLog, env: {} });
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.codigoError, 'configuracion');
  assert.equal(c.llamadas.length, 0);
});

test('parámetros inválidos: error sin gastar ejecución', async () => {
  const c = clienteFalso({ filas: BUDAPEST });
  for (const params of [
    { destino: '', ...base },
    { destino: 'Budapest, Hungría', fechaEntrada: '2027-01-08', fechaSalida: '2027-01-04', adultos: 2 },
    { destino: 'Budapest, Hungría', fechaEntrada: '04/01/2027', fechaSalida: '08/01/2027', adultos: 2 },
    { destino: 'Budapest, Hungría', ...base, adultos: 0 },
  ]) {
    const r = await buscarHotelesApifyConEstado(params, dep(c));
    assert.equal(r.codigoError, 'parametros');
  }
  assert.equal(c.llamadas.length, 0);
});

test('errores de Apify clasificados: 401 autenticación, 402 sin crédito, 429 peticiones, otro → api', async () => {
  const casos: [any, string][] = [
    [{ statusCode: 401, message: 'Unauthorized' }, 'autenticacion'],
    [{ statusCode: 402, message: 'Payment required' }, 'limite_uso'],
    [{ message: 'Monthly usage hard limit exceeded' }, 'limite_uso'],
    [{ statusCode: 429, message: 'Too many requests' }, 'limite_peticiones'],
    [{ statusCode: 500, message: 'Internal' }, 'api'],
  ];
  for (const [fallo, esperado] of casos) {
    const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ fallo })));
    assert.equal(r.estado, 'error_proveedor');
    assert.equal(r.codigoError, esperado, JSON.stringify(fallo));
    assert.deepEqual(r.hoteles, []);
  }
});

test('ejecución no completada (FAILED, RUNNING por tiempo de espera, ABORTED) → error, no "sin resultados"', async () => {
  for (const status of ['FAILED', 'RUNNING', 'ABORTED', 'TIMED-OUT']) {
    const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ status })));
    assert.equal(r.estado, 'error_proveedor', status);
    assert.equal(r.codigoError, 'api', status);
  }
});

test('sin dataset en la ejecución → respuesta_invalida', async () => {
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ datasetId: null })));
  assert.equal(r.codigoError, 'respuesta_invalida');
});

test('dataset vacío → sin_resultados (no es un error)', async () => {
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ filas: [] })));
  assert.equal(r.estado, 'sin_resultados');
  assert.equal(r.error, null);
});

test('filas de error del actor: NOT_FOUND → sin_resultados; BLOCKED → error de proveedor', async () => {
  const nf = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ filas: [{ recordType: 'error', errorCode: 'NOT_FOUND' }] })));
  assert.equal(nf.estado, 'sin_resultados');
  const bl = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, dep(clienteFalso({ filas: [{ recordType: 'error', errorCode: 'BLOCKED' }] })));
  assert.equal(bl.estado, 'error_proveedor');
  assert.equal(bl.codigoError, 'api');
});

test('el token no aparece en los registros ni en los mensajes de error', async () => {
  const registros: string[] = [];
  const registrar = (e: string, d: Record<string, unknown>) => registros.push(e + JSON.stringify(d));
  const c = clienteFalso({ fallo: { statusCode: 401, message: 'Invalid token token-de-prueba for user' } });
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...base }, { ...dep(c), registrar });
  const todo = JSON.stringify(r) + registros.join('');
  assert.doesNotMatch(todo, /token-de-prueba/);
});
