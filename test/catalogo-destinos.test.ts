/**
 * Catálogo de destinos (src/geo/data/catalogo): selección reproducible de destinos, no un catálogo mundial.
 * Comprueba los destinos obligatorios (nombre en español e inglés, IATA de aeropuerto y de ciudad), la separación
 * ciudad/aeropuerto/código de ciudad, el límite de 3 aeropuertos y que el destino elegido llega a vuelos con su aeropuerto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { DESTINOS_EDITORIALES } from '../src/geo/destinos-editoriales.ts';
import { aeropuertoDeDestinoSeleccionado, resolverAeropuertoVuelo } from '../src/services/aeropuertos-vuelos.ts';

const cat = new Catalogo(fuenteEnDisco());
const primero = (q: string, o: { pais?: string } = {}) => buscarDestinos(cat, q, { limite: 6, ...o })[0];
const ciudadDe = (r: ReturnType<typeof primero>) => { assert.ok(r && r.tipo === 'ciudad' && r.codigoPais, JSON.stringify(r)); return cat.ciudad(r!.id, r!.codigoPais!)!; };

/** [consultas, nombre mostrado, país ISO, aeropuertos (el primero es el principal)] */
const OBLIGATORIOS: Array<[string[], string, string, string[]]> = [
  [['Madrid', 'MAD'], 'Madrid', 'ES', ['MAD']],
  [['Barcelona', 'BCN'], 'Barcelona', 'ES', ['BCN']],
  [['París', 'Paris', 'PAR'], 'Paris', 'FR', ['CDG', 'ORY', 'BVA']],
  [['Londres', 'London', 'LON'], 'London', 'GB', ['LHR', 'LGW', 'STN']],
  [['Bruselas', 'Brussels', 'BRU'], 'Brussels', 'BE', ['BRU', 'CRL']],
  [['Ámsterdam', 'Amsterdam', 'AMS'], 'Amsterdam', 'NL', ['AMS']],
  [['Berlín', 'Berlin', 'BER'], 'Berlin', 'DE', ['BER']],
  [['Roma', 'Rome', 'ROM'], 'Rome', 'IT', ['FCO', 'CIA']],
  [['Milán', 'Milan', 'MIL'], 'Milan', 'IT', ['MXP', 'LIN', 'BGY']],
  [['Lisboa', 'Lisbon', 'LIS'], 'Lisbon', 'PT', ['LIS']],
  [['Oporto', 'Porto', 'OPO'], 'Porto', 'PT', ['OPO']],
  [['Praga', 'Prague', 'PRG'], 'Prague', 'CZ', ['PRG']],
  [['Viena', 'Vienna', 'VIE'], 'Vienna', 'AT', ['VIE']],
  [['Budapest', 'BUD'], 'Budapest', 'HU', ['BUD']],
  [['Varsovia', 'Warsaw', 'WAW'], 'Warsaw', 'PL', ['WAW']],
  [['Cracovia', 'Krakow', 'KRK'], 'Kraków', 'PL', ['KRK']],
  [['Atenas', 'Athens', 'ATH'], 'Athens', 'GR', ['ATH']],
  [['Estambul', 'Istanbul', 'IST'], 'Istanbul', 'TR', ['IST', 'SAW']],
  [['Copenhague', 'Copenhagen', 'CPH'], 'Copenhagen', 'DK', ['CPH']],
  [['Estocolmo', 'Stockholm', 'STO'], 'Stockholm', 'SE', ['ARN', 'BMA']],
  [['Oslo', 'OSL'], 'Oslo', 'NO', ['OSL']],
  [['Helsinki', 'HEL'], 'Helsinki', 'FI', ['HEL']],
  [['Dublín', 'Dublin', 'DUB'], 'Dublin', 'IE', ['DUB']],
  [['Edimburgo', 'Edinburgh', 'EDI'], 'Edinburgh', 'GB', ['EDI']],
  [['Dubrovnik', 'DBV'], 'Dubrovnik', 'HR', ['DBV']],
  [['Split', 'SPU'], 'Split', 'HR', ['SPU']],
  [['Zagreb', 'ZAG'], 'Zagreb', 'HR', ['ZAG']],
  [['Sarajevo', 'SJJ'], 'Sarajevo', 'BA', ['SJJ']],
  [['Belgrado', 'Belgrade', 'BEG'], 'Belgrade', 'RS', ['BEG']],
  [['Sofía', 'Sofia', 'SOF'], 'Sofia', 'BG', ['SOF']],
  [['Bucarest', 'Bucharest'], 'Bucharest', 'RO', ['OTP', 'BBU']],
  [['Tirana', 'TIA'], 'Tirana', 'AL', ['TIA']],
  [['Reikiavik', 'Reykjavik'], 'Reykjavík', 'IS', ['KEF']],
  [['Nueva York', 'New York', 'NYC'], 'New York City', 'US', ['JFK', 'EWR', 'LGA']],
  [['Miami', 'MIA'], 'Miami', 'US', ['MIA']],
  [['Los Ángeles', 'Los Angeles', 'LAX'], 'Los Angeles', 'US', ['LAX']],
  [['Tokio', 'Tokyo', 'TYO'], 'Tokyo', 'JP', ['HND', 'NRT']],
  [['Bangkok', 'BKK'], 'Bangkok', 'TH', ['BKK', 'DMK']],
  [['Singapur', 'Singapore', 'SIN'], 'Singapore', 'SG', ['SIN']],
  [['Dubái', 'Dubai', 'DXB'], 'Dubai', 'AE', ['DXB']],
  [['Marrakech', 'Marrakesh', 'RAK'], 'Marrakesh', 'MA', ['RAK']],
  [['El Cairo', 'Cairo', 'CAI'], 'Cairo', 'EG', ['CAI']],
  [['Buenos Aires', 'BUE'], 'Buenos Aires', 'AR', ['EZE', 'AEP']],
  [['Río de Janeiro', 'Rio de Janeiro', 'RIO'], 'Rio de Janeiro', 'BR', ['GIG', 'SDU']],
  [['Ciudad de México', 'Mexico City', 'MEX'], 'Mexico City', 'MX', ['MEX']],
];

