// Regresión de la región escrita en el autocompletado (completa o a medio escribir) y de los itinerarios multidestino.
// Catálogo real en disco, handler/buscador reales, cliente de Apify simulado. Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { buscarDestinos } from '../src/geo/buscar.js';
import { buscarHotelesTramo, normalizarCiudadBusquedaMultidestino } from '../src/services/hoteles-multidestino.js';
import { datosCiudad, regionCurada } from '../src/services/ciudades.js';

const cat = new Catalogo(fuenteEnDisco());
const ids = (q: string, limite = 8) => buscarDestinos(cat, q, { limite }).map((r) => r.id);
const QUINDIO = 'gn:3670352', APULIA = 'ed:salento-apulia', CAMPANIA = 'gn:3168676', CART_CO = 'gn:3687238', CART_ES = 'gn:2520058';
const ORDEN_SALENTO = [QUINDIO, APULIA, CAMPANIA];

test('Salento, Apulia: completa, provincia o zona, y a medio escribir (3+ letras)', () => {
  for (const q of ['Salento, Apulia', 'Salento, Puglia', 'Salento, Lecce', 'Salento, Provincia di Lecce', 'Salento, Apu', 'Salento, Pug', 'Salento, Lec', 'salento, APULIA']) {
    assert.equal(ids(q)[0], APULIA, q);
  }
  assert.deepEqual(ids('Salento, Apulia').filter((i) => ORDEN_SALENTO.includes(i)), [APULIA, QUINDIO, CAMPANIA], 'la región prioriza sin excluir a los demás');
});

test('Salento, Campania: completa y a medio escribir', () => {
  // «Salento, Cam» se lee como país a medio escribir (Camboya, Camerún…): el prefijo de región funciona cuando no coincide con un país.
  for (const q of ['Salento, Campania', 'Salento, Campa', 'Salento, Camp', 'Salento, Salerno', 'Salento, Provincia di Salerno']) assert.equal(ids(q)[0], CAMPANIA, q);
});

test('Salento, Quindío: con y sin acento, completa y a medio escribir', () => {
  for (const q of ['Salento, Quindío', 'Salento, Quindio', 'Salento, Quin', 'Salento, Qui', 'Salento, Departamento del Quindío']) assert.equal(ids(q)[0], QUINDIO, q);
});

test('dos letras no cuentan como región a medio escribir (solo ≥3), y una región ajena no altera el orden de Salento', () => {
  for (const q of ['Salento, ap', 'Salento, qu', 'Salento, Mur', 'Salento, zzzz', 'Salento']) {
    assert.deepEqual(ids(q).filter((i) => ORDEN_SALENTO.includes(i)), ORDEN_SALENTO, q);
  }
});

test('el país escrito acota por encima de cualquier región', () => {
  assert.deepEqual(ids('Salento, Colombia'), [QUINDIO]);
  assert.deepEqual(ids('Salento, Italia'), [APULIA, CAMPANIA]);
  assert.equal(ids('Salento, Italia, Campania')[0], CAMPANIA, 'el país no va el último: no acota, pero la región sigue priorizando');
  assert.deepEqual(ids('Salento, Camp, Italia'), [CAMPANIA, APULIA], 'región + país: región primero dentro del país');
  assert.deepEqual(ids('Salento, Quindío, Colombia'), [QUINDIO]);
  assert.deepEqual(ids('Salento, Apulia, Colombia'), [QUINDIO], 'país contradictorio con la región: manda el país y no inventa un Apulia colombiano');
});

test('Cartagena, Murcia / España / Colombia / Bolívar, completas y a medio escribir', () => {
  for (const q of ['Cartagena, Murcia', 'Cartagena, Región de Murcia', 'Cartagena, Mur', 'Cartagena, España', 'Cartagena, es']) assert.equal(ids(q)[0], CART_ES, q);
  for (const q of ['Cartagena, Colombia', 'Cartagena, Bolívar', 'Cartagena, Bolivar', 'Cartagena, co']) assert.equal(ids(q)[0], CART_CO, q);
  assert.ok(!ids('Cartagena, Colombia').includes(CART_ES));
  assert.ok(!ids('Cartagena, España').includes(CART_CO));
  assert.ok(ids('Cartagena, Murcia').includes(CART_CO), 'la región prioriza sin excluir al otro homónimo');
});

test('una región a medio escribir no altera destinos sin región editorial', () => {
  for (const [con, sin] of [['Madrid, Mur', 'Madrid'], ['Paris, Camp', 'Paris'], ['Lecce, Apu', 'Lecce'], ['Roma, Qui', 'Roma']] as const) {
    assert.deepEqual(ids(con), ids(sin), con);
  }
});

