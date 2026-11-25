// M2: el destino elegido (validado por el servidor) se conserva hasta la llamada al proveedor aunque el modelo reescriba el
// argumento `destino` de la herramienta. Cliente de Apify simulado: no se llama a Apify ni se gasta nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buscarHotelesConEstado } from '../src/services/hoteles.js';
import { buscarHotelesTramo } from '../src/services/hoteles-multidestino.js';
import { conDestinoFijado, destinoFijadoActual, destinoFijadoDesde, reconciliarDestino } from '../src/services/destino-fijado.js';

const APULIA = { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Apulia', id: 'ed:salento-apulia', tipo: 'ciudad' };
const QUINDIO = { nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', region: 'Quindío', id: 'gn:3670352', tipo: 'ciudad' };
const CAMPANIA = { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Campania', id: 'gn:3168676', tipo: 'ciudad' };
const CARTAGENA_ES = { nombre: 'Cartagena', pais: 'España', codigoPais: 'ES', region: 'Región de Murcia', id: 'gn:2520058', tipo: 'ciudad' };
const CARTAGENA_CO = { nombre: 'Cartagena', pais: 'Colombia', codigoPais: 'CO', region: 'Bolívar', id: 'gn:3687238', tipo: 'ciudad' };
const MADRID = { nombre: 'Madrid', pais: 'España', codigoPais: 'ES', id: 'gn:3117735', tipo: 'ciudad' };

const dentro = <T>(sel: unknown, fn: () => T): T => conDestinoFijado(sel, fn);
const destino = (sel: unknown, modelo: string) => dentro(sel, () => reconciliarDestino(modelo).destino);

test('sin destino fijado, la reconciliación no cambia nada', () => {
  assert.equal(destinoFijadoActual(), undefined);
  assert.deepEqual(reconciliarDestino('Salento'), { destino: 'Salento', sustituido: false });
  assert.equal(conDestinoFijado(null, () => destinoFijadoActual()), undefined);
  assert.equal(conDestinoFijado('basura', () => destinoFijadoActual()), undefined);
});

test('Salento (Apulia) elegido: lo que escriba el modelo sobre Salento se conserva como «Salento, Apulia, Italia»', () => {
  for (const modelo of ['Salento', 'salento', 'Salento, Italia', 'Salento, Colombia', 'Salento, Quindío', 'Salento, Quindío, Colombia', 'Salento, Lecce', 'Salento, Apulia, Italia', 'Salento, Campania, Italia']) {
    assert.equal(destino(APULIA, modelo), 'Salento, Apulia, Italia', modelo);
  }
});

test('cada homónimo elegido se conserva frente a los demás', () => {
  assert.equal(destino(QUINDIO, 'Salento, Italia'), 'Salento, Quindío, Colombia');
  assert.equal(destino(CAMPANIA, 'Salento'), 'Salento, Campania, Italia');
  assert.equal(destino(CAMPANIA, 'Salento, Italia'), 'Salento, Campania, Italia', 'Campania elegido no se convierte en Apulia');
  assert.equal(destino(CARTAGENA_ES, 'Cartagena'), 'Cartagena, Región de Murcia, España');
  assert.equal(destino(CARTAGENA_ES, 'Cartagena, Colombia'), 'Cartagena, Región de Murcia, España');
  assert.equal(destino(CARTAGENA_CO, 'Cartagena'), 'Cartagena, Bolívar, Colombia');
  assert.equal(destino(CARTAGENA_CO, 'Cartagena de Indias'), 'Cartagena, Bolívar, Colombia', 'variante curada del mismo lugar');
});

test('otros lugares y destinos normales no se tocan', () => {
  assert.equal(destino(APULIA, 'Madrid'), 'Madrid');
  assert.equal(destino(APULIA, 'Lecce'), 'Lecce', 'Lecce es otro lugar: el modelo puede pedirlo');
  assert.equal(destino(APULIA, 'Roma, Italia'), 'Roma, Italia');
  assert.equal(destino(CARTAGENA_ES, 'Cartagena de Indias'), 'Cartagena de Indias', 'otro lugar con nombre distinto');
  // Un destino normal del catálogo (sin identidad editorial) ni siquiera se fija.
  assert.equal(destinoFijadoDesde(MADRID), null);
  assert.equal(destino(MADRID, 'Madrid'), 'Madrid');
  assert.equal(destino(MADRID, 'Salento'), 'Salento');
  // Un destino escrito a mano, sin id, tampoco.
  assert.equal(destinoFijadoDesde({ nombre: 'Salento', pais: 'Italia' }), null);
});

test('el destino fijado sale del servidor validado: ids y países manipulados no producen un destino contradictorio', () => {
  assert.equal(destinoFijadoDesde({ nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', id: 'gn:3168676' })!.etiqueta, 'Salento, Campania, Italia');
  assert.equal(destinoFijadoDesde({ nombre: 'Lima', pais: 'Perú', codigoPais: 'PE', id: 'ed:salento-apulia' })!.paisCodigo, 'it');
  assert.equal(destinoFijadoDesde({ nombre: 'Salento', id: 'ed:inventado' }), null);
});

test('el contexto viaja por awaits, temporizadores y ejecuciones concurrentes sin mezclarse entre peticiones', async () => {
  const peticion = (sel: unknown, modelo: string, ms: number) => conDestinoFijado(sel, async () => {
    await new Promise((r) => setTimeout(r, ms));
    const dentroDeTimer = await new Promise<string>((r) => setTimeout(() => r(reconciliarDestino(modelo).destino), ms));
    const anidada = await (async () => (await Promise.resolve(), reconciliarDestino(modelo).destino))();
    assert.equal(anidada, dentroDeTimer);
    return dentroDeTimer;
  });
  const r = await Promise.all([
    peticion(APULIA, 'Salento', 15), peticion(QUINDIO, 'Salento', 5), peticion(CAMPANIA, 'Salento, Colombia', 10), peticion(null, 'Salento', 1),
    peticion(CARTAGENA_ES, 'Cartagena', 8),
  ]);
  assert.deepEqual(r, ['Salento, Apulia, Italia', 'Salento, Quindío, Colombia', 'Salento, Campania, Italia', 'Salento', 'Cartagena, Región de Murcia, España']);
  assert.equal(destinoFijadoActual(), undefined, 'nada queda fijado fuera de la petición');
});

/* --------- Hasta la llamada al proveedor (cliente de Apify simulado, igual que en hoteles-multidestino-region) --------- */
const hotel = (nombre: string, direccion: string, lat: number, lng: number, cc: string) => ({
  recordType: 'hotel', name: nombre, category: 'Hotel', rating: 4.4, reviewsCount: 200, pricePerNight: 80, totalPrice: 240, totalPriceBeforeTaxes: 240, taxesAndFees: 0,
  currency: 'EUR', nights: 3, address: direccion, latitude: lat, longitude: lng, countryCode: cc,
  bookingOptions: [{ provider: 'Booking.com', nightlyPrice: 80, totalStayPrice: 240, bookingUrl: 'https://www.booking.com/h' }],
});
const LECCE = hotel('Hotel Lecce (fixture)', 'Via Trinchese 1, Lecce', 40.352, 18.17, 'IT');
const QUINDIO_H = hotel('Hotel Salento (fixture)', 'Calle Real 5, Salento, Quindío', 4.6376, -75.57, 'CO');

function cliente(filas: any[]) {
  const llamadas: any[] = [];
  const c = {
    actor: () => ({ call: async (input: any) => { llamadas.push(input); return { id: `r${llamadas.length}`, status: 'SUCCEEDED', defaultDatasetId: 'd', usageTotalUsd: 0.03 }; } }),
    dataset: () => ({ listItems: async () => ({ items: filas }) }),
    run: () => ({ abort: async () => {} }),
  };
  return { llamadas, deps: { proveedor: 'apify' as const, apify: { crearCliente: () => c, token: 't', registrar: () => {}, env: {} } } };
}
const params = (destino: string, extra: object = {}) => ({ destino, fechaEntrada: '2027-06-10', fechaSalida: '2027-06-13', adultos: 2, ...extra });

test('el modelo reescribe «Salento»: con el destino fijado el proveedor recibe Apulia y acepta el hotel de Lecce', async () => {
  const k = cliente([LECCE]);
  const r: any = await dentro(APULIA, () => buscarHotelesConEstado(params('Salento'), k.deps));
  assert.equal(k.llamadas[0].searchQueries[0], 'hotels in Salento, Apulia, Italia');
  assert.equal(r.estado, 'ok');
  assert.equal(r.hoteles.length, 1);
});

test('el modelo contradice al usuario («Salento, Colombia» y paisCodigo co): manda lo elegido, también el país de validación', async () => {
  const k = cliente([LECCE, QUINDIO_H]);
  const r: any = await dentro(APULIA, () => buscarHotelesConEstado(params('Salento, Colombia', { paisCodigo: 'co' }), k.deps));
  assert.equal(k.llamadas[0].searchQueries[0], 'hotels in Salento, Apulia, Italia');
  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.hoteles.map((h: any) => h.nombre), ['Hotel Lecce (fixture)'], 'el hotel de Quindío se descarta por país y ubicación');
});

test('control SIN destino fijado: «Salento» sigue siendo Quindío y el hotel de Lecce se rechaza (es lo que ocurría antes)', async () => {
  const k = cliente([LECCE]);
  const r: any = await buscarHotelesConEstado(params('Salento'), k.deps);
  assert.equal(k.llamadas[0].searchQueries[0], 'hotels in Salento');
  assert.notEqual(r.estado, 'ok', 'sin fijar, el hotel de Lecce no pertenece al Salento de Quindío');
});

test('Quindío elegido: el hotel de Quindío vale y Lecce no; Campania elegido: ni uno ni otro', async () => {
  const q = cliente([QUINDIO_H, LECCE]);
  const rq: any = await dentro(QUINDIO, () => buscarHotelesConEstado(params('Salento, Italia'), q.deps));
  assert.equal(q.llamadas[0].searchQueries[0], 'hotels in Salento, Quindío, Colombia');
  assert.deepEqual(rq.hoteles.map((h: any) => h.nombre), ['Hotel Salento (fixture)']);
  const c = cliente([LECCE, QUINDIO_H]);
  const rc: any = await dentro(CAMPANIA, () => buscarHotelesConEstado(params('Salento'), c.deps));
  assert.equal(c.llamadas[0].searchQueries[0], 'hotels in Salento, Campania, Italia');
  assert.notEqual(rc.estado, 'ok', 'ningún hotel fixture está en el municipio de Campania');
});

test('otro destino en la misma petición no se altera', async () => {
  const k = cliente([LECCE]);
  await dentro(APULIA, () => buscarHotelesConEstado(params('Lecce, Italia'), k.deps));
  assert.equal(k.llamadas[0].searchQueries[0], 'hotels in Lecce, Italia');
});

test('multidestino: un tramo de Salento recibe el destino elegido aunque el itinerario sea de otro país', async () => {
  const k = cliente([LECCE]);
  await dentro(APULIA, () => buscarHotelesTramo({ ciudad: 'Salento', fechaEntrada: '2027-06-10', fechaSalida: '2027-06-13' }, { pais: 'Colombia', adultos: 2 }, k.deps));
  assert.equal(k.llamadas[0].searchQueries[0], 'hotels in Salento, Apulia, Italia');
  const sin = cliente([QUINDIO_H]);
  await buscarHotelesTramo({ ciudad: 'Salento', fechaEntrada: '2027-06-10', fechaSalida: '2027-06-13' }, { pais: 'Colombia', adultos: 2 }, sin.deps);
  assert.equal(sin.llamadas[0].searchQueries[0], 'hotels in Salento, Quindío, Colombia', 'sin fijar, el itinerario por Colombia sigue igual');
});

test('cableado: los dos puntos de entrada del agente ejecutan run() dentro de conDestinoFijado con el cuerpo de la petición', () => {
  // Solo comprobación de fuente: api/index.ts y src/server.ts importan el SDK y no se pueden ejecutar sin las dependencias reales.
  const raiz = path.resolve(import.meta.dirname, '..');
  for (const f of ['api/index.ts', 'src/server.ts']) {
    const src = fs.readFileSync(path.join(raiz, f), 'utf8');
    assert.match(src, /await conDestinoFijado\(req\.body\?\.destinoSeleccionado,\s*\(\) => run\(/, f);
  }
});
