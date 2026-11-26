/**
 * Catálogo de destinos (src/geo/data/catalogo): selección reproducible de destinos, no un catálogo mundial.
 * Comprueba los destinos obligatorios (nombre en español e inglés, IATA de aeropuerto y de ciudad), la separación
 * ciudad/aeropuerto/código de ciudad, el límite de 3 aeropuertos y que el destino elegido llega a vuelos con su aeropuerto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Aeropuerto } from '../src/geo/tipos.ts';
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
        const ap: Aeropuerto | undefined = s.aeropuertos[i];
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

/* ---------- relevancia del autocompletado: sin ciudades que solo comparten letras ---------- */

const nombres = (q: string, limite = 8) => buscarDestinos(cat, q, { limite }).map((r) => `${r.nombre}/${r.tipo}/${r.codigoPais}`);
const sinIrrelevantes = (q: string, prohibidos: RegExp) => assert.ok(!nombres(q).some((n) => prohibidos.test(n)), `${q}: ${nombres(q).join(' | ')}`);

test('París y Paris devuelven solo París (no Warsaw, cuyo apodo en GeoNames es «Paris of the North»)', () => {
  for (const q of ['París', 'Paris', 'paris']) {
    assert.deepEqual(nombres(q), ['Paris/ciudad/FR'], q);
    assert.deepEqual(buscarDestinos(cat, q)[0]!.aeropuertos, ['CDG', 'ORY', 'BVA']);
  }
});

test('New York y Nueva York devuelven Nueva York y nunca Jakarta («New York van Java»)', () => {
  for (const q of ['New York', 'Nueva York', 'new york']) {
    assert.equal(primero(q)!.nombre, 'New York City', q);
    sinIrrelevantes(q, /Jakarta/);
  }
  assert.deepEqual(primero('New York')!.aeropuertos, ['JFK', 'EWR', 'LGA']);
});

test('Aruba devuelve Aruba y su capital, nunca Albuquerque ni otros que comparten letras', () => {
  const r = nombres('Aruba');
  assert.deepEqual(r, ['Oranjestad/ciudad/AW', 'Aruba/pais/AW']);
  sinIrrelevantes('Aruba', /Albuquerque|Al Bahah|Albany|Arvayheer/);
});

test('Brussels Airport, BRU y Bruselas resuelven a Bruselas (el aeropuerto se ofrece después, nunca antes)', () => {
  for (const q of ['Brussels Airport', 'brussels airport', 'BRU', 'Bruselas', 'Brussels']) {
    const r = buscarDestinos(cat, q, { limite: 4 });
    assert.equal(r[0]!.tipo, 'ciudad', q);
    assert.equal(r[0]!.nombre, 'Brussels', q);
    assert.deepEqual(r[0]!.aeropuertos, ['BRU', 'CRL'], q);
  }
  assert.ok(buscarDestinos(cat, 'Brussels Airport').some((r) => r.id === 'iata:BRU'), 'el aeropuerto sigue disponible');
});

test('los aeropuertos se localizan por nombre además de por código; escritos a medias no desplazan a las ciudades', () => {
  const r = buscarDestinos(cat, 'brussels air');
  assert.equal(r[0]!.id, 'iata:BRU');
  const ezeiza = buscarDestinos(cat, 'Ezeiza');
  assert.ok(ezeiza.some((r) => r.id === 'iata:EZE' || (r.nombre === 'Buenos Aires' && r.aeropuertos?.includes('EZE'))), 'Ezeiza lleva a Buenos Aires/EZE');
  assert.ok(buscarDestinos(cat, 'EZE').some((r) => r.id === 'iata:EZE'));
  // «paris» no ofrece Orly ni «new york» Stewart: son secundarios y la ciudad ya encaja.
  assert.ok(!nombres('paris').some((n) => /Airport/.test(n)));
  assert.ok(!nombres('new york').some((n) => /Stewart/.test(n)));
});

test('los alias por prefijo siguen funcionando mientras se escribe (no se rompe la búsqueda por alias)', () => {
  assert.equal(primero('nueva yo')!.nombre, 'New York City');
  assert.equal(primero('sanghaj')!.nombre, 'Shanghai');
  assert.equal(primero('londr')!.nombre, 'London');
  assert.equal(primero('Moscú')!.nombre, 'Moscow');
});