test('el backend resuelve cada región completa a su destino (el prefijo es solo del autocompletado)', () => {
  const lat = (t: string) => datosCiudad(t)!.lat;
  assert.ok(Math.abs(lat('Salento, Apulia') - 40.25) < 0.01);
  assert.ok(Math.abs(lat('Salento, Lecce') - 40.25) < 0.01);
  assert.ok(Math.abs(lat('Salento, Campania, Italia') - 40.249) < 0.01);
  assert.ok(Math.abs(lat('Salento, Quindío') - 4.63758) < 0.01);
  assert.ok(Math.abs(lat('Cartagena, Murcia') - 37.6) < 0.1);
  assert.ok(Math.abs(lat('Cartagena, Colombia') - 10.39) < 0.1);
  assert.equal(regionCurada('Salento, Puglia'), 'Apulia');
});

/* ------------------------------- multidestino ------------------------------- */
test('multidestino: ciudad + país del itinerario + región escrita dan siempre el destino correcto', () => {
  const m = normalizarCiudadBusquedaMultidestino;
  assert.equal(m('Salento', 'Colombia'), 'Salento, Quindío, Colombia');
  assert.equal(m('Salento', 'Italia'), 'Salento, Apulia, Italia');
  assert.equal(m('Salento, Lecce', 'Italia'), 'Salento, Lecce, Italia');
  assert.equal(m('Salento, Apulia', 'Italia'), 'Salento, Apulia, Italia');
  assert.equal(m('Salento, Campania', 'Italia'), 'Salento, Campania, Italia');
  assert.equal(m('Salento, Quindío', 'Colombia'), 'Salento, Quindío, Colombia');
  assert.equal(m('Salento, Quindío'), 'Salento, Quindío, Colombia');
  assert.equal(m('Cartagena, Murcia'), 'Cartagena, Murcia, España');
  assert.equal(m('Cartagena, Murcia', 'España'), 'Cartagena, Murcia, España');
  assert.equal(m('Cartagena', 'España'), 'Cartagena, Región de Murcia, España');
  assert.equal(m('Cartagena, Colombia'), 'Cartagena de Indias, Colombia');
  assert.equal(m('Cartagena', 'Colombia'), 'Cartagena de Indias, Colombia');
  assert.equal(m('Madrid', 'España'), 'Madrid, España');
  assert.equal(m('Budapest', 'Hungría'), 'Budapest, Hungría');
});

function cliente() {
  const llamadas: any[] = [];
  const c = {
    actor: () => ({ call: async (input: any) => { llamadas.push(input); return { id: `r${llamadas.length}`, status: 'SUCCEEDED', defaultDatasetId: 'd', usageTotalUsd: 0.03 }; } }),
    dataset: () => ({ listItems: async () => ({ items: [] }) }),
    run: () => ({ abort: async () => {} }),
  };
  return { llamadas, deps: { proveedor: 'apify' as const, apify: { crearCliente: () => c, token: 't', registrar: () => {}, env: {} } } };
}

test('multidestino: itinerarios por Colombia, Italia y España llegan al proveedor con su región, país y fechas propias', async () => {
  const k = cliente();
  const rutas: Array<[string, string, string, string]> = [
    ['Colombia', 'Cartagena', '2027-02-01', '2027-02-04'],
    ['Colombia', 'Salento', '2027-02-04', '2027-02-07'],
    ['Italia', 'Lecce', '2027-03-01', '2027-03-03'],
    ['Italia', 'Salento', '2027-03-03', '2027-03-06'],
    ['Italia', 'Salento, Campania', '2027-03-06', '2027-03-08'],
    ['España', 'Cartagena', '2027-04-01', '2027-04-03'],
    ['España', 'Cartagena, Murcia', '2027-04-03', '2027-04-05'],
  ];
  for (const [pais, ciudad, entrada, salida] of rutas) await buscarHotelesTramo({ ciudad, fechaEntrada: entrada, fechaSalida: salida }, { pais, adultos: 2 }, k.deps);
  assert.deepEqual(k.llamadas.map((l) => [l.searchQueries[0], l.checkInDate, l.checkOutDate]), [
    ['hotels in Cartagena de Indias, Colombia', '2027-02-01', '2027-02-04'],
    ['hotels in Salento, Quindío, Colombia', '2027-02-04', '2027-02-07'],
    ['hotels in Lecce, Italia', '2027-03-01', '2027-03-03'],
    ['hotels in Salento, Apulia, Italia', '2027-03-03', '2027-03-06'],
    ['hotels in Salento, Campania, Italia', '2027-03-06', '2027-03-08'],
    ['hotels in Cartagena, Región de Murcia, España', '2027-04-01', '2027-04-03'],
    ['hotels in Cartagena, Murcia, España', '2027-04-03', '2027-04-05'],
  ]);
  for (const l of k.llamadas) assert.equal(l.adults, 2);
});