test('destinos obligatorios: se encuentran como CIUDAD primero (es, en, IATA de aeropuerto y de ciudad), con su país y aeropuerto principal', () => {
  for (const [consultas, nombre, pais, aeropuertos] of OBLIGATORIOS) {
    for (const q of consultas) {
      const r = primero(q);
      assert.ok(r, q);
      assert.equal(r!.tipo, 'ciudad', `${q}: la ciudad va antes que el aeropuerto`);
      assert.equal(r!.nombre, nombre, q);
      assert.equal(r!.codigoPais, pais, q);
      assert.deepEqual(r!.aeropuertos, aeropuertos, `${q}: aeropuertos`);
    }
  }
});

test('Bruselas: «Brussels Airport» y BRU llevan a la ciudad con su aeropuerto, sin confundir ciudad y aeropuerto', () => {
  const bru = buscarDestinos(cat, 'BRU', { limite: 6 });
  assert.equal(bru[0]!.tipo, 'ciudad');
  assert.ok(bru.some((r) => r.tipo === 'aeropuerto' && r.id === 'iata:BRU'), 'el aeropuerto también se ofrece, después');
  for (const t of ['Bruselas', 'Brussels', 'Brussels Airport', 'BRU', 'Madrid → Bruselas'.split('→')[1]!.trim()]) {
    assert.equal(resolverAeropuertoVuelo(t, 'destino').iata, 'BRU', t);
  }
});

test('Salento y Cartagena conservan sus homónimos: Colombia, Apulia y Campania; Colombia y Murcia', () => {
  const salento = buscarDestinos(cat, 'Salento', { limite: 6 });
  assert.deepEqual(salento.map((r) => `${r.codigoPais}/${r.region}`), ['CO/Quindío', 'IT/Apulia', 'IT/Campania']);
  const cartagena = buscarDestinos(cat, 'Cartagena', { limite: 6 });
  assert.deepEqual(cartagena.map((r) => `${r.codigoPais}/${r.region}`).sort(), ['CO/Bolívar', 'ES/Región de Murcia']);
});

