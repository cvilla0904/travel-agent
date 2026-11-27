// Budapest y Salento en la tabla curada de ciudades, ya con el catálogo geográfico v3 integrado.
// Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codigoPaisDesdeDestino, consultaProveedorParaCiudad, datosCiudad, regionCurada, variantesCiudad } from '../src/services/ciudades.js';
import { buscarHotelesApifyConEstado, construirConsulta } from '../src/services/apify-hoteles.js';

const fechas = { fechaEntrada: '2027-01-04', fechaSalida: '2027-01-08', adultos: 2 };

test('Budapest: centro y nombres en la tabla curada, con o sin país', () => {
  for (const t of ['Budapest', 'Budapest, Hungría', 'budapest, hungary']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.deepEqual([d!.lat, d!.lng], [47.49835, 19.04045]);
  }
  // Con el catálogo integrado las variantes son la UNIÓN de la tabla curada y el catálogo: la variante curada no se pierde.
  assert.ok(variantesCiudad('Budapest, Hungría').includes('budapest'));
  assert.equal(consultaProveedorParaCiudad('Budapest'), 'Budapest');
});

test('Salento: se resuelve con Quindío/Colombia o sin país, y NO para otro país (Salento, Italia)', () => {
  for (const t of ['Salento', 'Salento, Colombia', 'Salento, Quindío, Colombia', 'Salento, Quindío']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.deepEqual([d!.lat, d!.lng], [4.63758, -75.56996], t);
  }
  // Con el catálogo, Salento (Italia) se resuelve por el catálogo (antes, sin catálogo, no se resolvía): nunca al centro colombiano.
  for (const t of ['Salento, Italia', 'Salento, Italy', 'Salento, Lecce, Italia']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.ok(Math.abs(d!.lat - 4.63758) > 10 && Math.abs(d!.lng + 75.56996) > 10, `${t}: lejos del centro colombiano (${d!.lat},${d!.lng})`);
  }
  assert.equal(consultaProveedorParaCiudad('Salento, Italia'), 'Salento');
  assert.deepEqual(variantesCiudad('Salento, Italia'), ['salento'], 'solo el propio nombre, sin datos curados de Colombia');
});

test('las ciudades que ya estaban en la tabla no cambian', () => {
  assert.deepEqual([datosCiudad('Bogotá')!.lat, datosCiudad('Bogotá')!.lng], [4.711, -74.0721]);
  assert.equal(datosCiudad('Cartagena, Colombia')!.en, 'Cartagena de Indias');
  assert.equal(datosCiudad('Bruselas, Bélgica')!.en, 'Brussels');
});

test('Salento: la región Quindío solo se asocia al Salento colombiano', () => {
  assert.equal(regionCurada('Salento, Colombia'), 'Quindío');
  assert.equal(regionCurada('Salento, Quindío, Colombia'), 'Quindío');
  assert.equal(regionCurada('Salento'), 'Quindío');
  // En Italia «Salento» es la península de Lecce (Apulia): nunca Quindío (ver salento-tres-destinos.test.ts).
  assert.equal(regionCurada('Salento, Italia'), 'Apulia');
  assert.equal(regionCurada('Salento, Lecce, Italia'), 'Apulia');
  assert.equal(regionCurada('Salento, Lecce'), 'Apulia', 'Lecce no es Quindío: se resuelve al Salento italiano');
  assert.equal(regionCurada('Salento, Campania, Italia'), undefined, 'el municipio de Campania no es ninguno de los Salentos curados');
  assert.equal(regionCurada('Bogotá, Colombia'), undefined, 'solo las ciudades curadas con región la tienen');
  assert.equal(construirConsulta('Salento, Quindío, Colombia'), 'hotels in Salento, Quindío, Colombia', 'el actor recibe Quindío');
  assert.equal(codigoPaisDesdeDestino('Salento, Lecce, Italia'), 'it');
  assert.equal(codigoPaisDesdeDestino('Salento, Quindío, Colombia'), 'co');
});

/* Filas sintéticas (ETIQUETADAS como tales): hoteles de CO en las ciudades vecinas de Salento. */
const fila = (nombre: string, direccion: string, lat: number, lng: number, cc = 'CO') => ({
  recordType: 'hotel', name: nombre, category: 'Hotel', rating: 4.4, reviewsCount: 200,
  pricePerNight: 50, totalPrice: 200, totalPriceBeforeTaxes: 200, taxesAndFees: 0, currency: 'EUR', nights: 4,
  address: direccion, latitude: lat, longitude: lng, countryCode: cc,
  bookingOptions: [{ provider: 'Booking.com', nightlyPrice: 50, totalStayPrice: 200, bookingUrl: 'https://www.booking.com/h' }],
});
function cliente(filas: any[]) {
  let llamadas = 0;
  return { llamadas: () => llamadas, c: {
    actor: () => ({ call: async () => { llamadas++; return { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd', usageTotalUsd: 0.03 }; } }),
    dataset: () => ({ listItems: async () => ({ items: filas }) }),
  } };
}
const dep = (k: ReturnType<typeof cliente>) => ({ crearCliente: () => k.c, token: 't', registrar: () => {}, env: {} });

test('Salento (tabla curada, sin catálogo): se aceptan los hoteles del pueblo y se rechazan los de Armenia y Pereira', async () => {
  const k = cliente([
    fila('Casa en Salento', 'Calle Real, Salento, Quindío', 4.6376, -75.5700),
    fila('Hotel en Armenia', 'Carrera 14, Armenia, Quindío', 4.5339, -75.6811),
    fila('Hotel en Pereira', 'Avenida Circunvalar, Pereira, Risaralda', 4.8133, -75.6961),
    fila('Hotel en Bogotá', 'Calle 100, Bogotá', 4.711, -74.0721),
    fila('Hotel en Italia', 'Via Roma, Lecce', 40.35, 18.17, 'IT'),
  ]);
  const r = await buscarHotelesApifyConEstado({ destino: 'Salento, Quindío, Colombia', ...fechas }, dep(k));
  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.hoteles.map((h: any) => h.nombre), ['Casa en Salento']);
  assert.equal(r.diagnosticoApify!.ubicacionVerificada, true, 'hay centro: se comprueba la distancia');
});

test('Salento: si el actor solo devolviera Armenia/Pereira → destino_no_verificado (nada se muestra bajo Salento)', async () => {
  const k = cliente([
    fila('Hotel en Armenia', 'Carrera 14, Armenia, Quindío', 4.5339, -75.6811),
    fila('Hotel en Pereira', 'Avenida Circunvalar, Pereira, Risaralda', 4.8133, -75.6961),
  ]);
  const r = await buscarHotelesApifyConEstado({ destino: 'Salento, Quindío, Colombia', ...fechas }, dep(k));
  assert.equal(r.codigoError, 'destino_no_verificado');
  assert.equal(r.hoteles.length, 0);
});

test('Budapest (tabla curada): ubicación verificada por distancia; un hotel de otra ciudad de HU se rechaza', async () => {
  const k = cliente([
    fila('Hotel Budapest', 'Váci utca 1, Budapest', 47.4979, 19.0402, 'HU'),
    fila('Hotel Debrecen', 'Piac utca 1, Debrecen', 47.53, 21.63, 'HU'),
  ]);
  const r = await buscarHotelesApifyConEstado({ destino: 'Budapest, Hungría', ...fechas }, dep(k));
  assert.deepEqual(r.hoteles.map((h: any) => h.nombre), ['Hotel Budapest']);
  assert.equal(r.diagnosticoApify!.ubicacionVerificada, true);
});
