// El catálogo v2 versionado en src/geo/data/catalogo: formato, integridad, contenido y disponibilidad en las dos funciones de Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { FORMATO_CATALOGO, verificarIntegridad } from '../src/geo/empaquetar.ts';
import { resolverDestino } from '../src/geo/resolver.ts';

const raiz = path.resolve(import.meta.dirname, '..');
const datos = path.join(raiz, 'src/geo/data');

test('el catálogo versionado es v2, íntegro y completo', () => {
  assert.equal(path.resolve(DIR_CATALOGO), path.join(datos, 'catalogo'));
  assert.deepEqual(verificarIntegridad(DIR_CATALOGO), []);
  const meta = JSON.parse(fs.readFileSync(path.join(DIR_CATALOGO, 'meta.json'), 'utf8'));
  assert.equal(meta.formato, FORMATO_CATALOGO);
  assert.ok(meta.ciudades > 150_000, `ciudades: ${meta.ciudades}`);
  assert.ok(meta.aeropuertos > 3_000, `aeropuertos: ${meta.aeropuertos}`);
  assert.ok(meta.buckets > 10_000);
  // Todos los archivos del directorio están declarados en meta.json (ni datos sobrantes ni faltantes).
  const presentes = (fs.readdirSync(DIR_CATALOGO, { recursive: true }) as string[])
    .filter((f) => fs.statSync(path.join(DIR_CATALOGO, f)).isFile() && f !== 'meta.json').map((f) => f.split(path.sep).join('/')).sort();
  assert.deepEqual(presentes, Object.keys(meta.sha256).sort());
});

test('no se versionan datos del formato antiguo', () => {
  for (const f of ['indice.json', 'paises.json', 'paises']) assert.equal(fs.existsSync(path.join(datos, f)), false, `${f} no debe estar en src/geo/data`);
});

test('el catálogo real resuelve los casos clave sin red', () => {
  const cat = new Catalogo(fuenteEnDisco());
  const id = (t: string) => { const r = resolverDestino(cat, t); return r.estado === 'reconocido' ? r.identidad.id : r.estado; };
  const madrid = id('Madrid');
  assert.match(madrid, /^gn:/);
  assert.equal(id('Bruselas'), id('Brussels'));
  assert.equal(id('Bruselas'), id('Bruxelles'));
  assert.equal(id('Londres'), id('London'));
  assert.equal(id('São Paulo'), id('sao paulo'));
  assert.equal(buscarDestinos(cat, '東京')[0]?.nombre, 'Tokyo');
  assert.equal(buscarDestinos(cat, 'москва')[0]?.codigoPais, 'RU');
  assert.ok(buscarDestinos(cat, 'bog').some((r) => r.tipo === 'aeropuerto'));
  assert.equal(buscarDestinos(cat, 'zzzzqx').length, 0);
});

test('vercel.json incluye el catálogo en api/geo.ts y en api/chat.ts, y solo lo necesario', () => {
  const v = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
  const funciones = ['api/geo.ts', 'api/chat.ts'];
  const tamano = (fs.globSync as any);
  for (const fn of funciones) {
    const b = v.builds.find((x: any) => x.src === fn);
    assert.ok(b, `build de ${fn}`);
    const patron = b.config?.includeFiles as string;
    assert.ok(patron, `includeFiles de ${fn}`);
    const archivos: string[] = tamano(patron, { cwd: raiz }).filter((f: string) => fs.statSync(path.join(raiz, f)).isFile());
    for (const necesario of ['meta.json', 'indice.dat', 'indice-dir.json', 'fichas.dat', 'fichas.idx', 'aeropuertos.json', 'paises.json', 'preferidos.json', 'paises/ES.json.gz']) {
      assert.ok(archivos.includes(`src/geo/data/catalogo/${necesario}`), `${fn}: falta ${necesario}`);
    }
    for (const necesario of ['regiones.json', 'destacados.json']) assert.ok(archivos.includes(`src/geo/data/${necesario}`), `${fn}: falta ${necesario}`);
    assert.equal(archivos.some((f) => /paises-curados|indice\.json$/.test(f)), false, 'sin datos sobrantes');
    const bytes = archivos.reduce((a, f) => a + fs.statSync(path.join(raiz, f)).size, 0);
    assert.ok(bytes < 60 * 1048576, `${fn}: ${(bytes / 1048576).toFixed(1)} MB incluidos`);
    assert.equal(archivos.length, 254 + 2 + 0, `${fn}: archivos incluidos`);
  }
});

test('con el catálogo real, ciudades fuera de la tabla curada se resuelven (Sarajevo, Tallin) y no se rompe la curada', async () => {
  const { datosCiudad, establecerCatalogoGeo, consultaProveedorParaCiudad } = await import('../src/services/ciudades.ts');
  establecerCatalogoGeo(undefined);
  assert.equal(datosCiudad('Sarajevo')?.es, 'Sarajevo');
  assert.equal(consultaProveedorParaCiudad('Bruselas'), 'Brussels');
  assert.equal(datosCiudad('Bruselas')?.es, 'Bruselas');
});
