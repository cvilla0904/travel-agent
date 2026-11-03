import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerPrecio, esGratisVerificado, parsearPrecio } from '../src/services/precios-actividades.ts';
import { actividadEsDeCiudad } from '../src/services/actividades-ciudad.ts';

test('priceFrom positivo se conserva tal cual (Coliseo 62,1 / San Pedro 30,34)', () => {
  assert.equal(extraerPrecio({ priceFrom: 62.1, priceCurrency: 'EUR' }), 62.1);
  assert.equal(extraerPrecio({ priceFrom: 30.34 }), 30.34);
  assert.equal(extraerPrecio({ priceFrom: '78,32' }), 78.32);
});

test('priceFrom 0 es un precio numérico 0, pero NO se declara gratis sin confirmación del proveedor', () => {
  const a = { priceFrom: 0, priceCurrency: 'EUR' };
  assert.equal(extraerPrecio(a), 0);
  assert.equal(esGratisVerificado(a), false);
});

test('gratis solo con señal explícita y sin importe numérico', () => {
  assert.equal(esGratisVerificado({ isFree: true }), true);
  assert.equal(esGratisVerificado({ priceText: 'Gratis' }), true);
  assert.equal(esGratisVerificado({ priceText: 'Entrada gratuita; propina voluntaria' }), true);
  assert.equal(esGratisVerificado({ priceText: 'Free', priceFrom: 20 }), false);
});

test('precio ausente o no numérico = null (desconocido), nunca 0 ni gratis', () => {
  for (const a of [{}, { priceFrom: null }, { priceFrom: 'consultar' }, { priceFrom: undefined, priceText: 'Consultar' }]) {
    assert.equal(extraerPrecio(a), null);
    assert.equal(esGratisVerificado(a), false);
  }
  assert.equal(parsearPrecio(-5), null);
});

test('respaldo textual: "Desde 19,90 €", "EUR 45", "45 USD" (las regex antiguas nunca coincidían)', () => {
  assert.equal(extraerPrecio({ priceText: 'Desde 19,90 €' }), 19.9);
  assert.equal(extraerPrecio({ priceLabel: 'EUR 45' }), 45);
  assert.equal(extraerPrecio({ priceDescription: 'from 45 USD per person' }), 45);
});

test('el campo priceFrom tiene prioridad sobre el texto', () => {
  assert.equal(extraerPrecio({ priceFrom: 30, priceText: 'Desde 99 €' }), 30);
});

test('filtro geográfico: Praga/Prague/Praha equivalentes', () => {
  const act = (city: string) => ({ city, title: 'Tour', url: 'https://x.test/a' });
  assert.equal(actividadEsDeCiudad(act('Prague'), 'Praga'), true);
  assert.equal(actividadEsDeCiudad(act('Praga'), 'Prague'), true);
  assert.equal(actividadEsDeCiudad(act('Praha'), 'Praga'), true);
});

test('filtro geográfico: resultados de otra ciudad (Barcelona para Prague) se descartan', () => {
  const barcelona = { city: 'Barcelona', title: 'Sagrada Familia', url: 'https://x.test/b' };
  assert.equal(actividadEsDeCiudad(barcelona, 'Prague'), false);
  assert.equal(actividadEsDeCiudad(barcelona, 'Praga'), false);
  assert.equal(actividadEsDeCiudad({ city: 'Rome', title: 'Coliseo', url: 'https://x.test/c' }, 'Roma'), true);
});
