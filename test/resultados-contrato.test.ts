/**
 * Contrato de /api/chat con resultados estructurados (versión 1): se ejecutan las herramientas REALES de vuelos, hoteles
 * (Apify) y actividades con proveedores simulados (sin red ni créditos) DENTRO de turnoChat (el mismo código que
 * usan api/index.ts y src/server.ts) y se comprueba el cuerpo que recibiría la web.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { turnoChat } from '../src/services/chat-contrato.ts';
import { buscarVuelosConEstado } from '../src/services/vuelos.ts';
import { buscarVuelosApify } from '../src/services/apify-flights.ts';
import { buscarHotelesConEstado } from '../src/services/hoteles.ts';
import { buscarActividadesDestino } from '../src/services/actividades-busqueda.ts';
import { registrarBloque, bloqueActividadesMultidestino, conColectorResultados } from '../src/services/resultados-estructurados.ts';
import type { EjecucionActor } from '../src/services/apify.ts';

const silencio = () => {};
console.info = silencio; console.warn = silencio;
process.env.APIFY_API_TOKEN = 'x';

/* ---------- proveedores simulados ---------- */

// Formato de registro del actor (aplanado por apify-flights): aeropuertos como objeto {name,id} y horas en departs/arrives.
const filaVuelo = (extra: Record<string, unknown> = {}) => ({
  price: 120, currency: 'EUR', airlines: 'Brussels Airlines', stops: 0, duration: '2 h 25 min', flight_number: 'SN 3200',
  departure_airport: { name: 'Madrid-Barajas', id: 'MAD' }, arrival_airport: { name: 'Brussels Airport', id: 'BRU' },
  departs: '2027-03-10 08:05', arrives: '2027-03-10 10:30', ...extra,
});
function vuelosFalsos(filas: any[] | (() => any[]), registro: any[] = []) {
  const cliente = {
    actor: () => ({ call: async (input: any) => { registro.push(input); return { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' }; } }),
    dataset: () => ({ listItems: async () => ({ items: typeof filas === 'function' ? filas() : filas }) }),
  };
  return (p: any) => buscarVuelosApify(p, { crearCliente: () => cliente as any });
}
const viaje = (origen: string, destino: string) => ({ origen, destino, fechaIda: '2027-03-10', fechaVuelta: '2027-03-17', pasajeros: 2 });

const fixture = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')) as any[];
function hotelesApifyFalso(filas: any[]) {
  const c = {
    actor: () => ({ call: async () => ({ id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds', usageTotalUsd: 0.04 }) }),
    dataset: () => ({ listItems: async () => ({ items: filas }) }),
    run: () => ({ abort: async () => {} }),
  };
  return { apify: { crearCliente: () => c as any, token: 't', registrar: silencio, env: {} } };
}
const filaHotel = (nombre: string, moneda: string | null, extra: Record<string, unknown> = {}) => ({
  recordType: 'hotel', name: nombre, hotelId: 'id-' + nombre, category: 'Hotel', hotelClass: 4, rating: 4.6, reviewsCount: 1200,
  pricePerNight: 100, totalPrice: 400, totalPriceBeforeTaxes: 380, currency: moneda, checkInDate: '2027-03-10', checkOutDate: '2027-03-14',
  nights: 4, adults: 2, address: 'Centro', url: 'https://www.google.com/travel/hotels/entity/x',
  bookingOptions: [{ provider: 'Booking.com', nightlyPrice: 95, totalStayPrice: 380, bookingUrl: 'https://www.booking.com/hotel/x.html' }], ...extra,
});
const ejec = (items: any[], status = 'SUCCEEDED', completa?: boolean): EjecucionActor =>
  ({ items, status, runId: 'run', datasetId: 'ds', consultas: [], ...(completa === undefined ? {} : { completa }) });
let n = 0;
const act = (extra: Record<string, unknown>) =>
  ({ title: 'Tour', url: `https://www.civitatis.com/es/x/t${++n}/`, platform: 'civitatis', priceFrom: 20, priceCurrency: 'EUR', ...extra });
const BXL = { latitude: 50.8467, longitude: 4.3525 };

/* ---------- forma del cuerpo ---------- */

test('turno sin búsquedas: { response, resultados vacíos } y ningún bloque inventado', async () => {
  const r = await turnoChat(undefined, async () => ({ finalOutput: 'Hola, ¿a dónde quieres viajar?' }));
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as any).resultados, { version: 1, vuelos: [], hoteles: [], actividades: [] });
  assert.equal((r.body as any).response, 'Hola, ¿a dónde quieres viajar?');
});

test('Madrid → Bruselas: el cuerpo lleva un bloque de vuelos con IATA reales, importe y moneda ISO por vuelo', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([filaVuelo()]) });
    return { finalOutput: 'He buscado vuelos entre Madrid y Bruselas.' };
  });
  const v = (r.body as any).resultados.vuelos;
  assert.equal(v.length, 1);
  assert.equal(v[0].estado, 'ok');
  assert.equal(v[0].consulta.destino.iata, 'BRU');
  assert.equal(v[0].consulta.origen.iata, 'MAD');
  assert.equal(v[0].total, v[0].opciones.length);
  assert.ok(v[0].total >= 1);
  const op = v[0].opciones[0];
  assert.deepEqual([op.precio.importe, op.precio.moneda], [240, 'EUR']); // 120 por pasajero × 2 pasajeros; moneda del proveedor
  assert.equal(op.ida.segmentos[0].salida.codigo, 'MAD');
  assert.equal(op.ida.segmentos[0].llegada.codigo, 'BRU');
  assert.match(op.id, /^vu-/);
});

test('la moneda NO se asume: un vuelo en USD sigue en USD y uno sin moneda queda con moneda null (sin EUR por defecto)', async () => {
  const usd = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([filaVuelo({ currency: 'USD', price: 300 })]) });
    return { finalOutput: '' };
  });
  assert.equal((usd.body as any).resultados.vuelos[0].opciones[0].precio.moneda, 'USD');
  const sin = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([filaVuelo({ currency: undefined, price: 300 })]) });
    return { finalOutput: '' };
  });
  const op = (sin.body as any).resultados.vuelos[0].opciones[0];
  assert.equal(op.precio.moneda, null);
  assert.ok(op.precio.importe > 0);
});

