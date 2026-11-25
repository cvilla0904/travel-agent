// Los tres «Salento» nunca se confunden: Quindío (Colombia), la península de Lecce (Apulia, Italia) y el municipio
// de Campania (Italia, 760 habitantes). Catálogo versionado en disco. Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { datosCiudad, grupoCurado, regionCurada, variantesCiudad, consultaProveedorParaCiudad } from '../src/services/ciudades.js';
import { normalizarCiudadBusquedaMultidestino } from '../src/services/hoteles-multidestino.js';
import { construirConsulta } from '../src/services/apify-hoteles.js';
import { validarUbicacion } from '../src/services/hoteles-apify-normalizar.js';
import { buscarDestinos } from '../src/geo/buscar.js';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';

const QUINDIO = { lat: 4.63758, lng: -75.56996 };
const CAMPANIA = { lat: 40.24913, lng: 15.18938 };
const LECCE = { lat: 40.355, lng: 18.172 }, OTRANTO = { lat: 40.148, lng: 18.487 }, GALLIPOLI = { lat: 40.056, lng: 17.991 };

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

test('Salento, Italia es la península de Lecce (Apulia), no el municipio de Campania', () => {
  for (const t of ['Salento, Italia', 'Salento, Italy', 'Salento, Lecce', 'Salento, Puglia, Italia', 'Salento, Apulia', 'Salento, Lecce, Italia']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.ok(km(d!, LECCE) < 25, `${t}: cerca de Lecce (${d!.lat},${d!.lng})`);
    assert.ok(km(d!, CAMPANIA) > 200, `${t}: lejos de Campania`);
    assert.ok(km(d!, QUINDIO) > 9000, `${t}: lejos de Quindío`);
    assert.equal(regionCurada(t), 'Apulia', t);
  }
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento', 'Italia'), 'Salento, Apulia, Italia');
  assert.equal(construirConsulta('Salento, Apulia, Italia'), 'hotels in Salento, Apulia, Italia');
});

test('Salento, Colombia / Quindío sigue siendo Quindío y «Salento» a secas conserva la preferencia editorial', () => {
  for (const t of ['Salento', 'Salento, Colombia', 'Salento, Quindío', 'Salento, Quindío, Colombia']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.ok(km(d!, QUINDIO) < 5, `${t}: Quindío`);
    assert.equal(regionCurada(t), 'Quindío', t);
  }
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento', 'Colombia'), 'Salento, Quindío, Colombia');
});

test('Salento, Campania es el municipio de Campania: ni Lecce ni Quindío', () => {
  for (const t of ['Salento, Campania, Italia', 'Salento, Campania, Italy']) {
    assert.equal(grupoCurado(t), undefined, `${t}: sin entrada curada`);
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.ok(km(d!, CAMPANIA) < 5, `${t}: Campania (${d!.lat},${d!.lng})`);
    assert.equal(regionCurada(t), undefined);
  }
});

test('el centro llega al validador de Apify con su radio: Lecce, Otranto y Gallipoli valen; Campania y Quindío no', () => {
  const d = datosCiudad('Salento, Apulia, Italia')!;
  assert.equal(d.radioKm, 30);
  const centro = { lat: d.lat, lng: d.lng, radioKm: d.radioKm! };
  const nombresCiudad = variantesCiudad('Salento, Apulia, Italia');
  const f = (p: { lat: number; lng: number }, cc = 'IT') => ({ countryCode: cc, latitude: p.lat, longitude: p.lng, address: 'Via Roma 1' });
  for (const p of [LECCE, OTRANTO, GALLIPOLI]) assert.equal(validarUbicacion(f(p), { paisCodigo: 'IT', centro, nombresCiudad }).ok, true);
  assert.equal(validarUbicacion(f(CAMPANIA), { paisCodigo: 'IT', centro, nombresCiudad }).motivo, 'lejos');
  assert.equal(validarUbicacion(f(QUINDIO, 'CO'), { paisCodigo: 'IT', centro, nombresCiudad }).motivo, 'pais');
  // Sin radio propio se mantiene el comportamiento de siempre (8 km): Otranto quedaría fuera.
  assert.equal(validarUbicacion(f(OTRANTO), { paisCodigo: 'IT', centro: { lat: d.lat, lng: d.lng }, nombresCiudad }).ok, false);
  // El centro de Quindío no cambia: radio por defecto.
  assert.equal(datosCiudad('Salento, Colombia')!.radioKm, undefined);
});

test('proveedor y variantes de cada Salento no se mezclan', () => {
  assert.equal(consultaProveedorParaCiudad('Salento, Italia'), 'Salento');
  assert.equal(consultaProveedorParaCiudad('Salento, Colombia'), 'Salento');
  assert.ok(variantesCiudad('Salento, Italia').includes('salento'));
});

test('/api/geo: «Salento, Italia» ofrece Apulia y, como alternativa, Campania; Colombia ofrece Quindío', () => {
  const cat = new Catalogo(fuenteEnDisco());
  const it = buscarDestinos(cat, 'Salento, Italia', { limite: 5 });
  assert.deepEqual(it.map((r) => [r.id, r.region]), [['ed:salento-apulia', 'Apulia'], ['gn:3168676', 'Campania']]);
  const co = buscarDestinos(cat, 'Salento, Colombia', { limite: 5 });
  assert.equal(co[0]?.id, 'gn:3670352');
  assert.equal(co[0]?.region, 'Quindío');
});
