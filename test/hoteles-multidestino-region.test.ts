// Multidestino: cada tramo conserva ciudad, región, país y SUS fechas. Cliente simulado: no se llama a Apify.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarHotelesTramo, normalizarCiudadBusquedaMultidestino } from '../src/services/hoteles-multidestino.js';

function cliente(filas: any[] = []) {
  const llamadas: { input: any; opts: any }[] = [];
  const c = {
    actor: () => ({ call: async (input: any, opts: any) => { llamadas.push({ input, opts }); return { id: `r${llamadas.length}`, status: 'SUCCEEDED', defaultDatasetId: 'd', usageTotalUsd: 0.03 }; } }),
    dataset: () => ({ listItems: async () => ({ items: filas }) }),
    run: () => ({ abort: async () => {} }),
  };
  return { c, llamadas };
}
const deps = (k: ReturnType<typeof cliente>) => ({ apify: { crearCliente: () => k.c, token: 't', registrar: () => {}, env: {} } });

test('Salento se transmite como «Salento, Quindío, Colombia» y nunca como «Salento, Colombia»', () => {
  for (const entrada of ['Salento', 'Salento, Colombia', 'Salento, Quindío', 'Salento, Quindío, Colombia']) {
    assert.equal(normalizarCiudadBusquedaMultidestino(entrada, 'Colombia'), 'Salento, Quindío, Colombia', entrada);
  }
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento'), 'Salento, Quindío, Colombia', 'sin país en el itinerario, la tabla curada completa el país');
});

test('Salento de Italia no recibe Quindío ni Colombia: es el de Lecce (Apulia) salvo que se diga Campania', () => {
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento', 'Italia'), 'Salento, Apulia, Italia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento, Lecce, Italia', 'Italia'), 'Salento, Lecce, Italia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Salento, Campania, Italia', 'Italia'), 'Salento, Campania, Italia');
});

test('homónimos: Cartagena de un itinerario por España no se convierte en Cartagena de Indias', () => {
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', 'España'), 'Cartagena, Región de Murcia, España');
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', 'Colombia'), 'Cartagena de Indias, Colombia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Cartagena', undefined), 'Cartagena de Indias, Colombia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Florencia', 'Colombia'), 'Florencia, Colombia');
  assert.equal(normalizarCiudadBusquedaMultidestino('Sevilla', 'España'), 'Sevilla, España');
  assert.equal(normalizarCiudadBusquedaMultidestino('Budapest', 'Hungría'), 'Budapest, Hungría');
});

test('cuatro tramos: cada uno conserva ciudad, región, país y sus fechas de entrada y salida', async () => {
  const k = cliente();
  const tramos = [
    { ciudad: 'Bogotá', fechaEntrada: '2027-01-04', fechaSalida: '2027-01-07' },
    { ciudad: 'Cartagena', fechaEntrada: '2027-01-07', fechaSalida: '2027-01-12' },
    { ciudad: 'Medellín', fechaEntrada: '2027-01-12', fechaSalida: '2027-01-15' },
    { ciudad: 'Salento', fechaEntrada: '2027-01-15', fechaSalida: '2027-01-18' },
  ];
  const resultados = [];
  for (const t of tramos) resultados.push(await buscarHotelesTramo(t, { pais: 'Colombia', adultos: 2 }, deps(k)));
  assert.deepEqual(k.llamadas.map((l) => [l.input.searchQueries[0], l.input.checkInDate, l.input.checkOutDate]), [
    ['hotels in Bogotá, Colombia', '2027-01-04', '2027-01-07'],
    ['hotels in Cartagena de Indias, Colombia', '2027-01-07', '2027-01-12'],
    ['hotels in Medellín, Colombia', '2027-01-12', '2027-01-15'],
    ['hotels in Salento, Quindío, Colombia', '2027-01-15', '2027-01-18'],
  ]);
  for (const l of k.llamadas) assert.equal(l.input.adults, 2);
  assert.equal(resultados.length, 4);
});

test('itinerario por España con Cartagena: el actor recibe Cartagena, Región de Murcia, España y su propia fecha', async () => {
  const k = cliente();
  await buscarHotelesTramo({ ciudad: 'Cartagena', fechaEntrada: '2027-03-10', fechaSalida: '2027-03-13' }, { pais: 'España', adultos: 2 }, deps(k));
  assert.equal(k.llamadas[0]!.input.searchQueries[0], 'hotels in Cartagena, Región de Murcia, España');
  assert.equal(k.llamadas[0]!.input.checkInDate, '2027-03-10');
  assert.equal(k.llamadas[0]!.input.checkOutDate, '2027-03-13');
});