test('destinos que antes no se encontraban: islas y zonas turísticas con su aeropuerto de acceso', () => {
  const esperado: Record<string, [string, string]> = {
    Santorini: ['GR', 'JTR'], Menorca: ['ES', 'MAH'], Mallorca: ['ES', 'PMI'], Bali: ['ID', 'DPS'], Positano: ['IT', 'NAP'],
    Dolomitas: ['IT', 'VRN'], 'Isla de Pascua': ['CL', 'IPC'], Creta: ['GR', 'HER'], Sicilia: ['IT', 'PMO'], Madeira: ['PT', 'FNC'],
    Malta: ['MT', 'MLA'], Aruba: ['AW', 'AUA'], Maldivas: ['MV', 'MLE'], Luxemburgo: ['LU', 'LUX'], Panamá: ['PA', 'PTY'], Kuwait: ['KW', 'KWI'], Argel: ['DZ', 'ALG'],
  };
  for (const [q, [pais, iata]] of Object.entries(esperado)) {
    const r = primero(q);
    assert.ok(r, q);
    assert.ok(r!.tipo === 'ciudad' || r!.tipo === 'pais', `${q}: ${r!.tipo}`); // «Kuwait», «Malta»… son también el país
    assert.equal(r!.codigoPais, pais, q);
    if (r!.tipo === 'ciudad') assert.equal(r!.aeropuertos?.[0], iata, q);
    assert.equal(resolverAeropuertoVuelo(q, 'destino').iata, iata, `${q}: vuelos`);
  }
});

test('ciudad, aeropuerto y código de ciudad son cosas distintas: máximo 3 aeropuertos, todos existentes y de la ciudad', () => {
  const codigosCiudad = new Set<string>();
  let ciudades = 0;
  for (const p of cat.paises()) {
    const s = cat.shard(p.iso);
    if (!s) continue;
    for (const c of Object.values(s.ciudades)) {
      ciudades++;
      assert.ok(c.aeropuertos.length <= 3, `${c.nombre}: ${c.aeropuertos.join(',')}`);
      assert.equal(new Set(c.aeropuertos).size, c.aeropuertos.length, `${c.nombre}: aeropuertos repetidos`);
      for (const i of c.aeropuertos) {
        const ap = s.aeropuertos[i];
        assert.ok(ap, `${c.nombre}: ${i} no existe en el país ${p.iso}`);
        assert.equal(ap!.ciudadId, c.id, `${i} debe pertenecer a ${c.nombre}`);
      }
      if (c.codigoCiudad) codigosCiudad.add(c.codigoCiudad);
    }
  }
  assert.ok(ciudades > 3_000 && ciudades < 10_000, `${ciudades} destinos`);
  // Un aeropuerto pertenece a una sola ciudad.
  const vistos = new Map<string, string>();
  for (const a of cat.todosAeropuertos()) {
    if (!a.ciudadId) continue;
    assert.ok(!vistos.has(a.iata), a.iata);
    vistos.set(a.iata, a.ciudadId);
  }
  // Los códigos de ciudad son pocos, de tres letras y los de ciudades que IATA define como metropolitanas.
  assert.ok(codigosCiudad.size >= 15 && codigosCiudad.size <= 30, [...codigosCiudad].join(','));
  for (const k of ['PAR', 'LON', 'ROM', 'MIL', 'NYC']) assert.ok(codigosCiudad.has(k), k);
});

test('asociación de aeropuertos: Girona no es aeropuerto de Barcelona, Charleroi sí es alternativa de Bruselas, Zagreb/Cracovia/Panamá tienen el suyo', () => {
  const bcn = ciudadDe(primero('Barcelona', { pais: 'ES' }));
  assert.deepEqual(bcn.aeropuertos, ['BCN']);
  const gro = ciudadDe(primero('Girona'));
  assert.deepEqual(gro.aeropuertos, ['GRO']);
  assert.deepEqual(ciudadDe(primero('Bruselas')).aeropuertos, ['BRU', 'CRL']);
  assert.deepEqual(ciudadDe(primero('Zagreb')).aeropuertos, ['ZAG']);
  assert.deepEqual(ciudadDe(primero('Cracovia')).aeropuertos, ['KRK']);
  assert.deepEqual(ciudadDe(primero('Panama City')).aeropuertos.slice(0, 1), ['PTY']);
});

