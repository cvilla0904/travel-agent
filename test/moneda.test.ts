/** Moneda: se muestra la que declara el proveedor; nunca EUR por defecto; sin conversión. Datos de los normalizadores reales. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatearImporte, monedaComun, monedaDesdeTexto, monedaIso, SIN_MONEDA, SIN_PRECIO } from '../src/services/moneda.ts';
import { normalizarVueloIdaVuelta, combinarItinerarioAbierto, crearEnlaceBusquedaGoogleFlights } from '../src/services/vuelos.ts';
import { normalizarPropiedades } from '../src/services/searchapi.ts';
import { normalizarFilasApify } from '../src/services/hoteles-apify-normalizar.ts';
import { extraerMoneda, extraerPrecio } from '../src/services/precios-actividades.ts';
import { actividadParaMultidestino } from '../src/services/actividades-ciudad.ts';

test('monedaIso / monedaDesdeTexto: solo códigos ISO válidos y símbolos inequívocos', () => {
  assert.equal(monedaIso('usd'), 'USD');
  assert.equal(monedaIso('BAM'), 'BAM');
  assert.equal(monedaIso('XXX'), null);
  assert.equal(monedaIso('euro'), null);
  assert.equal(monedaDesdeTexto('19,90 €'), 'EUR');
  assert.equal(monedaDesdeTexto('£25'), 'GBP');
  assert.equal(monedaDesdeTexto('US$ 25'), 'USD');
  assert.equal(monedaDesdeTexto('25 CHF'), 'CHF');
  assert.equal(monedaDesdeTexto('$25'), null, '«$» a secas es ambiguo');
  assert.equal(monedaDesdeTexto('25 min'), null);
});

test('formatearImporte: moneda real, «Precio no disponible» y «Moneda no confirmada», sin símbolo inventado', () => {
  assert.match(formatearImporte(120, 'EUR'), /120\s?€/);
  assert.match(formatearImporte(120, 'USD'), /120\s?US\$/);
  assert.match(formatearImporte(19.9, 'BAM'), /19,90/);
  assert.equal(formatearImporte(null, 'EUR'), SIN_PRECIO);
  assert.equal(formatearImporte(undefined, null), SIN_PRECIO);
  const sinMoneda = formatearImporte(120, '');
  assert.match(sinMoneda, new RegExp(SIN_MONEDA));
  assert.doesNotMatch(sinMoneda, /€|\$|£/);
});

test('monedaComun: solo si todas declaran la misma; si no, vacía (no se suman monedas distintas)', () => {
  assert.equal(monedaComun(['EUR', 'eur']), 'EUR');
  assert.equal(monedaComun(['EUR', 'USD']), '');
  assert.equal(monedaComun(['EUR', '']), '');
  assert.equal(monedaComun([]), '');
});

const ctx = { origen: 'MAD', destino: 'BRU', fechaIda: '2027-03-10', fechaVuelta: '', pasajeros: 1 };
const vueloCrudo = (extra: Record<string, unknown>) => ({ price: 100, airlines: 'X', departure_airport: { name: 'Madrid', id: 'MAD', time: '2027-03-10 08:00' }, arrival_airport: { name: 'Bruselas', id: 'BRU', time: '2027-03-10 10:00' }, duration: '2 h', stops: 0, ...extra });

test('vuelos: la moneda es la del proveedor; sin moneda queda vacía (no EUR); el enlace de Google no fija la moneda', () => {
  assert.equal(normalizarVueloIdaVuelta(vueloCrudo({ currency: 'USD' }), ctx).moneda, 'USD');
  assert.equal(normalizarVueloIdaVuelta(vueloCrudo({}), ctx).moneda, '');
  assert.equal(normalizarVueloIdaVuelta(vueloCrudo({ price: '£99' }), ctx).moneda, 'GBP');
  assert.doesNotMatch(crearEnlaceBusquedaGoogleFlights('MAD', 'BRU', '2027-03-10'), /curr=/);
  const ok = { ...ctx, destinoRegreso: 'BRU', fechaVuelta: '2027-03-17' };
  assert.equal(combinarItinerarioAbierto(vueloCrudo({ currency: 'EUR' }), vueloCrudo({ currency: 'EUR' }), ok).moneda, 'EUR');
  assert.equal(combinarItinerarioAbierto(vueloCrudo({ currency: 'EUR' }), vueloCrudo({ currency: 'USD' }), ok).moneda, '', 'monedas distintas: no se suman');
});

test('hoteles SearchAPI: moneda declarada (campo o texto) o vacía; nunca EUR por defecto', () => {
  const props = [
    { title: 'A', link: 'https://www.booking.com/hotel/a.html', extracted_price: 100, currency: 'GBP' },
    { title: 'B', link: 'https://www.booking.com/hotel/b.html', price: '€ 90' },
    { title: 'C', link: 'https://www.booking.com/hotel/c.html', extracted_price: 80 },
  ];
  const r = normalizarPropiedades(props, 2, 'EUR', 10);
  const por = Object.fromEntries(r.map((h) => [h.nombre, h.moneda]));
  assert.deepEqual(por, { A: 'GBP', B: 'EUR', C: '' });
});

test('hoteles Apify: moneda de la fila; sin ella, vacía', () => {
  const fila = (nombre: string, extra: Record<string, unknown>) => ({
    recordType: 'hotel', name: nombre, category: 'Hotel', rating: 4, reviewsCount: 10, pricePerNight: 100, totalPrice: 200, nights: 2,
    address: 'Calle 1', bookingOptions: [{ provider: 'Booking.com', totalStayPrice: 200, nightlyPrice: 100, bookingUrl: 'https://www.booking.com/hotel/x.html' }], ...extra,
  });
  const { hoteles } = normalizarFilasApify([fila('Con USD', { currency: 'USD' }), fila('Sin moneda', {})], { noches: 2, limite: 10 });
  const por = Object.fromEntries(hoteles.map((h) => [h.nombre, h.moneda]));
  assert.equal(por['Con USD'], 'USD');
  assert.equal(por['Sin moneda'], '');
});

test('actividades: moneda declarada, por texto o null; el precio en texto con otras monedas se extrae', () => {
  assert.equal(extraerMoneda({ priceCurrency: 'usd', priceFrom: 20 }), 'USD');
  assert.equal(extraerMoneda({ priceText: 'Desde 19,90 €' }), 'EUR');
  assert.equal(extraerMoneda({ priceText: 'Desde 35 BAM' }), 'BAM');
  assert.equal(extraerMoneda({ priceFrom: 20 }), null);
  assert.equal(extraerPrecio({ priceText: 'Desde 35 BAM' }), 35);
  assert.equal(extraerPrecio({ priceText: 'Duración 25 min' }), null);
  assert.equal(actividadParaMultidestino({ title: 'T', priceFrom: 20 }, ['x']).moneda, null);
  assert.equal(actividadParaMultidestino({ title: 'T', priceFrom: 20, priceCurrency: 'GBP' }, ['x']).moneda, 'GBP');
});
