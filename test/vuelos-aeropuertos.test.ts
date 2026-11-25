/**
 * Vuelos: resolución del aeropuerto desde el catálogo geográfico, aeropuerto fijado por el servidor y parámetros que
 * llegan realmente al actor de Apify (con cliente falso: sin red ni créditos).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarVuelosConEstado } from '../src/services/vuelos.ts';
import { buscarVuelosApify } from '../src/services/apify-flights.ts';
import { resolverAeropuertoVuelo } from '../src/services/aeropuertos-vuelos.ts';
import { conDestinoFijado } from '../src/services/destino-fijado.ts';

const iata = (t: string) => resolverAeropuertoVuelo(t, 'destino').iata;

test('Bruselas, Brussels, Brussels Airport y Sarajevo se resuelven a BRU/SJJ (nombre original y traducciones)', () => {
  for (const t of ['Bruselas', 'Brussels', 'Bruxelles', 'Brussels Airport', 'Aeropuerto de Bruselas', 'Bruselas, Bélgica', 'Bruselas (BRU)', 'BRU']) assert.equal(iata(t), 'BRU', t);
  for (const t of ['Sarajevo', 'Sarajevo, Bosnia y Herzegovina', 'SJJ']) assert.equal(iata(t), 'SJJ', t);
});

test('Madrid, Barcelona y París siguen funcionando (aeropuerto principal)', () => {
  assert.equal(iata('Madrid'), 'MAD');
  assert.equal(iata('Barcelona'), 'BCN');
  assert.equal(iata('París'), 'CDG');
  assert.equal(iata('Paris, Francia'), 'CDG');
});

test('el catálogo resuelve ciudades que NO están en el diccionario (Zagreb, Dubrovnik, un aeropuerto por su nombre)', () => {
  assert.equal(iata('Zagreb'), 'ZAG');
  assert.equal(iata('Dubrovnik'), 'DBV');
  assert.equal(iata('Brussels South Charleroi Airport'), 'CRL');
});

test('un destino sin aeropuerto propio usa el de acceso y lo avisa; un destino desconocido da error claro', () => {
  const r = resolverAeropuertoVuelo('Cartagena, España', 'destino');
  assert.equal(r.iata, 'RMU');
  assert.match(r.aviso ?? '', /no tiene aeropuerto propio/);
  assert.throws(() => resolverAeropuertoVuelo('Xyzzyland', 'destino'), /No he podido identificar el aeropuerto IATA/);
});

const filas = (extra: Record<string, unknown> = {}) => [{
  price: 120, currency: 'EUR', airlines: 'Aerolínea Ficticia',
  departure_airport: { name: 'A', id: 'AAA', time: '2027-03-10 08:00' }, arrival_airport: { name: 'B', id: 'BBB', time: '2027-03-10 10:00' },
  duration: '2 h', stops: 0, flight_number: 'XX 1', ...extra,
}];

/** Cliente de Apify falso que registra el input real que recibiría el actor. */
function conActorFalso() {
  const entradas: any[] = [];
  const cliente = {
    actor: () => ({ call: async (input: any) => { entradas.push(input); return { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' }; } }),
    dataset: () => ({ listItems: async () => ({ items: filas() }) }),
  };
  process.env.APIFY_API_TOKEN = 'x';
  console.info = () => {};
  return { entradas, buscar: (p: any) => buscarVuelosApify(p, { crearCliente: () => cliente as any }) };
}

const viaje = (origen: string, destino: string, extra: Record<string, unknown> = {}) =>
  ({ origen, destino, fechaIda: '2027-03-10', fechaVuelta: '2027-03-17', pasajeros: 2, ...extra });

test('Madrid → Bruselas: el actor recibe MAD→BRU (ida) y BRU→MAD (vuelta) con sus fechas y pasajeros', async () => {
  const { entradas, buscar } = conActorFalso();
  const r = await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar });
  assert.equal(r.estado, 'ok');
  const ida = entradas.find((e) => e.departure_id === 'MAD')!;
  const vuelta = entradas.find((e) => e.departure_id === 'BRU')!;
  assert.deepEqual([ida.arrival_id, ida.outbound_date, ida.adults], ['BRU', '2027-03-10', 2]);
  assert.deepEqual([vuelta.arrival_id, vuelta.outbound_date, vuelta.adults], ['MAD', '2027-03-17', 2]);
  assert.equal(r.aeropuertoDestino, 'BRU');
  assert.equal(r.aeropuertoOrigen, 'MAD');
});

test('Barcelona → Sarajevo: BCN↔SJJ; Madrid → París: MAD↔CDG; Madrid → Brussels Airport: MAD↔BRU', async () => {
  for (const [o, d, a, b] of [['Barcelona', 'Sarajevo', 'BCN', 'SJJ'], ['Madrid', 'París', 'MAD', 'CDG'], ['Madrid', 'Brussels Airport', 'MAD', 'BRU']] as const) {
    const { entradas, buscar } = conActorFalso();
    const r = await buscarVuelosConEstado(viaje(o, d), { buscar });
    assert.equal(r.estado, 'ok', `${o}→${d}`);
    assert.deepEqual(entradas.map((e) => `${e.departure_id}>${e.arrival_id}`).sort(), [`${a}>${b}`, `${b}>${a}`].sort(), `${o}→${d}`);
  }
});

test('aeropuerto fijado por el servidor: el modelo no puede sustituir BRU/SJJ del destino elegido (ni con otro IATA ni con otra grafía)', async () => {
  const bruselas = { nombre: 'Brussels', pais: 'Bélgica', codigoPais: 'BE', id: 'gn:2800866', tipo: 'ciudad' };
  const sarajevo = { nombre: 'Sarajevo', pais: 'Bosnia y Herzegovina', codigoPais: 'BA', id: 'gn:3191281', tipo: 'ciudad' };
  const casos: Array<[unknown, string, string, Record<string, unknown>, string]> = [
    [bruselas, 'Madrid', 'Bruselas', { aeropuertoDestino: 'CRL' }, 'BRU'],
    [bruselas, 'Madrid', 'Brussels', { aeropuertoDestino: 'ZYX' }, 'BRU'],
    [bruselas, 'Madrid', 'Brussels, Bélgica', {}, 'BRU'],
    [sarajevo, 'Barcelona', 'Sarajevo', { aeropuertoDestino: 'ZAG' }, 'SJJ'],
  ];
  for (const [sel, o, d, extra, esperado] of casos) {
    const { entradas, buscar } = conActorFalso();
    const r = await conDestinoFijado(sel, () => buscarVuelosConEstado(viaje(o, d, extra), { buscar }));
    assert.equal(r.aeropuertoDestino, esperado, `${d} ${JSON.stringify(extra)}`);
    assert.ok(entradas.every((e) => e.departure_id === esperado || e.arrival_id === esperado));
    assert.equal(entradas.find((e) => e.departure_id !== esperado)!.departure_id, resolverAeropuertoVuelo(o, 'origen').iata, 'el origen no se toca');
  }
});

test('con un destino fijado, un lugar distinto (el origen u otro) sigue resolviéndose por su texto', async () => {
  const bruselas = { nombre: 'Brussels', pais: 'Bélgica', codigoPais: 'BE', id: 'gn:2800866', tipo: 'ciudad' };
  const { entradas, buscar } = conActorFalso();
  await conDestinoFijado(bruselas, () => buscarVuelosConEstado(viaje('Barcelona', 'Madrid'), { buscar }));
  assert.deepEqual(entradas.map((e) => `${e.departure_id}>${e.arrival_id}`).sort(), ['BCN>MAD', 'MAD>BCN']);
});

test('aeropuerto no identificable: error_parametros sin llamar al proveedor', async () => {
  let llamadas = 0;
  const r = await buscarVuelosConEstado(viaje('Madrid', 'Xyzzyland'), { buscar: async () => { llamadas++; return []; } });
  assert.equal(r.estado, 'error_parametros');
  assert.equal(llamadas, 0);
  assert.match(r.error ?? '', /No he podido identificar el aeropuerto/);
});
