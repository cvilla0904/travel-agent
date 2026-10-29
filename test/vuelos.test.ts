import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarVuelosConEstado, crearEnlaceBusquedaGoogleFlights } from '../src/services/vuelos.ts';
import { buscarVuelosApify, resolverAeropuerto, ErrorVuelos } from '../src/services/apify-flights.ts';

const vuelo = (price: number | undefined, extra: Record<string, unknown> = {}) => ({
  ...(price === undefined ? {} : { price }),
  currency: 'EUR', airlines: 'Aerolínea Ficticia',
  departure_airport: { name: 'Madrid', id: 'MAD', time: '2027-01-11 08:00' },
  arrival_airport: { name: 'Miami', id: 'MIA', time: '2027-01-11 12:00' },
  duration: '9 h', stops: 0, flight_number: 'XX 100', ...extra,
});
const P = { origen: 'MAD', destino: 'MIA', fechaIda: '2027-01-11', fechaVuelta: '2027-01-18', pasajeros: 2 };
const buscarCon = (porLlamada: Array<unknown>) => {
  const llamadas: any[] = [];
  return {
    llamadas,
    buscar: async (params: any) => {
      llamadas.push(params);
      const r = porLlamada[llamadas.length - 1];
      if (r instanceof Error) throw r;
      return r as any[];
    },
  };
};
// ida/vuelta se lanzan a la vez: identificamos la dirección por parámetros, no por orden.
const porDireccion = (ida: unknown, vuelta: unknown) => async (params: any) => {
  const r = params.origen === 'MAD' ? ida : vuelta;
  if (r instanceof Error) throw r;
  return r as any[];
};

test('ida y vuelta con precio: combina y ordena por precio total', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion([vuelo(300), vuelo(100)], [vuelo(200)]) });
  assert.equal(r.estado, 'ok');
  assert.equal(r.vuelos.length, 2);
  assert.equal(r.vuelos[0].precioTotal, 300);
  assert.ok(r.vuelos[0].precioTotal <= r.vuelos[1].precioTotal);
  assert.deepEqual(r.direccionesConError, []);
});

test('falla la vuelta: se conservan las opciones válidas de la ida, marcadas como solo ida', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion([vuelo(120)], new Error('Apify timeout')) });
  assert.equal(r.estado, 'parcial');
  assert.deepEqual(r.direccionesConError, ['vuelta']);
  assert.equal(r.vuelos.length, 1);
  assert.equal(r.vuelos[0].tipo, 'Solo ida');
  assert.equal(r.vuelos[0].esIdaVuelta, false);
  assert.match(r.avisos[0]!, /vuelta/);
});

test('falla la ida: se conservan las de la vuelta, marcadas como solo vuelta', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion(new Error('boom'), [vuelo(90)]) });
  assert.equal(r.estado, 'parcial');
  assert.deepEqual(r.direccionesConError, ['ida']);
  assert.equal(r.vuelos[0].tipo, 'Solo vuelta');
});

test('una dirección sin resultados y la otra con vuelos: parcial con aviso, no se pierden', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion([vuelo(100)], []) });
  assert.equal(r.estado, 'parcial');
  assert.equal(r.vuelos.length, 1);
  assert.equal(r.direccionesConError.length, 0);
  assert.ok(r.avisos.length >= 1);
});

test('ambas direcciones fallan: error_proveedor, NO sin_resultados', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion(new Error('a'), new Error('b')) });
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.vuelos.length, 0);
  assert.deepEqual(r.direccionesConError.sort(), ['ida', 'vuelta']);
});

test('ambas responden vacías: sin_resultados sin error', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion([], []) });
  assert.equal(r.estado, 'sin_resultados');
  assert.equal(r.error, null);
});

test('un tramo sin precio no se combina (no subestima el total)', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion([vuelo(100)], [vuelo(undefined)]) });
  assert.ok(r.vuelos.every((v: any) => v.precioTotal > 0));
  assert.notEqual(r.vuelos[0]?.tipo, 'Ida y vuelta');
});

test('error de parámetros (aeropuerto no identificable) se clasifica aparte', async () => {
  const e = new ErrorVuelos('parametros', 'No he podido identificar el aeropuerto');
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion(e, e) });
  assert.equal(r.estado, 'error_parametros');
});

test('las dos direcciones se consultan en paralelo con origen/destino invertidos', async () => {
  const c = buscarCon([[vuelo(100)], [vuelo(100)]]);
  await buscarVuelosConEstado(P, { buscar: c.buscar });
  assert.equal(c.llamadas.length, 2);
  assert.deepEqual([c.llamadas[0].origen, c.llamadas[0].destino, c.llamadas[0].fechaIda], ['MAD', 'MIA', '2027-01-11']);
  assert.deepEqual([c.llamadas[1].origen, c.llamadas[1].destino, c.llamadas[1].fechaIda], ['MIA', 'MAD', '2027-01-18']);
});

test('solo ida (sin fecha de vuelta): una sola consulta', async () => {
  const c = buscarCon([[vuelo(100)]]);
  const r = await buscarVuelosConEstado({ ...P, fechaVuelta: '' }, { buscar: c.buscar });
  assert.equal(c.llamadas.length, 1);
  assert.equal(r.estado, 'ok');
});

