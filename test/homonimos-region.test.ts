// La región escrita participa en la identificación de homónimos curados incluso sin país:
// «Cartagena, Murcia» es Cartagena (Murcia), no Cartagena de Indias. Catálogo en disco; sin red ni créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CIUDADES_EQUIVALENTES, consultaProveedorParaCiudad, datosCiudad, grupoCurado, regionCurada, variantesCiudad } from '../src/services/ciudades.js';
import { normalizarCiudadBusquedaMultidestino } from '../src/services/hoteles-multidestino.js';

const MURCIA = { lat: 37.6, lng: -0.98 }, INDIAS = { lat: 10.39, lng: -75.48 };
const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

test('Cartagena con región de Murcia, con o sin país, es Cartagena (España)', () => {
  for (const t of ['Cartagena, Murcia', 'Cartagena, Región de Murcia', 'cartagena, region de murcia', 'Cartagena, Murcia, España', 'Cartagena, España', 'Cartagena, Spain']) {
    const d = datosCiudad(t);
    assert.ok(d && km(d, MURCIA) < 15, `${t}: Murcia (${d?.lat},${d?.lng})`);
    assert.equal(consultaProveedorParaCiudad(t), 'Cartagena', t);
    assert.ok(!variantesCiudad(t).includes('cartagena de indias'), t);
    assert.equal(regionCurada(t), 'Región de Murcia', t);
  }
});

test('Cartagena con Bolívar o Colombia, y a secas, sigue siendo Cartagena de Indias', () => {
  for (const t of ['Cartagena', 'Cartagena, Bolívar', 'Cartagena, Colombia', 'Cartagena, Bolívar, Colombia', 'Cartagena de Indias']) {
    const d = datosCiudad(t);
    assert.ok(d && km(d, INDIAS) < 15, `${t}: Indias`);
    assert.equal(d!.en, 'Cartagena de Indias', t);
  }
});

test('región y país contradictorios: no se aplica la entrada curada y manda el país escrito (vía catálogo)', () => {
  for (const t of ['Cartagena, Murcia, Colombia', 'Cartagena, Bolívar, España']) assert.equal(grupoCurado(t), undefined, t);
  assert.ok(km(datosCiudad('Cartagena, Murcia, Colombia')!, INDIAS) < 15, 'el país escrito (Colombia) manda');
  assert.ok(km(datosCiudad('Cartagena, Bolívar, España')!, MURCIA) < 15, 'el país escrito (España) manda');
});

test('multidestino conserva la región escrita o la completa desde la entrada curada', () => {
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena, Murcia'), 'Cartagena, Murcia, España');
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', 'España'), 'Cartagena, Región de Murcia, España');
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena, Bolívar'), 'Cartagena de Indias, Bolívar, Colombia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', 'Colombia'), 'Cartagena de Indias, Colombia');
});

test('mecanismo general: toda entrada curada con homónimo declara país y, si comparte nombre, regiones distintas', () => {
  const porNombre = new Map<string, typeof CIUDADES_EQUIVALENTES>();
  for (const g of CIUDADES_EQUIVALENTES) for (const n of g.nombres) porNombre.set(n, [...(porNombre.get(n) ?? []), g]);
  for (const [nombre, grupos] of porNombre) {
    if (grupos.length < 2) continue;
    const paises = new Set(grupos.map((g) => g.pais));
    assert.equal(paises.size, grupos.length, `${nombre}: un país distinto por entrada`);
    for (const g of grupos) assert.ok(g.regiones?.length, `${nombre} (${g.pais}): los homónimos declaran regiones para identificarse sin país`);
  }
  assert.ok([...porNombre.values()].some((g) => g.length >= 2), 'hay homónimos curados');
});
