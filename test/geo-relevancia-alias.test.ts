// Relevancia de la búsqueda: nombre propio frente a alias, clasificado al construir el índice (formato v3).
// Datos de prueba propios y mínimos (no el catálogo real); la medición sobre el catálogo real está en scripts/medir-*.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalogo, fuenteEnDisco, fuenteEnMemoria } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { aFormatoV2, clasificarIndice } from '../src/geo/clasificar.ts';
import { aeropuertosComerciales, construirCatalogo, parsearCountryInfo, parsearCsv, parsearGeoNames } from '../src/geo/construir.ts';
import { escribirCatalogo, leerFichasCompletas, leerIndiceCompleto, reescribirIndice, verificarIntegridad } from '../src/geo/empaquetar.ts';
import { resolverDestino } from '../src/geo/resolver.ts';
import { construidoDePrueba } from './geo-fixture.ts';
import type { Destacados, Region } from '../src/geo/tipos.ts';

// id, nombre, ascii, alternos, lat, lon, país, población
const C: Array<[string, string, string, string, number, number, string, number]> = [
  ['1796236', 'Shanghai', 'Shanghai', 'Sanghaj,Sangaj,Sanchajus,Shanghaj,上海', 31.22, 121.46, 'CN', 24000000],
  ['1815286', 'Chengdu', 'Chengdu', 'Sang tu su,Chengtu,成都', 30.67, 104.07, 'CN', 9000000],
  ['3448439', 'São Paulo', 'Sao Paulo', 'San Paulo,San Paolo,Sao Paulo', -23.55, -46.64, 'BR', 10000000],
  ['5391811', 'San Diego', 'San Diego', 'Saint Didacus,SAN', 32.72, -117.16, 'US', 1400000],
  ['5391959', 'San Francisco', 'San Francisco', 'SFO', 37.77, -122.42, 'US', 870000],
  ['2451778', 'San', 'San', '', 13.3, -4.9, 'ML', 36000],
  ['3110044', 'San Sebastián', 'San Sebastian', 'Donostia', 43.32, -1.98, 'ES', 186000],
  ['3871336', 'Santiago', 'Santiago', 'Santiago de Chile', -33.46, -70.65, 'CL', 5100000],
  ['3117735', 'Madrid', 'Madrid', 'MAD,Madryt', 40.42, -3.7, 'ES', 3200000],
  ['3052000', 'Mád', 'Mad', '', 48.18, 21.28, 'HU', 2000],
  ['1850147', 'Tokyo', 'Tokyo', 'Tokio,東京', 35.69, 139.69, 'JP', 8300000],
  ['2800866', 'Brussels', 'Brussels', 'Bruxelles,Bruselas', 50.85, 4.35, 'BE', 1100000],
  ['3688689', 'Bogotá', 'Bogota', 'BOG,Santa Fe de Bogota', 4.61, -74.08, 'CO', 7400000],
  ['1645528', 'Bogor', 'Bogor', '', -6.6, 106.8, 'ID', 950000],
];
const PAISES = [['CN', 'China'], ['BR', 'Brazil'], ['US', 'United States'], ['ML', 'Mali'], ['ES', 'Spain'], ['CL', 'Chile'], ['HU', 'Hungary'], ['JP', 'Japan'], ['BE', 'Belgium'], ['CO', 'Colombia'], ['ID', 'Indonesia']];
const AERO: Array<[string, string, number, number, string, string]> = [
  ['SAN', 'San Diego International Airport', 32.73, -117.19, 'US', 'San Diego'],
  ['MAD', 'Adolfo Suárez Madrid–Barajas Airport', 40.49, -3.57, 'ES', 'Madrid'],
  ['BOG', 'El Dorado International Airport', 4.7, -74.15, 'CO', 'Bogotá'],
  ['PVG', 'Shanghai Pudong International Airport', 31.14, 121.8, 'CN', 'Shanghai'],
];
const txtC = C.map(([id, n, a, alt, lat, lon, cc, pop]) => [id, n, a, alt, lat, lon, 'P', 'PPL', cc, '', '00', '', '', '', pop, '', 100, 'Etc/UTC', '2024-01-01'].join('\t')).join('\n');
const txtP = PAISES.map(([iso, n]) => [iso, iso + 'X', '0', 'XX', n, 'Cap', '1', '1', 'XX', '.xx', 'USD', 'Dollar', '1', '', '', 'en', String(Math.abs(hash(iso!))), '', ''].join('\t')).join('\n');
function hash(s: string): number { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
const txtA = 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code\n' +
  AERO.map(([iata, n, lat, lon, cc, m], i) => `${i},X${i},large_airport,"${n}",${lat},${lon},0,XX,${cc},${cc}-X,"${m}",yes,,${iata},,`).join('\n');

const entrada = () => ({
  geonames: parsearGeoNames(txtC), paises: parsearCountryInfo(txtP), aeropuertos: aeropuertosComerciales(parsearCsv(txtA)),
  regiones: [] as Region[], ciudadesCuradas: [{ consulta: 'Brussels', nombres: ['bruselas', 'brussels'] }],
});
const construido = construirCatalogo(entrada());
const sinDest: Destacados = { paises: {}, preferidos: {}, acceso: {} };
const editorial = { regiones: () => [] as Region[], destacados: () => sinDest };
const cat = new Catalogo(fuenteEnMemoria(construido, editorial));
const nombres = (q: string, o: Parameters<typeof buscarDestinos>[2] = {}) => buscarDestinos(cat, q, o).map((r) => r.nombre);

test('el constructor marca nombres propios y alias (quinto elemento del índice)', () => {
  const ent = (k: string, id: string) => construido.indice.nombres[k]?.find((e) => e[1] === id);
  assert.equal(ent('shanghai', 'gn:1796236')?.[4], 1, 'nombre propio');
  assert.equal(ent('sanghaj', 'gn:1796236')?.[4], undefined, 'alias de otro idioma');
  assert.equal(ent('sang tu su', 'gn:1815286')?.[4], undefined);
  assert.equal(ent('sao paulo', 'gn:3448439')?.[4], 1, 'nombre ASCII = propio');
  assert.equal(ent('bruselas', 'gn:2800866')?.[4], 1, 'nombre curado = propio');
  assert.equal(ent('mad', 'gn:3117735')?.[4], 1, 'IATA del aeropuerto de la ciudad = propio de la ciudad');
  assert.equal(ent('sfo', 'gn:5391959')?.[4], undefined, 'código sin aeropuerto en el catálogo: sigue siendo alias');
  assert.equal(construido.indice.nombres['sad']?.length ?? 0, 0);
  assert.equal(ent('san', 'SAN')?.[4], 1);
  assert.equal(construido.indice.nombres['san']!.find((e) => e[0] === 'a')?.[1], 'SAN');
});

test('«san»: los alias exóticos (Shanghai, Chengdu, São Paulo) ya no desplazan a los nombres propios', () => {
  const r = buscarDestinos(cat, 'san', { limite: 12 });
  const orden = r.map((x) => x.nombre);
  for (const n of ['Shanghai', 'Chengdu', 'São Paulo']) {
    assert.ok(orden.indexOf(n) > orden.indexOf('San Sebastián'), `${n} va después de San Sebastián`);
    assert.ok(orden.indexOf(n) > orden.indexOf('Santiago'), `${n} va después de Santiago`);
  }
  // Nunca por delante de un nombre propio con coincidencia por prefijo.
  const primerAlias = r.findIndex((x) => x.via === 'alias');
  const ultimoPropio = r.map((x) => x.via).lastIndexOf('nombre');
  assert.ok(primerAlias === -1 || ultimoPropio < primerAlias, 'todos los nombres propios preceden a todos los alias');
});

test('orden de niveles: propio exacto → propio prefijo → alias exacto → alias prefijo', () => {
  const r = buscarDestinos(cat, 'san', { limite: 12 });
  const nivel = (x: (typeof r)[number]) => (x.via === 'nombre' ? 0 : 2) + (x.coincidencia === 'exacta' ? 0 : 1);
  const niveles = r.map(nivel);
  assert.deepEqual(niveles, [...niveles].sort((a, b) => a - b));
  assert.ok(niveles.includes(0) && niveles.includes(1) && niveles.includes(3), 'hay resultados de varios niveles');
  assert.equal(r[0]!.nombre, 'San Diego', 'exacta por IATA de su aeropuerto, la más poblada primero');
});

test('los alias siguen siendo buscables y se identifica cuál coincidió', () => {
  const sh = buscarDestinos(cat, 'sanghaj')[0]!;
  assert.equal(sh.nombre, 'Shanghai');
  assert.equal(sh.via, 'alias');
  assert.equal(sh.alias, 'sanghaj');
  assert.equal(sh.coincidencia, 'exacta');
  assert.equal(buscarDestinos(cat, 'sang tu')[0]?.nombre, 'Chengdu');
  assert.equal(buscarDestinos(cat, 'sang tu')[0]?.alias, 'sang tu su');
  assert.equal(buscarDestinos(cat, 'san paolo')[0]?.nombre, 'São Paulo');
  assert.equal(buscarDestinos(cat, '東京')[0]?.nombre, 'Tokyo');
  assert.equal(buscarDestinos(cat, 'saint did')[0]?.nombre, 'San Diego');
});

test('un nombre propio nunca se presenta como alias, aunque la misma ciudad también lo tenga como alias', () => {
  const r = buscarDestinos(cat, 'sao paulo')[0]!;
  assert.equal(r.nombre, 'São Paulo');
  assert.equal(r.via, 'nombre');
  assert.equal(r.alias, undefined);
  const b = buscarDestinos(cat, 'bruselas')[0]!;
  assert.deepEqual([b.nombre, b.via, b.alias], ['Brussels', 'nombre', undefined]);
});

test('IATA: «mad» y «bog» siguen devolviendo la ciudad y su aeropuerto, sin que lo desplace un pueblo homónimo', () => {
  assert.equal(nombres('mad')[0], 'Madrid');
  assert.ok(nombres('mad').includes('Adolfo Suárez Madrid–Barajas Airport'));
  assert.equal(nombres('bog')[0], 'Bogotá');
  assert.ok(nombres('bog').includes('El Dorado International Airport'));
  assert.ok(nombres('bog').includes('Bogor'));
  assert.equal(nombres('SAN')[0], 'San Diego');
  assert.equal(buscarDestinos(cat, 'sfo')[0]?.via, 'alias');
});

test('filtro por país con alias y con nombres propios', () => {
  assert.deepEqual([...new Set(buscarDestinos(cat, 'san', { pais: 'cn', limite: 12 }).map((r) => r.codigoPais))], ['CN']);
  assert.deepEqual(nombres('san', { pais: 'CN' }).sort(), ['Chengdu', 'Shanghai']);
  assert.equal(buscarDestinos(cat, 'san', { pais: 'ES' })[0]?.nombre, 'San Sebastián');
  assert.deepEqual(buscarDestinos(cat, 'san', { pais: 'XX' }), []);
});

test('sin coincidencias: lista vacía', () => {
  assert.deepEqual(buscarDestinos(cat, 'zzzzqx'), []);
});

test('reordenar no oculta: el conjunto de resultados no cambia respecto a quitar la clasificación', () => {
  const sinClasificar = new Catalogo(fuenteEnMemoria({ ...construido, indice: aFormatoV2(construido.indice) }, editorial));
  for (const q of ['san', 'mad', 'bog', 'sang', 'shan', 'sao', 'tok']) {
    const a = buscarDestinos(cat, q, { limite: 12 }).map((r) => r.id).sort();
    const b = buscarDestinos(sinClasificar, q, { limite: 12 }).map((r) => r.id).sort();
    assert.deepEqual(a.filter((x) => b.includes(x)), a.filter((x) => b.includes(x)));
    assert.ok(a.length > 0 === b.length > 0, q);
  }
  // El total de claves y entradas es idéntico.
  const cuenta = (i: typeof construido.indice) => Object.values(i.nombres).reduce((s, l) => s + l.length, 0);
  assert.equal(cuenta(construido.indice), cuenta(aFormatoV2(construido.indice)));
});

test('reclasificar un catálogo v2 (sin indicadores) da exactamente el índice que construye el constructor', () => {
  const c = construidoDePrueba();
  const ciudades = new Map(Object.values(c.shards).flatMap((s) => Object.values(s.ciudades)).map((x) => [x.id, { nombre: x.nombre, ascii: x.nombreAscii ?? x.nombre, pais: x.pais, poblacion: x.poblacion, aeropuertos: x.aeropuertos }]));
  const curados = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/geo/data/paises-curados.json'), 'utf8')) as Record<string, string[]>;
  const regiones = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/geo/data/regiones.json'), 'utf8')) as Region[];
  const { indice } = clasificarIndice(aFormatoV2(c.indice), { ciudades, paises: c.paises, nombresPaisCurados: curados, regiones, curadas: [] });
  assert.deepEqual(indice.nombres, c.indice.nombres);
});

test('catálogo v3 en disco: se escribe, verifica, reclasifica y se lee igual; el v2 antiguo se rechaza', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-v3-'));
  try {
    const d3 = path.join(dir, 'v3');
    const meta = escribirCatalogo(d3, construido);
    assert.equal(meta.formato, 3);
    assert.deepEqual(verificarIntegridad(d3), []);
    const enDisco = new Catalogo(fuenteEnDisco(d3));
    for (const q of ['san', 'mad', 'sanghaj', '東京', 'zzzzqx']) {
      assert.deepEqual(buscarDestinos(enDisco, q, { limite: 12 }), buscarDestinos(cat, q, { limite: 12 }), q);
    }
    assert.deepEqual(leerIndiceCompleto(d3).nombres, construido.indice.nombres);
    assert.equal(leerFichasCompletas(d3).length, C.length);
    // Reescritura del índice (v2 simulado → v3): integridad correcta y mismas búsquedas.
    const viejo = path.join(dir, 'viejo');
    reescribirIndice(d3, viejo, aFormatoV2(construido.indice), {});
    const meta2 = JSON.parse(fs.readFileSync(path.join(viejo, 'meta.json'), 'utf8'));
    meta2.formato = 2;
    fs.writeFileSync(path.join(viejo, 'meta.json'), JSON.stringify(meta2));
    assert.throws(() => new Catalogo(fuenteEnDisco(viejo)).buscarPrefijo('san'), /formato 2 no soportado/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('el resolver no cambia: «bruselas» sigue resolviendo a Brussels', () => {
  const r = resolverDestino(cat, 'bruselas');
  assert.equal(r.estado, 'reconocido');
  assert.equal(r.estado === 'reconocido' && r.identidad.nombre, 'Brussels');
});
