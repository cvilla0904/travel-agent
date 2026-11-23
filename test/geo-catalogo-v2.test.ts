// Catálogo v2 (índice por buckets) y autocompletado. Datos de prueba (test/geo-fixture.ts), sin red ni proveedores.
// Cada caso se ejecuta contra el catálogo en memoria y contra el formato empaquetado real leído de disco.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogoDePrueba, catalogoEnDiscoDePrueba, construidoDePrueba } from './geo-fixture.ts';
import { Catalogo, CatalogoNoDisponible, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { escribirCatalogo, prefijoBucket, verificarIntegridad } from '../src/geo/empaquetar.ts';
import { resolverDestino, paisDesdeTexto } from '../src/geo/resolver.ts';
import { crearHandler } from '../api/geo.ts';

const disco = catalogoEnDiscoDePrueba();
test.after(() => disco.limpiar());
const variantes: Array<[string, Catalogo]> = [['memoria', catalogoDePrueba()], ['disco v2', disco.cat]];

const ident = (cat: Catalogo, t: string, o: { pais?: string } = {}) => {
  const r = resolverDestino(cat, t, o);
  return r.estado === 'reconocido' ? r.identidad : r;
};
const nombres = (cat: Catalogo, q: string, o: { pais?: string; limite?: number } = {}) => buscarDestinos(cat, q, o).map((r) => `${r.tipo}:${r.nombre}:${r.codigoPais}`);

for (const [etiqueta, cat] of variantes) {
  test(`[${etiqueta}] Madrid: resolución exacta con su aeropuerto`, () => {
    const m = ident(cat, 'Madrid') as any;
    assert.equal(m.tipo, 'ciudad'); assert.equal(m.pais, 'ES'); assert.deepEqual(m.aeropuertos, ['MAD']);
  });

  test(`[${etiqueta}] prefijo «mad»: Madrid y el aeropuerto MAD, con coincidencia exacta/prefijo`, () => {
    const r = buscarDestinos(cat, 'mad');
    assert.ok(r.some((x) => x.tipo === 'ciudad' && x.nombre === 'Madrid' && x.coincidencia === 'prefijo'));
    const a = r.find((x) => x.tipo === 'aeropuerto')!;
    assert.equal(a.coincidencia, 'exacta'); assert.deepEqual(a.aeropuertos, ['MAD']);
    assert.equal(r[0]!.coincidencia, 'exacta', 'las exactas van primero');
  });

  test(`[${etiqueta}] San Sebastián con y sin acento; dos ciudades distintas → aclaración, o filtro por país`, () => {
    for (const t of ['San Sebastián', 'san sebastian', 'SAN SEBASTIÁN', 'Donostia']) {
      const r = resolverDestino(cat, t);
      if (t === 'Donostia') { assert.equal((r as any).identidad.pais, 'ES'); continue; }
      assert.equal(r.estado, 'aclaracion', t);
    }
    assert.equal((ident(cat, 'San Sebastián', { pais: 'ES' }) as any).pais, 'ES');
    assert.equal((ident(cat, 'San Sebastián', { pais: 'PR' }) as any).pais, 'PR');
    assert.deepEqual(nombres(cat, 'san seb', { pais: 'PR' }), ['ciudad:San Sebastián:PR']);
  });

  test(`[${etiqueta}] São Paulo: con tilde, sin ella y por prefijo`, () => {
    for (const t of ['São Paulo', 'sao paulo', 'SÃO PAULO']) assert.equal((ident(cat, t) as any).id, 'gn:3448439', t);
    assert.ok(nombres(cat, 'são pa').includes('ciudad:São Paulo:BR'));
    assert.ok(nombres(cat, 'sao').includes('ciudad:São Paulo:BR'));
  });

  test(`[${etiqueta}] Unicode no latino: cirílico y japonés`, () => {
    assert.equal((ident(cat, 'Москва') as any).id, 'gn:524901');
    assert.ok(nombres(cat, 'москв').includes('ciudad:Moscow:RU'));
    assert.equal((ident(cat, '東京') as any).id, 'gn:1850147');
    assert.ok(nombres(cat, '東京').includes('ciudad:Tokyo:JP'));
  });

  test(`[${etiqueta}] países, regiones, aeropuertos e IATA`, () => {
    assert.equal((ident(cat, 'Colombia') as any).tipo, 'pais');
    assert.ok(nombres(cat, 'colom').some((n) => n.startsWith('pais:Colombia')));
    assert.equal(paisDesdeTexto(cat, 'Italia'), 'IT');
    assert.equal(paisDesdeTexto(cat, 'XX'), undefined);
    const region = cat.regiones()[0]!;
    assert.equal((ident(cat, region.nombre) as any).tipo, 'region');
    assert.ok(buscarDestinos(cat, region.nombre.slice(0, 4)).some((r) => r.tipo === 'region' && r.id === region.id));
    const bog = ident(cat, 'BOG') as any;
    assert.equal(bog.tipo, 'aeropuerto'); assert.equal(bog.pais, 'CO');
    assert.equal(cat.aeropuertoPorIata('nrt')!.pais, 'JP');
    const porIata = buscarDestinos(cat, 'nrt').find((r) => r.tipo === 'aeropuerto')!;
    assert.equal(porIata.id, 'iata:NRT'); assert.equal(porIata.codigoPais, 'JP'); assert.ok(porIata.nombrePais && porIata.nombrePais.length > 2);
  });

  test(`[${etiqueta}] ambigüedad, preferencia editorial y filtro por país`, () => {
    assert.equal(resolverDestino(cat, 'Valencia').estado, 'aclaracion');
    assert.equal((ident(cat, 'Valencia', { pais: 'VE' }) as any).pais, 'VE');
    assert.equal((ident(cat, 'Valencia, España') as any).pais === 'ES' || (ident(cat, 'Valencia, Spain') as any).pais === 'ES', true);
    assert.ok(buscarDestinos(cat, 'valencia').length >= 2);
    assert.deepEqual([...new Set(buscarDestinos(cat, 'valencia', { pais: 'ES' }).map((r) => r.codigoPais))], ['ES']);
  });

  test(`[${etiqueta}] sin resultados y límites`, () => {
    assert.deepEqual(buscarDestinos(cat, 'zzzzqx'), []);
    assert.equal(resolverDestino(cat, 'zzzzqx').estado, 'no_encontrado');
    assert.equal(resolverDestino(cat, '').estado, 'no_encontrado');
    assert.ok(buscarDestinos(cat, 'san', { limite: 2 }).length <= 2);
    assert.ok(buscarDestinos(cat, 'san', { limite: 999 }).length <= 12);
  });

  test(`[${etiqueta}] ficha ligera y ciudad completa coinciden; ids inexistentes o mal formados no fallan`, () => {
    const f = cat.ficha('gn:3117735')!;
    const c = cat.ciudad('gn:3117735', 'ES')!;
    assert.deepEqual([f.nombre, f.pais, f.lat, f.lon, f.poblacion, f.aeropuertos], [c.nombre, c.pais, c.lat, c.lon, c.poblacion, c.aeropuertos]);
    assert.equal(cat.ficha('gn:99999999'), undefined);
    assert.equal(cat.ficha('../../etc/passwd'), undefined);
    assert.equal(cat.shard('ZZ'), undefined);
    assert.equal(cat.shard('../x'), undefined);
  });
}

test('formato v2: integridad verificable y detecta archivos alterados', () => {
  assert.deepEqual(verificarIntegridad(disco.dir), []);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-int-'));
  try {
    escribirCatalogo(dir, construidoDePrueba());
    fs.appendFileSync(path.join(dir, 'aeropuertos.json'), ' ');
    assert.match(verificarIntegridad(dir).join(), /aeropuertos\.json: SHA-256 distinto/);
    fs.rmSync(path.join(dir, 'meta.json'));
    assert.deepEqual(verificarIntegridad(dir), ['falta meta.json']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('una consulta de prefijo lee un bucket, no el índice completo', () => {
  const { cat, dir, limpiar } = catalogoEnDiscoDePrueba();
  try {
    const total = fs.statSync(path.join(dir, 'indice.dat')).size;
    const lecturas: number[] = [];
    const original = fs.readSync;
    (fs as any).readSync = (fd: number, buf: Buffer, off: number, len: number, pos: number) => { lecturas.push(len); return (original as any)(fd, buf, off, len, pos); };
    try { assert.ok(buscarDestinos(cat, 'mad').length > 0); } finally { (fs as any).readSync = original; }
    const bytes = lecturas.reduce((a, b) => a + b, 0);
    assert.ok(bytes > 0 && bytes < total / 5, `leídos ${bytes} de ${total} bytes del índice`);
    assert.equal(prefijoBucket('madrid'), 'mad');
    assert.equal(prefijoBucket('東京都'), '東京都');
  } finally { limpiar(); }
});

test('catálogo no generado: error explícito en el motor y 503 en la API (no un resultado vacío)', () => {
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-vacio-'));
  try {
    const cat = new Catalogo(fuenteEnDisco(vacio));
    assert.throws(() => cat.entradas('madrid'), CatalogoNoDisponible);
    assert.throws(() => resolverDestino(cat, 'Madrid'), CatalogoNoDisponible);
    const res = respuesta();
    const silencio = console.error; console.error = () => {};
    try { crearHandler(() => cat)({ method: 'GET', query: { q: 'mad' } }, res); } finally { console.error = silencio; }
    assert.equal(res.statusCode, 503);
    assert.equal((res.body as any).codigo, 'CATALOGO_NO_GENERADO');
    // Una vez generado, el mismo catálogo empieza a funcionar sin reiniciar (el fallo no se cachea).
    escribirCatalogo(vacio, construidoDePrueba());
    assert.equal(resolverDestino(cat, 'Madrid').estado, 'reconocido');
  } finally { fs.rmSync(vacio, { recursive: true, force: true }); }
});

function respuesta() {
  return {
    statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown,
    setHeader(n: string, v: string) { this.headers[n] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    json(d: unknown) { this.body = d; return this; },
  };
}

test('API: forma de la respuesta que consume index.html (id, tipo, nombre, nombrePais, aeropuertos, coincidencia)', () => {
  for (const [, cat] of variantes) {
    const h = crearHandler(() => cat);
    const res = respuesta();
    h({ method: 'GET', query: { q: 'mad', limite: '7' } }, res);
    const b = res.body as any;
    assert.equal(res.statusCode, 200); assert.equal(b.ok, true); assert.equal(b.consulta, 'mad'); assert.equal(b.total, b.resultados.length);
    assert.match(res.headers['Cache-Control']!, /s-maxage=86400/);
    const madrid = b.resultados.find((x: any) => x.nombre === 'Madrid');
    assert.deepEqual(Object.keys(madrid).sort(), ['aeropuertos', 'coincidencia', 'codigoPais', 'id', 'latitud', 'longitud', 'nombre', 'nombrePais', 'tipo'].sort());
    assert.equal(madrid.nombrePais, 'España'); assert.deepEqual(madrid.aeropuertos, ['MAD']);
  }
});

test('API: acentos, no latino, país, IATA, sin resultados y parámetros inválidos', () => {
  const h = crearHandler(() => disco.cat);
  const q = (query: Record<string, unknown>) => { const r = respuesta(); h({ method: 'GET', query }, r); return r; };
  assert.ok((q({ q: 'São' }).body as any).resultados.some((x: any) => x.nombre === 'São Paulo'));
  assert.ok((q({ q: 'Москва' }).body as any).resultados.some((x: any) => x.id === 'gn:524901'));
  assert.deepEqual([...new Set((q({ q: 'san', pais: 'es' }).body as any).resultados.map((x: any) => x.codigoPais))].filter((c) => c !== 'ES'), []);
  assert.equal((q({ q: 'BOG' }).body as any).resultados[0].tipo, 'aeropuerto');
  const vacio = q({ q: 'zzzzqx' });
  assert.equal(vacio.statusCode, 200); assert.equal((vacio.body as any).total, 0);
  assert.equal(q({ q: 'ma' }).statusCode, 400);
  assert.equal(q({ q: ['mad', 'x'] }).statusCode, 400);
  assert.equal((q({ q: 'mad', limite: 'abc' }).body as any).resultados.length > 0, true);
  assert.ok((q({ q: 'san', limite: '1' }).body as any).resultados.length === 1);
  assert.equal((q({ q: 'mad', pais: '../..' }).body as any).pais, null);
});

test('reempaquetar: convierte el catálogo antiguo (indice.json + paises/XX.json) al v2 con el mismo resultado', async () => {
  const { execFileSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-legacy-'));
  try {
    const r = construidoDePrueba();
    // Formato antiguo: sin población en las entradas del índice.
    const antiguo = { v: 1, nombres: Object.fromEntries(Object.entries(r.indice.nombres).map(([k, v]) => [k, v.map((e) => (e[0] === 'c' ? [e[0], e[1], e[2]] : e))])) };
    fs.mkdirSync(path.join(dir, 'paises'));
    fs.writeFileSync(path.join(dir, 'indice.json'), JSON.stringify(antiguo));
    fs.writeFileSync(path.join(dir, 'paises.json'), JSON.stringify(r.paises));
    for (const [iso, s] of Object.entries(r.shards)) fs.writeFileSync(path.join(dir, 'paises', `${iso}.json`), JSON.stringify(s));
    const salida = execFileSync(process.execPath, [...process.execArgv, path.resolve(import.meta.dirname, '../scripts/reempaquetar-catalogo-geo.ts'), dir], { encoding: 'utf8' });
    assert.match(salida, /Reempaquetado: \d+ ciudades/);
    assert.deepEqual(verificarIntegridad(path.join(dir, 'catalogo')), []);
    assert.ok(fs.existsSync(path.join(dir, 'indice.json')), 'no borra el catálogo antiguo');
    const cat = new Catalogo(fuenteEnDisco(path.join(dir, 'catalogo'), path.resolve(import.meta.dirname, '../src/geo/data')));
    const [primero] = buscarDestinos(cat, 'madr');
    assert.equal(primero!.nombre, 'Madrid');
    // La población se recupera de las fichas: la ciudad grande sale antes que la homónima pequeña.
    assert.equal(buscarDestinos(cat, 'london')[0]!.codigoPais, 'GB');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── Hallazgos del catálogo REAL (GeoNames cities1000): nombres perdidos por el límite y consultas CJK de 2 caracteres ──
import { aeropuertosComerciales, asociarCuradas, construirCatalogo, maxNombresCiudad, parsearCountryInfo, parsearCsv, parsearGeoNames } from '../src/geo/construir.ts';
import { fuenteEnMemoria } from '../src/geo/catalogo.ts';
import { consultaValida, longitudMinimaConsulta } from '../src/geo/buscar.ts';
import { normalizar } from '../src/geo/normalizar.ts';
import { textoAeropuertos, textoCountryInfo } from './geo-fixture.ts';

function geoNamesLinea(id: string, nombre: string, ascii: string, alt: string[], lat: number, lon: number, cc: string, pop: number) {
  return [id, nombre, ascii, alt.join(','), lat, lon, 'P', 'PPL', cc, '', '00', '', '', '', pop, '', 100, 'Etc/UTC', '2024-01-01'].join('\t');
}

test('ciudad grande con cientos de nombres: «Bruselas» no se pierde por el límite y resuelve sin preguntar', () => {
  // Réplica del caso real: más nombres de relleno que el límite, antes de los curados (orden arbitrario de GeoNames).
  const relleno = Array.from({ length: 500 }, (_, i) => `Bxl${i}`);
  const texto = [
    geoNamesLinea('2800866', 'Brussels', 'Brussels', [...relleno, 'Bruxelles', 'Bruselas'], 50.85, 4.35, 'BE', 1_100_000),
    geoNamesLinea('9000001', 'Brussels', 'Brussels', [], 44.6, -87.6, 'US', 1200), // homónima pequeña
    geoNamesLinea('9000002', 'Bruselas', 'Bruselas', [], 4.0, -75.0, 'CO', 3000), // «Bruselas» real en otro país
  ].join('\n');
  const base = {
    geonames: parsearGeoNames(texto), paises: parsearCountryInfo(textoCountryInfo()),
    aeropuertos: aeropuertosComerciales(parsearCsv(textoAeropuertos())), regiones: [],
  };
  const grupos = [{ consulta: 'Brussels', nombres: ['brussels', 'bruselas', 'bruxelles', 'brussel'] }];
  const editorial = { regiones: () => [], destacados: () => ({ paises: {}, preferidos: {}, acceso: {} }) };

  // Sin curadas, con el límite antiguo de 20 nombres, «bruselas» se perdería en Bruselas/BE; con curadas, no.
  const con = construirCatalogo({ ...base, ciudadesCuradas: grupos });
  assert.deepEqual(con.curadasSinCiudad, []);
  const cat = new Catalogo(fuenteEnMemoria(con, editorial));
  assert.equal(con.preferidos['bruselas'], 'BE');
  const r = resolverDestino(cat, 'Bruselas');
  assert.equal(r.estado, 'reconocido');
  assert.equal((r as any).identidad.id, 'gn:2800866', 'la ciudad grande, no la homónima de Colombia');
  assert.equal((resolverDestino(cat, 'bruxelles') as any).identidad.pais, 'BE');
  assert.equal((resolverDestino(cat, 'Brussels') as any).identidad.id, 'gn:2800866');
  assert.equal(buscarDestinos(cat, 'brusel')[0]!.id, 'gn:2800866');

  // El editorial (destacados.json) prevalece sobre lo derivado.
  const ed = { ...editorial, destacados: () => ({ paises: {}, preferidos: { bruselas: 'CO' }, acceso: {} }) };
  assert.equal((resolverDestino(new Catalogo(fuenteEnMemoria(con, ed)), 'Bruselas') as any).identidad.pais, 'CO');

  // Sin grupos curados se reproduce el fallo real: el límite recorta «bruselas» de la ciudad belga y, peor aún,
  // «Bruselas» se resuelve a la homónima de Colombia.
  const sin = new Catalogo(fuenteEnMemoria(construirCatalogo(base), editorial));
  assert.equal((resolverDestino(sin, 'Bruselas') as any).identidad.pais, 'CO');
});

test('límite de nombres por tamaño de ciudad y grupos curados sin ciudad se informan', () => {
  assert.equal(maxNombresCiudad(5_000), 20);
  assert.equal(maxNombresCiudad(250_000), 100);
  assert.equal(maxNombresCiudad(8_000_000), 400);
  const r = asociarCuradas([{ id: '1', pais: 'ES', poblacion: 10, nombres: ['Madrid'] }], [{ consulta: 'Madrid', nombres: ['madrid'] }, { consulta: 'Atlantis', nombres: ['atlantida'] }]);
  assert.deepEqual(r.sinCiudad, ['Atlantis']);
  assert.deepEqual(r.preferidos, { madrid: 'ES' });
});

test('consultas de 2 caracteres solo para chino, japonés y coreano', () => {
  assert.equal(longitudMinimaConsulta(normalizar('東京')), 2);
  assert.equal(longitudMinimaConsulta(normalizar('서울')), 2);
  assert.equal(longitudMinimaConsulta(normalizar('とうきょう')), 2);
  assert.equal(longitudMinimaConsulta('ma'), 3);
  assert.equal(longitudMinimaConsulta('мо'), 3);
  assert.equal(consultaValida('東京'), true);
  assert.equal(consultaValida('東'), false);
  assert.equal(consultaValida('ma'), false);
  assert.equal(consultaValida('x'.repeat(101)), false);
  const h = crearHandler(() => disco.cat);
  const r = respuesta(); h({ method: 'GET', query: { q: '東京' } }, r);
  assert.equal(r.statusCode, 200, 'ya no es un 400');
  assert.ok((r.body as any).resultados.some((x: any) => x.id === 'gn:1850147'));
  const corta = respuesta(); h({ method: 'GET', query: { q: 'ab' } }, corta);
  assert.equal(corta.statusCode, 400);
});