test('Londres y London dan el mismo aeropuerto principal (antes LHR y LTN); Moscú y Aruba no caen en un aeropuerto ajeno', () => {
  assert.equal(resolverAeropuertoVuelo('Londres', 'destino').iata, 'LHR');
  assert.equal(resolverAeropuertoVuelo('London', 'destino').iata, 'LHR');
  assert.equal(resolverAeropuertoVuelo('Moscú', 'destino').iata, 'SVO');
  assert.equal(resolverAeropuertoVuelo('Aruba', 'destino').iata, 'AUA');
});

test('un código IATA de ciudad nunca llega al proveedor: PAR → CDG, ROM → FCO, LON → LHR; uno de aeropuerto se respeta (LGW)', () => {
  for (const [codigo, iata] of [['PAR', 'CDG'], ['par', 'CDG'], ['ROM', 'FCO'], ['LON', 'LHR'], ['NYC', 'JFK'], ['MIL', 'MXP'], ['Paris (PAR)', 'CDG']] as const) {
    assert.equal(resolverAeropuertoVuelo(codigo, 'destino').iata, iata, codigo);
  }
  assert.equal(resolverAeropuertoVuelo('LGW', 'destino').iata, 'LGW');
  assert.equal(resolverAeropuertoVuelo('ORY', 'destino').iata, 'ORY');
  assert.match(resolverAeropuertoVuelo('PAR', 'destino').aviso ?? '', /código de ciudad/);
});

test('el destino elegido en el autocompletado llega a vuelos con su aeropuerto, también en islas y zonas (id editorial)', () => {
  for (const [q, iata] of [['Sarajevo', 'SJJ'], ['Dubrovnik', 'DBV'], ['Oslo', 'OSL'], ['Bruselas', 'BRU'], ['París', 'CDG'], ['Menorca', 'MAH'], ['Santorini', 'JTR']] as const) {
    const r = primero(q)!;
    const sel = { nombre: r.nombre, codigoPais: r.codigoPais!, id: r.id, tipo: 'ciudad' as const };
    assert.equal(aeropuertoDeDestinoSeleccionado(sel, cat)?.iata, iata, q);
  }
});

test('destinos editoriales: sus aeropuertos existen en el catálogo y son del mismo país', () => {
  for (const d of Object.values(DESTINOS_EDITORIALES)) {
    for (const i of d.aeropuertos) {
      const a = cat.aeropuertoPorIata(i);
      assert.ok(a, `${d.id}: ${i} no está en el catálogo`);
      assert.equal(a!.pais, d.pais, `${d.id}: ${i}`);
    }
  }
});

test('sin ruido: sin distritos ni duplicados en los resultados y sin resultados absurdos para los destinos clave', () => {
  for (const q of ['Budapest', 'Amsterdam', 'Ibiza', 'Paris', 'Madrid', 'Londres']) {
    const r = buscarDestinos(cat, q, { limite: 12 });
    assert.equal(new Set(r.map((x) => x.id)).size, r.length, `${q}: ids repetidos`);
    assert.ok(!r.some((x) => /kerület|Nieuw-West|arrondissement/i.test(x.nombre)), `${q}: distritos`);
    const clavesVisibles = r.map((x) => `${x.nombre}|${x.codigoPais}|${x.region ?? ''}`);
    assert.equal(new Set(clavesVisibles).size, clavesVisibles.length, `${q}: misma ciudad repetida`);
  }
  assert.equal(primero('Sídney')!.codigoPais, 'AU');
  assert.equal(primero('Valencia')!.codigoPais, 'ES');
});

test('tamaño: el catálogo es pequeño (no mundial) y no cambia el formato', () => {
  const bytes = (fs.readdirSync(DIR_CATALOGO, { recursive: true }) as string[])
    .map((f) => path.join(DIR_CATALOGO, f)).filter((f) => fs.statSync(f).isFile()).reduce((s, f) => s + fs.statSync(f).size, 0);
  assert.ok(bytes < 8 * 1024 * 1024, `${(bytes / 1048576).toFixed(1)} MB`);
});