test('itinerario abierto: la vuelta sale de destinoRegreso', async () => {
  const c = buscarCon([[vuelo(100)], [vuelo(100)]]);
  await buscarVuelosConEstado({ ...P, destino: 'MIA', destinoRegreso: 'MCO' }, { buscar: c.buscar });
  assert.equal(c.llamadas[1].origen, 'MCO');
});

test('los mensajes de error no filtran tokens', async () => {
  const r = await buscarVuelosConEstado(P, { buscar: porDireccion(new Error('fallo token=abcdefghijkl1234 apify_api_SECRET123'), []) });
  assert.doesNotMatch(JSON.stringify(r), /abcdefghijkl1234|SECRET123/);
});

test('enlace de búsqueda: válido, en español y sin "undefined"', () => {
  const url = crearEnlaceBusquedaGoogleFlights('MAD', 'MIA', '2027-01-11', '2027-01-18');
  assert.match(url, /^https:\/\/www\.google\.com\/travel\/flights/);
  assert.match(url, /hl=es/);
  assert.doesNotMatch(url, /undefined/);
});

/* ---- apify-flights con cliente inyectado (sin red) ---- */
const clienteFalso = (items: unknown[], status = 'SUCCEEDED', capturar?: any[]) => ({
  actor: () => ({ call: async (input: any, opts: any) => { capturar?.push({ input, opts }); return { id: 'r1', status, defaultDatasetId: 'd1' }; } }),
  dataset: () => ({ listItems: async () => ({ items }) }),
});

test('apify-flights: dataset vacío y SUCCEEDED => [] (sin resultados, no error)', async () => {
  process.env.APIFY_API_TOKEN = 'x'; console.info = () => {};
  assert.deepEqual(await buscarVuelosApify({ origen: 'MAD', destino: 'MIA', fechaIda: '2027-01-11', pasajeros: 1 }, { crearCliente: () => clienteFalso([]) }), []);
});

test('apify-flights: registros irreconocibles => error de formato', async () => {
  process.env.APIFY_API_TOKEN = 'x'; console.info = () => {};
  await assert.rejects(buscarVuelosApify({ origen: 'MAD', destino: 'MIA', fechaIda: '2027-01-11', pasajeros: 1 }, { crearCliente: () => clienteFalso([{ foo: 1 }]) }), (e: any) => e.codigo === 'formato');
});

test('apify-flights: run FAILED => error de proveedor; RUNNING sin vuelos => error', async () => {
  process.env.APIFY_API_TOKEN = 'x'; console.info = () => {};
  const p = { origen: 'MAD', destino: 'MIA', fechaIda: '2027-01-11', pasajeros: 1 };
  await assert.rejects(buscarVuelosApify(p, { crearCliente: () => clienteFalso([vuelo(1)], 'FAILED') }), /estado: FAILED/);
  await assert.rejects(buscarVuelosApify(p, { crearCliente: () => clienteFalso([], 'RUNNING') }), /sigue ejecutando/);
});

test('apify-flights: aplana contenedores y llama con build fijada y espera de 60 s', async () => {
  process.env.APIFY_API_TOKEN = 'x'; delete process.env.APIFY_FLIGHTS_BUILD; console.info = () => {};
  const cap: any[] = [];
  const r = await buscarVuelosApify({ origen: 'Madrid', destino: 'Miami', fechaIda: '2027-01-11', pasajeros: 2 },
    { crearCliente: () => clienteFalso([{ best_flights: [vuelo(10)], other_flights: [vuelo(20)] }], 'SUCCEEDED', cap) });
  assert.equal(r.length, 2);
  assert.equal(cap[0].input.departure_id, 'MAD');
  assert.equal(cap[0].input.arrival_id, 'MIA');
  assert.equal(cap[0].opts.waitSecs, 60);
  assert.equal(cap[0].opts.build, '0.0.450');
});

test('apify-flights: build inexistente => un único reintento con la build por defecto', async () => {
  process.env.APIFY_API_TOKEN = 'x'; delete process.env.APIFY_FLIGHTS_BUILD; console.info = () => {}; console.warn = () => {};
  const llamadas: any[] = [];
  const cliente = {
    actor: () => ({ call: async (_i: any, o: any) => { llamadas.push(o); if (o.build) throw new Error('Build 0.0.450 was not found'); return { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' }; } }),
    dataset: () => ({ listItems: async () => ({ items: [vuelo(5)] }) }),
  };
  const r = await buscarVuelosApify({ origen: 'MAD', destino: 'MIA', fechaIda: '2027-01-11', pasajeros: 1 }, { crearCliente: () => cliente });
  assert.equal(r.length, 1);
  assert.equal(llamadas.length, 2);
  assert.equal('build' in llamadas[1], false);
});

test('IATA: ciudades nuevas y error claro para desconocidas', () => {
  assert.equal(resolverAeropuerto('Miami', 'destino'), 'MIA');
  assert.equal(resolverAeropuerto('Orlando', 'destino'), 'MCO');
  assert.equal(resolverAeropuerto('mad', 'origen'), 'MAD');
  assert.throws(() => resolverAeropuerto('Ciudadinventada', 'destino'), (e: any) => e instanceof ErrorVuelos && e.codigo === 'parametros');
});