test('Barcelona → Sarajevo y Madrid → París: IATA SJJ y CDG en el bloque', async () => {
  for (const [o, d, iata] of [['Barcelona', 'Sarajevo', 'SJJ'], ['Madrid', 'París', 'CDG']] as const) {
    const r = await turnoChat(undefined, async () => {
      await buscarVuelosConEstado(viaje(o, d), { buscar: vuelosFalsos([filaVuelo()]) });
      return { finalOutput: '' };
    });
    assert.equal((r.body as any).resultados.vuelos[0].consulta.destino.iata, iata, `${o}→${d}`);
  }
});

test('fallo del proveedor de vuelos: estado error_proveedor con motivo, sin opciones y SIN presentarse como «sin vuelos»', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: async () => { throw new Error('Apify no responde'); } });
    return { finalOutput: '' };
  });
  const b = (r.body as any).resultados.vuelos[0];
  assert.equal(b.estado, 'error_proveedor');
  assert.match(b.error, /Apify no responde|no respond/i);
  assert.equal(b.total, 0);
  assert.equal(b.completo, false);
});

test('aeropuerto no identificable: error_parametros (no llega al proveedor)', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Xyzzyland'), { buscar: async () => { throw new Error('no debe llamarse'); } });
    return { finalOutput: '' };
  });
  assert.equal((r.body as any).resultados.vuelos[0].estado, 'error_parametros');
});

test('vuelos: proveedor que responde sin vuelos → sin_resultados (distinto de error)', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([]) });
    return { finalOutput: '' };
  });
  const b = (r.body as any).resultados.vuelos[0];
  assert.equal(b.estado, 'sin_resultados');
  assert.equal(b.error, null);
});

/* ---------- hoteles: dos proveedores, mismo formato ---------- */

