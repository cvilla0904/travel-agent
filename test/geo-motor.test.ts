// Motor geográfico: construcción, resolución, aeropuertos, selección por país, estados y respaldo.
// TODOS los datos son de prueba (test/geo-fixture.ts): no se consulta ningún proveedor ni se usa el catálogo real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogoDePrueba, sinDestacados, textoAeropuertos } from './geo-fixture.ts';
import { aeropuertosComerciales, asociarAeropuertos, parsearCsv, parsearGeoNames } from '../src/geo/construir.ts';
import { resolverDestino } from '../src/geo/resolver.ts';
import { accesoAereoDeCiudad, accesoAereoDeRegion } from '../src/geo/aeropuertos.ts';
import { seleccionarCiudadesPais, MAX_CIUDADES_PAIS } from '../src/geo/seleccion-pais.ts';
import { clasificarBusqueda } from '../src/geo/estados.ts';
import { resolverConGeoapify } from '../src/geo/respaldo-geoapify.ts';
import { Catalogo, CatalogoNoDisponible, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { normalizar } from '../src/geo/normalizar.ts';

const cat = catalogoDePrueba();
const id = (t: string, o: Parameters<typeof resolverDestino>[2] = {}) => {
  const r = resolverDestino(cat, t, o);
  return r.estado === 'reconocido' ? r.identidad : r;
};

test('parsers: CSV con comas entrecomilladas y solo aeropuertos comerciales válidos', () => {
  const filas = parsearCsv(textoAeropuertos());
  assert.ok(filas.length > 20);
  const comerciales = aeropuertosComerciales(filas).map((a) => a.iata);
  assert.ok(comerciales.includes('BOG') && comerciales.includes('FLR'));
  assert.ok(!comerciales.includes('XXS'), 'aeródromo pequeño excluido');
  assert.ok(!comerciales.includes('XXN'), 'sin servicio regular excluido');
  assert.deepEqual(parsearCsv('a,b\n"x, y",2\n'), [{ a: 'x, y', b: '2' }]);
  assert.equal(parsearGeoNames('basura\n\n1\tA\tA\t\t1\t1\tP\tPPL\tES\t\t00\t\t\t\t5000').length, 1);
});

test('asociación aeropuerto→ciudad: Medellín (no Rionegro) y Tokio (no Narita)', () => {
  const r = cat.shard('CO')!;
  assert.deepEqual(r.ciudades['gn:3674962']!.aeropuertos, ['MDE']);
  assert.deepEqual(r.ciudades['gn:3672647']!.aeropuertos, []);
  assert.deepEqual(cat.shard('JP')!.ciudades['gn:1850147']!.aeropuertos.sort(), ['HND', 'NRT']);
  const { sinCiudad } = asociarAeropuertos(parsearGeoNames('1\tA\tA\t\t0\t0\tP\tPPL\tES\t\t00\t\t\t\t9000'), [{ iata: 'ZZZ', nombre: 'Lejos', pais: 'ES', lat: 40, lon: 40, tipo: 'large', municipio: '' }]);
  assert.deepEqual(sinCiudad, ['ZZZ'], 'un aeropuerto sin ciudad cercana no se asocia a ninguna');
});

test('resolución: nombres en español, inglés y locales apuntan a la misma identidad estable', () => {
  const bru = ['Bruselas', 'Brussels', 'Bruxelles', 'BRUSELAS'].map((t) => (id(t) as any).id);
  assert.deepEqual([...new Set(bru)], ['gn:2800866']);
  assert.notEqual((id('Amberes') as any).id, 'gn:2800866', 'Amberes nunca se confunde con Bruselas');
  assert.equal((id('Tokio') as any).id, (id('Tokyo') as any).id);
  assert.equal((id('Kioto') as any).nombre, 'Kyoto');
  assert.equal((id('Bogota') as any).id, (id('Bogotá') as any).id);
  assert.equal((id('Calcuta') as any).nombre, 'Kolkata');
  for (const t of ['Sarajevo', 'Dubrovnik', 'Jaipur']) assert.equal((id(t) as any).tipo, 'ciudad', t);
});

test('resolución: distingue país, región, ciudad y aeropuerto', () => {
  assert.equal((id('Colombia') as any).tipo, 'pais');
  assert.equal((id('Japón') as any).tipo, 'pais');
  assert.equal((id('India') as any).pais, 'IN');
  assert.equal((id('Toscana') as any).tipo, 'region');
  assert.equal((id('Tuscany') as any).id, 'region:toscana');
  assert.equal((id('Costa Amalfitana') as any).tipo, 'region');
  assert.equal((id('BOG') as any).tipo, 'aeropuerto');
  assert.equal((id('Madrid') as any).tipo, 'ciudad');
});

test('ambigüedad: se pide aclaración, nunca se elige al azar; la pista de país o la preferencia editorial resuelven', () => {
  const v = id('Valencia') as any;
  assert.equal(v.estado, 'aclaracion');
  assert.deepEqual(v.candidatos.map((c: any) => c.pais).sort(), ['ES', 'VE']);
  assert.equal((id('Valencia, España') as any).pais, 'ES');
  assert.equal((id('Valencia', { pais: 'VE' }) as any).pais, 'VE');
  const s = id('Santiago') as any;
  assert.equal(s.estado, 'aclaracion');
  assert.deepEqual(s.candidatos.map((c: any) => c.pais).sort(), ['CL', 'CU']);
  // «London» existe en Reino Unido y Canadá: la preferencia editorial documentada la resuelve; Londres solo casa con GB.
  assert.equal((id('London') as any).pais, 'GB');
  assert.equal((id('Londres') as any).pais, 'GB');
  const sinPref = resolverDestino(catalogoDePrueba({ destacados: sinDestacados }), 'London');
  assert.equal(sinPref.estado, 'aclaracion', 'sin preferencia editorial, London pide aclaración');
});

test('destino desconocido: no_encontrado, sin inventar nada', () => {
  assert.deepEqual(resolverDestino(cat, 'Ciudad Imaginaria del Norte'), { estado: 'no_encontrado' });
  assert.deepEqual(resolverDestino(cat, ''), { estado: 'no_encontrado' });
  assert.deepEqual(resolverDestino(cat, 'Colombia, Japón'), { estado: 'no_encontrado' });
});

test('aeropuertos: Kioto no tiene propio; se proponen los de acceso con nombre y distancia, sin cambiar el destino', () => {
  const kioto = cat.shard('JP')!.ciudades['gn:1857910']!;
  const a = accesoAereoDeCiudad(cat, kioto);
  assert.equal(a.propios.length, 0);
  assert.deepEqual(a.acceso.map((x) => x.iata), ['ITM', 'KIX', 'NGO']);
  assert.ok(a.acceso.every((x) => x.distanciaKm > 0 && x.nombre), 'con distancia y nombre');
  assert.ok(a.acceso[0]!.distanciaKm < a.acceso[1]!.distanciaKm);
  const osaka = accesoAereoDeCiudad(cat, cat.shard('JP')!.ciudades['gn:1853909']!);
  assert.deepEqual(osaka.propios.map((x) => x.iata).sort(), ['ITM', 'KIX']);
  assert.deepEqual(osaka.acceso, []);
  for (const n of ['Sarajevo', 'Dubrovnik', 'Jaipur', 'Bruselas']) {
    const c = id(n) as any;
    assert.equal(accesoAereoDeCiudad(cat, cat.ciudad(c.id, c.pais)!).propios.length, 1, n);
  }
});

test('regiones: aeropuertos de acceso con distancia y aviso si alguno no está en el catálogo', () => {
  const t = accesoAereoDeRegion(cat, 'region:toscana');
  assert.deepEqual(t.aeropuertos.map((a) => a.iata).sort(), ['FLR', 'PSA']);
  assert.ok(t.aeropuertos.every((a) => a.distanciaKm > 0 && a.esAcceso));
  assert.deepEqual(accesoAereoDeRegion(cat, 'region:costa-amalfitana').aeropuertos.map((a) => a.iata), ['NAP']);
  const alpes = accesoAereoDeRegion(cat, 'region:alpes-suizos');
  assert.deepEqual(alpes.sinCatalogo.sort(), ['GVA', 'ZRH'], 'no se inventan aeropuertos que el catálogo no tiene');
  assert.deepEqual(accesoAereoDeRegion(cat, 'region:no-existe'), { aeropuertos: [], sinCatalogo: [] });
});

test('países: Colombia (5 ciudades, editorial), Japón (Yokohama no, Tokio una sola vez) e India (Jaipur pese a su población)', () => {
  const co = seleccionarCiudadesPais(cat, 'CO');
  assert.deepEqual(co.ciudades.map((c) => c.ciudad.nombre), ['Bogotá', 'Medellín', 'Cartagena', 'Cali', 'Barranquilla']);
  assert.ok(co.ciudades.every((c) => c.motivo === 'editorial' && c.principal.iata));
  assert.deepEqual(co.ciudades.map((c) => c.principal.iata), ['BOG', 'MDE', 'CTG', 'CLO', 'BAQ']);
  assert.ok(!co.ciudades.some((c) => c.ciudad.nombre === 'Santa Marta'), 'el límite de cinco se respeta');
  const jp = seleccionarCiudadesPais(cat, 'JP');
  assert.deepEqual(jp.ciudades.map((c) => c.ciudad.nombre), ['Tokyo', 'Osaka', 'Fukuoka', 'Sapporo', 'Nagoya']);
  assert.deepEqual(jp.ciudades[0]!.aeropuertos.map((a) => a.iata).sort(), ['HND', 'NRT']);
  const inn = seleccionarCiudadesPais(cat, 'IN');
  assert.ok(inn.ciudades.some((c) => c.ciudad.nombre === 'Jaipur' && c.motivo === 'editorial'));
  assert.equal(inn.ciudades.length, 5);
  for (const s of [co, jp, inn]) assert.ok(s.ciudades.length <= MAX_CIUDADES_PAIS);
});

test('países sin lista editorial: puntuación (aeropuerto, población, nº de aeropuertos), no solo población', () => {
  const sd = catalogoDePrueba({ destacados: sinDestacados });
  const co = seleccionarCiudadesPais(sd, 'CO');
  assert.equal(co.ciudades[0]!.ciudad.nombre, 'Bogotá');
  assert.ok(co.ciudades.every((c) => c.motivo === 'puntuacion'));
  assert.ok(!co.ciudades.some((c) => c.ciudad.nombre === 'Rionegro'), 'una ciudad sin aeropuerto asociado no es candidata');
  const it = seleccionarCiudadesPais(sd, 'IT');
  // Florencia (370 mil, aeropuerto mediano) queda por debajo de Roma, Milán y Nápoles, pero Venecia (260 mil, grande) la supera.
  const nombres = it.ciudades.map((c) => c.ciudad.nombre);
  assert.ok(nombres.indexOf('Venice') < nombres.indexOf('Florence'), nombres.join(','));
  assert.deepEqual(seleccionarCiudadesPais(sd, 'ZZ').ciudades, []);
  assert.match(seleccionarCiudadesPais(sd, 'ZZ').avisos[0]!, /No hay datos/);
});

test('país con destacado sin aeropuerto: se avisa y se completa sin inventar', () => {
  const c = catalogoDePrueba({ destacados: { ...sinDestacados, paises: { JP: { ciudades: ['Kioto', 'Tokio'], motivo: 'prueba' } } } });
  const jp = seleccionarCiudadesPais(c, 'JP');
  assert.ok(jp.avisos.some((a) => a.includes('Kioto')));
  assert.equal(jp.ciudades[0]!.ciudad.nombre, 'Tokyo');
  assert.ok(!jp.ciudades.some((x) => x.ciudad.nombre === 'Kyoto'));
});

test('estados: nunca se confunde en curso, incompleto, error, destino no resuelto y sin resultados', () => {
  const e = (o: Parameters<typeof clasificarBusqueda>[0]) => clasificarBusqueda(o).estado;
  assert.equal(e({ consultado: false, resultados: 0 }), 'no_consultado');
  assert.equal(e({ consultado: true, enCurso: true, resultados: 0 }), 'en_curso');
  assert.equal(e({ consultado: true, destinoNoResuelto: true, resultados: 0 }), 'destino_no_resuelto');
  assert.equal(e({ consultado: true, error: 'HTTP 500', resultados: 0 }), 'error_proveedor');
  assert.equal(e({ consultado: true, incompleta: true, resultados: 0 }), 'incompleto');
  assert.equal(e({ consultado: true, resultados: 0 }), 'sin_resultados');
  assert.equal(e({ consultado: true, resultados: 3 }), 'ok');
  assert.equal(e({ consultado: true, resultados: 2, faltaParte: true }), 'parcial');
  assert.equal(e({ consultado: true, resultados: 2, incompleta: true }), 'parcial');
  const d = clasificarBusqueda({ consultado: true, resultados: 0, recibidos: 12 });
  assert.equal(d.estado, 'sin_resultados');
  assert.equal(d.descartadosPorUbicacion, 12);
  assert.match(d.detalle, /12 resultados y todos se descartaron/);
  assert.equal(clasificarBusqueda({ consultado: true, resultados: 7, recibidos: 9 }).descartadosPorUbicacion, 2);
});

test('respaldo Geoapify: errores distintos de «no encontrado», un resultado, varios (aclaración) y caché — con fetch simulado', async () => {
  const f = (features: unknown[], ok = true, status = 200) => (async () => ({ ok, status, json: async () => ({ features }) })) as unknown as typeof fetch;
  const feat = (p: Record<string, unknown>) => ({ properties: p });
  assert.equal((await resolverConGeoapify('Sarajevo', { apiKey: '' })).estado, 'error_geocodificador');
  assert.equal((await resolverConGeoapify('X', { apiKey: 'k', fetchFn: f([], false, 500) })).estado, 'error_geocodificador');
  assert.equal((await resolverConGeoapify('X', { apiKey: 'k', fetchFn: (async () => { throw new Error('red caída'); }) as any })).estado, 'error_geocodificador');
  assert.equal((await resolverConGeoapify('Xyz', { apiKey: 'k', fetchFn: f([]) })).estado, 'no_encontrado');
  const uno = await resolverConGeoapify('Lugar', { apiKey: 'k', fetchFn: f([feat({ result_type: 'city', city: 'Lugar', country_code: 'es', lat: 1, lon: 2, place_id: 'p1' }), feat({ result_type: 'street', lat: 3, lon: 4 })]) });
  assert.equal(uno.estado, 'reconocido');
  assert.equal((uno as any).origen, 'respaldo');
  assert.equal((uno as any).identidad.pais, 'ES');
  const varios = await resolverConGeoapify('Lugar', { apiKey: 'k', fetchFn: f([feat({ result_type: 'city', lat: 1, lon: 2 }), feat({ result_type: 'city', lat: 3, lon: 4 })]) });
  assert.equal(varios.estado, 'aclaracion');
  // Caché: la segunda consulta no llama al servicio; un error no se guarda.
  const almacen = new Map<string, string>(); let llamadas = 0;
  const cache = { get: async (k: string) => almacen.get(k) ?? null, set: async (k: string, v: string) => { almacen.set(k, v); } };
  const contador = (async () => { llamadas++; return { ok: true, status: 200, json: async () => ({ features: [feat({ result_type: 'city', city: 'A', lat: 1, lon: 1 })] }) }; }) as unknown as typeof fetch;
  await resolverConGeoapify('A', { apiKey: 'k', fetchFn: contador, cache }); await resolverConGeoapify('A', { apiKey: 'k', fetchFn: contador, cache });
  assert.equal(llamadas, 1);
  await resolverConGeoapify('B', { apiKey: 'k', fetchFn: f([], false, 500), cache });
  assert.equal(almacen.size, 1, 'los errores no se cachean');
});

test('catálogo real ausente: error explícito, no un resultado vacío', () => {
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-'));
  assert.throws(() => new Catalogo(fuenteEnDisco(vacio)).entradas('madrid'), CatalogoNoDisponible);
});

test('datos editoriales coherentes: IATA de 3 letras, preferidos con país válido, regiones y destacados completos', () => {
  const dir = path.resolve(import.meta.dirname, '../src/geo/data');
  const j = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const curados = j('paises-curados.json'), dest = j('destacados.json'), regiones = j('regiones.json');
  for (const r of regiones) {
    assert.ok(r.aeropuertosAcceso.length > 0 && r.aeropuertosAcceso.every((x: string) => /^[A-Z]{3}$/.test(x)), r.id);
    assert.ok(curados[r.pais], `país de ${r.id}`);
    assert.ok(r.descripcion && r.centro.lat && r.centro.lon);
  }
  for (const [n, iso] of Object.entries(dest.preferidos)) assert.ok(curados[iso as string] && n === normalizar(n), n);
  for (const [iso, d] of Object.entries<any>(dest.paises)) { assert.ok(curados[iso]); assert.ok(d.ciudades.length <= MAX_CIUDADES_PAIS); assert.ok(d.motivo.length > 10); }
});