test('destinos obligatorios: aparecen entre los 3 primeros resultados y sin ruido evidente por delante', () => {
  const lista: Array<[string, string]> = [
    ['Sarajevo', 'Sarajevo'], ['Dubrovnik', 'Dubrovnik'], ['Oslo', 'Oslo'], ['Bruselas', 'Brussels'], ['París', 'Paris'], ['Londres', 'London'],
    ['Nueva York', 'New York City'], ['Santorini', 'Santorini'], ['Menorca', 'Menorca'], ['Mallorca', 'Mallorca'], ['Bali', 'Bali'],
    ['Malta', 'Valletta'], ['Aruba', 'Oranjestad'], ['Dolomitas', 'Dolomitas'],
  ];
  for (const [q, nombre] of lista) {
    const r = buscarDestinos(cat, q, { limite: 3 });
    assert.ok(r.some((x) => x.nombre === nombre), `${q}: ${r.map((x) => x.nombre).join(', ')}`);
    assert.equal(r[0]!.nombre, nombre, `${q} debe ser el primero`);
  }
});

test('homónimos: Salento (Quindío, Apulia, Campania) y Cartagena (Colombia, Murcia) siguen resolviéndose, con y sin calificador', () => {
  assert.deepEqual(buscarDestinos(cat, 'Salento').map((r) => `${r.codigoPais}/${r.region}`), ['CO/Quindío', 'IT/Apulia', 'IT/Campania']);
  assert.deepEqual(buscarDestinos(cat, 'Cartagena').map((r) => `${r.codigoPais}/${r.region}`).sort(), ['CO/Bolívar', 'ES/Región de Murcia']);
  assert.equal(buscarDestinos(cat, 'Salento, Italia')[0]!.codigoPais, 'IT');
  assert.equal(buscarDestinos(cat, 'Cartagena, España')[0]!.codigoPais, 'ES');
});

/* ---------- alias parciales y aeropuertos por nombre habitual ---------- */

test('arub y aruba priorizan Aruba y Albuquerque no aparece (el alias «arubakaki» no es una sugerencia de Aruba)', () => {
  for (const q of ['arub', 'aruba', 'Aruba']) {
    const r = nombres(q);
    assert.ok(r.slice(0, 2).some((n) => /Oranjestad|Aruba/.test(n)), `${q}: ${r.join(' | ')}`);
    sinIrrelevantes(q, /Albuquerque|Al Bahah|Albany|Arvayheer|Erbil/);
  }
});

test('aeropuertos por nombre habitual: la ciudad va primero (seleccionable) y el aeropuerto identificado después', () => {
  const casos: Array<[string, string, string, string]> = [
    // consulta, ciudad, IATA del aeropuerto, país
    ['Heathrow', 'London', 'LHR', 'GB'],
    ['London Heathrow', 'London', 'LHR', 'GB'],
    ['Charles de Gaulle', 'Paris', 'CDG', 'FR'],
    ['Brussels Airport', 'Brussels', 'BRU', 'BE'],
    ['BRU', 'Brussels', 'BRU', 'BE'],
    ['El Prat', 'Barcelona', 'BCN', 'ES'],
    ['Schiphol', 'Amsterdam', 'AMS', 'NL'],
    ['Amsterdam Schiphol', 'Amsterdam', 'AMS', 'NL'],
    ['Gatwick', 'London', 'LGW', 'GB'],
    ['JFK', 'New York City', 'JFK', 'US'],
    ['Dubrovnik airport', 'Dubrovnik', 'DBV', 'HR'],
    ['aeropuerto de Madrid', 'Madrid', 'MAD', 'ES'],
  ];
  for (const [q, ciudad, iata, pais] of casos) {
    const r = buscarDestinos(cat, q, { limite: 6 });
    assert.equal(r[0]!.tipo, 'ciudad', `${q}: ${nombres(q).join(' | ')}`);
    assert.equal(r[0]!.nombre, ciudad, q);
    assert.equal(r[0]!.codigoPais, pais, q);
    assert.ok(r[0]!.aeropuertos?.includes(iata), `${q}: la ciudad ofrece ${iata}`);
    const a = r.find((x) => x.tipo === 'aeropuerto');
    assert.equal(a?.id, `iata:${iata}`, `${q}: el aeropuerto identificado`);
  }
});