const UBIC: Record<string, Record<string, any>> = {
  'Bruselas': { searchLocation: 'Brussels', address: 'Rue Neuve 1, 1000 Brussels, Bélgica', countryCode: 'BE', latitude: 50.8467, longitude: 4.3525 },
  'Sarajevo': { searchLocation: 'Sarajevo', address: 'Ferhadija 1, Sarajevo, Bosnia y Herzegovina', countryCode: 'BA', latitude: 43.8563, longitude: 18.4131 },
  'París': { searchLocation: 'Paris', address: 'Rue de Rivoli 1, 75001 Paris, Francia', countryCode: 'FR', latitude: 48.8566, longitude: 2.3522 },
};
const BASE_H = { fechaEntrada: '2027-03-10', fechaSalida: '2027-03-14', adultos: 2 };
const CAMPOS_HOTEL = ['id', 'nombre', 'tipoAlojamiento', 'estrellas', 'valoracion', 'valoracionEscala', 'numeroResenas', 'precio', 'enlace', 'enlaceEsAlternativo', 'ofertas'];

for (const destino of ['Bruselas', 'Sarajevo', 'París']) {
  test(`hoteles ${destino}: bloque con el esquema estable y la moneda del proveedor`, async () => {
    const apify = await turnoChat(undefined, async () => {
      await buscarHotelesConEstado({ destino, ...BASE_H }, hotelesApifyFalso([filaHotel('Hotel A', 'EUR', UBIC[destino]), filaHotel('Hotel B', 'BAM', { rating: null, reviewsCount: null, ...UBIC[destino] })]));
      return { finalOutput: '' };
    });
    const ba = (apify.body as any).resultados.hoteles[0];
    assert.equal(ba.proveedor.id, 'apify-google-hotels');
    for (const b of [ba]) {
      assert.equal(b.tipo, 'hoteles');
      assert.equal(b.total, b.opciones.length);
      for (const campo of CAMPOS_HOTEL) assert.ok(campo in b.opciones[0], `${b.proveedor.id} sin campo ${campo}`);
      assert.deepEqual(Object.keys(b).sort(), ['avisos', 'completo', 'consulta', 'diagnostico', 'error', 'estado', 'opciones', 'proveedor', 'tipo', 'total'].sort());
    }
    assert.deepEqual(ba.opciones.map((h: any) => h.precio.moneda), ['EUR', 'BAM']);
    assert.equal(ba.opciones[1].valoracion, null, 'sin valoración = null, nunca 0');
  });
}

test('hoteles: error del proveedor (HTTP 429 de Apify) → error_proveedor con diagnóstico, no «sin alojamientos»', async () => {
  const c = {
    actor: () => ({ call: async () => { throw Object.assign(new Error('Too many requests'), { statusCode: 429 }); } }),
    dataset: () => ({ listItems: async () => ({ items: [] }) }),
    run: () => ({ abort: async () => {} }),
  };
  const r = await turnoChat(undefined, async () => {
    await buscarHotelesConEstado({ destino: 'Bruselas', ...BASE_H }, { apify: { crearCliente: () => c as any, token: 't', registrar: silencio, env: {} } });
    return { finalOutput: '' };
  });
  const b = (r.body as any).resultados.hoteles[0];
  assert.equal(b.estado, 'error_proveedor');
  assert.equal(b.total, 0);
  assert.equal(b.diagnostico.httpStatus, 429);
  assert.ok(b.error);
});

/* ---------- actividades ---------- */

test('actividades: bloque Civitatis con moneda propia, gratis ≠ sin precio y plataforma no activa descartada', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarActividadesDestino({ destino: 'Bruselas', tipos: ['cultura'] }, async () => ejec([
      act({ title: 'Atomium', city: 'Brussels', ...BXL }),
      act({ title: 'En USD', city: 'Brussels', ...BXL, priceFrom: 30, priceCurrency: 'USD' }),
      act({ title: 'Sin precio', city: 'Brussels', ...BXL, priceFrom: undefined, priceCurrency: undefined }),
      act({ title: 'Tour gratis', city: 'Brussels', ...BXL, priceFrom: undefined, isFree: true }),
      act({ title: 'Tiqets no', city: 'Brussels', ...BXL, platform: 'tiqets' }),
    ]));
    return { finalOutput: '' };
  });
  const b = (r.body as any).resultados.actividades[0];
  assert.equal(b.proveedor.id, 'apify-civitatis');
  assert.equal(b.estado, 'ok');
  const por = (nombre: string) => b.opciones.find((a: any) => a.nombre === nombre);
  assert.deepEqual([por('Atomium').precio.importe, por('Atomium').precio.moneda], [20, 'EUR']);
  assert.equal(por('En USD').precio.moneda, 'USD');
  assert.deepEqual([por('Sin precio').precio.importe, por('Sin precio').precio.esGratis], [null, false]);
  assert.equal(por('Tour gratis').precio.esGratis, true);
  assert.equal(por('Tiqets no'), undefined);
  assert.ok(b.opciones.every((a: any) => a.plataforma === 'civitatis'));
  assert.equal(b.total, 4);
});