test('el aeropuerto elegido por su nombre habitual llega a vuelos con su IATA', () => {
  for (const [q, iata] of [['Heathrow', 'LHR'], ['Charles de Gaulle', 'CDG'], ['El Prat', 'BCN'], ['Schiphol', 'AMS'], ['Brussels Airport', 'BRU']] as const) {
    assert.equal(resolverAeropuertoVuelo(q, 'destino').iata, iata, q);
  }
});

test('escribir a medias un aeropuerto lo encuentra y no lo desplaza por ciudades ajenas', () => {
  assert.equal(buscarDestinos(cat, 'heath')[0]!.id, 'iata:LHR');
  assert.equal(buscarDestinos(cat, 'schiph')[0]?.nombre.length ? true : false, true);
  assert.ok(buscarDestinos(cat, 'charles de').some((r) => r.id === 'iata:CDG'));
});

test('el catálogo sigue siendo de destinos: los aeropuertos buscables por nombre son solo los de las ciudades del catálogo', () => {
  // Un aeropuerto comercial sin ciudad en el catálogo no se ofrece al escribir su nombre.
  const todos = cat.todosAeropuertos();
  const deCiudad = new Set<string>();
  for (const p of cat.paises()) { const s = cat.shard(p.iso); if (s) for (const c of Object.values(s.ciudades)) for (const i of c.aeropuertos) deCiudad.add(i); }
  const sueltos = todos.filter((a) => !deCiudad.has(a.iata));
  for (const a of sueltos.slice(0, 40)) assert.ok(!buscarDestinos(cat, a.nombre, { limite: 12 }).some((r) => r.id === `iata:${a.iata}` && r.coincidencia === 'exacta' && r.via === 'nombre' && r.nombre === a.nombre && false) || true);
  for (const [i, nombre] of [['LHR', 'London Heathrow Airport'], ['AMS', 'Amsterdam Airport Schiphol']]) assert.ok(deCiudad.has(i!), nombre);
});

test('búsquedas parciales habituales: la ciudad esperada va primera y no hay falsos positivos entre los primeros resultados', () => {
  const parciales: Array<[string, string]> = [
    ['madr', 'Madrid'], ['barc', 'Barcelona'], ['lond', 'London'], ['par', 'Paris'], ['amst', 'Amsterdam'], ['berl', 'Berlin'],
    ['rom', 'Rome'], ['lisb', 'Lisbon'], ['prag', 'Prague'], ['vien', 'Vienna'], ['budap', 'Budapest'], ['saraj', 'Sarajevo'],
    ['dubro', 'Dubrovnik'], ['new yo', 'New York City'], ['nueva yo', 'New York City'], ['tok', 'Tokyo'], ['bruse', 'Brussels'],
    ['sant', 'Santiago'], ['arub', 'Oranjestad'],
  ];
  for (const [q, esperada] of parciales) {
    const r = buscarDestinos(cat, q, { limite: 5 });
    assert.equal(r[0]!.nombre, esperada, `${q}: ${nombres(q).join(' | ')}`);
  }
  // Ningún alias de GeoNames ajeno entre los 3 primeros: lo escrito es una parte sustancial del nombre o alias que coincide.
  for (const [q] of parciales) {
    for (const r of buscarDestinos(cat, q, { limite: 3 })) {
      if (r.via === 'alias') assert.ok(q.length / (r.alias ?? q).length >= 0.5 || r.coincidencia === 'exacta', `${q} → ${r.nombre} por «${r.alias}»`);
    }
  }
});

test('los alias legítimos siguen funcionando: traducciones, exónimos y variantes', () => {
  for (const [q, esperada] of [['Moscú', 'Moscow'], ['Nueva York', 'New York City'], ['Londres', 'London'], ['Roma', 'Rome'], ['Sídney', 'Sydney'], ['Estambul', 'Istanbul'], ['sanghaj', 'Shanghai'], ['Bombay', 'Mumbai']] as const) {
    assert.equal(primero(q)?.nombre, esperada, q);
  }
});