test('actividades: ejecución todavía en marcha → parcial / completo=false (no se presenta como final)', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => ejec([act({ city: 'Brussels', ...BXL })], 'RUNNING', false));
    return { finalOutput: '' };
  });
  const b = (r.body as any).resultados.actividades[0];
  assert.equal(b.estado, 'parcial');
  assert.equal(b.completo, false);
  assert.equal(b.total, 1);
});

test('actividades: error del proveedor → error_proveedor con motivo; sin resultados → sin_resultados', async () => {
  const e = await turnoChat(undefined, async () => {
    await buscarActividadesDestino({ destino: 'París', tipos: [] }, async () => { throw new Error('actor caído'); });
    return { finalOutput: '' };
  });
  assert.equal((e.body as any).resultados.actividades[0].estado, 'error_proveedor');
  assert.match((e.body as any).resultados.actividades[0].error, /actor caído/);
  const v = await turnoChat(undefined, async () => {
    await buscarActividadesDestino({ destino: 'París', tipos: [] }, async () => ejec([]));
    return { finalOutput: '' };
  });
  assert.equal((v.body as any).resultados.actividades[0].estado, 'sin_resultados');
});

test('multidestino: un bloque de actividades por ciudad, cada uno con su destino', async () => {
  const r = await conColectorResultados(async () => {
    registrarBloque(bloqueActividadesMultidestino({ ciudad: 'Bruselas', tipos: [], actividades: [{ nombre: 'Atomium', url: 'https://www.civitatis.com/a', precio: 20, moneda: 'EUR', plataforma: 'civitatis' }], error: null, completa: true }));
    registrarBloque(bloqueActividadesMultidestino({ ciudad: 'Sarajevo', tipos: [], actividades: [], error: 'actor caído', completa: false }));
  });
  const [a, b] = r.resultados.actividades;
  assert.deepEqual([a!.consulta.destino, a!.estado, a!.total], ['Bruselas', 'ok', 1]);
  assert.deepEqual([b!.consulta.destino, b!.estado, b!.total], ['Sarajevo', 'error_proveedor', 0]);
});

/* ---------- robustez del turno ---------- */

test('si el agente falla DESPUÉS de obtener resultados reales, no se pierden (HTTP 200 con aviso)', async () => {
  const r = await turnoChat(undefined, async () => {
    await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([filaVuelo()]) });
    throw new Error('el modelo falló al redactar');
  });
  assert.equal(r.status, 200);
  assert.equal((r.body as any).resultados.vuelos[0].total, 1);
  assert.match((r.body as any).aviso, /no se ha podido redactar/);
});

test('si falla sin resultados, es un error 500 con mensaje', async () => {
  const r = await turnoChat(undefined, async () => { throw new Error('sin modelo'); });
  assert.equal(r.status, 500);
  assert.match((r.body as any).error, /sin modelo/);
});

test('peticiones simultáneas no mezclan sus resultados (colector por petición)', async () => {
  const [a, b] = await Promise.all([
    turnoChat(undefined, async () => { await buscarVuelosConEstado(viaje('Madrid', 'Bruselas'), { buscar: vuelosFalsos([filaVuelo()]) }); return { finalOutput: 'a' }; }),
    turnoChat(undefined, async () => { await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => ejec([act({ city: 'Brussels', ...BXL })])); return { finalOutput: 'b' }; }),
  ]);
  assert.equal((a.body as any).resultados.actividades.length, 0);
  assert.equal((a.body as any).resultados.vuelos.length, 1);
  assert.equal((b.body as any).resultados.vuelos.length, 0);
  assert.equal((b.body as any).resultados.actividades.length, 1);
});
