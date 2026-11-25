// Correcciones deliberadas de asociación (pines y entradas a retirar) y base estable del catálogo real (v2 reclasificado a v3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { resolverDestino } from '../src/geo/resolver.ts';
import { accesoAereoDeCiudad } from '../src/geo/aeropuertos.ts';
import { asociarCuradas } from '../src/geo/construir.ts';
import { aFormatoV2, clasificarIndice } from '../src/geo/clasificar.ts';
import { construidoDePrueba } from './geo-fixture.ts';
import type { Pais, Region } from '../src/geo/tipos.ts';

const ciudades = [
  { id: '4509884', pais: 'US', poblacion: 135512, nombres: ['Dayton', 'Venice'] },
  { id: '3164603', pais: 'IT', poblacion: 51298, nombres: ['Venice', 'Venecia', 'Venetia'] },
];
const grupos = [{ consulta: 'Venice', nombres: ['venecia', 'venice', 'venezia'] }];

test('sin pin gana la ciudad más poblada que lleva el nombre (comportamiento histórico); con pin gana la indicada', () => {
  assert.equal(asociarCuradas(ciudades, grupos).preferidos['venecia']?.id, 'gn:4509884');
  const r = asociarCuradas(ciudades, grupos, { venice: 'gn:3164603' });
  assert.deepEqual(r.preferidos['venecia'], { pais: 'IT', id: 'gn:3164603' });
  assert.deepEqual(r.preferidos['venezia'], { pais: 'IT', id: 'gn:3164603' });
  assert.deepEqual(r.extraPorCiudad.get('3164603'), ['venice', 'venecia', 'venice', 'venezia']);
  assert.equal(r.extraPorCiudad.has('4509884'), false);
});

test('un pin a una ciudad inexistente falla de forma explícita', () => {
  assert.throws(() => asociarCuradas(ciudades, grupos, { venice: 'gn:999' }), /ciudad inexistente/);
});

test('retirar elimina solo la entrada indicada y falla si no existe', () => {
  const c = construidoDePrueba();
  const ctx = (retirar: Array<{ clave: string; ciudad: string }>) => ({ ciudades: new Map(), paises: [] as Pais[], nombresPaisCurados: {}, regiones: [] as Region[], curadas: [], correcciones: { pines: {}, retirar } });
  const v2 = aFormatoV2(c.indice);
  const clave = Object.keys(v2.nombres).find((k) => v2.nombres[k]!.filter((e) => e[0] === 'c').length >= 2)!;
  const [a, b] = v2.nombres[clave]!.filter((e) => e[0] === 'c');
  const { indice } = clasificarIndice(v2, { ...ctx([{ clave, ciudad: a![1] }]), ciudades: new Map(), });
  assert.ok(!indice.nombres[clave]!.some((e) => e[1] === a![1]));
  assert.ok(indice.nombres[clave]!.some((e) => e[1] === b![1]));
  assert.throws(() => clasificarIndice(v2, ctx([{ clave, ciudad: 'gn:0' }])), /no existe/);
  assert.throws(() => clasificarIndice(v2, ctx([{ clave: 'zzzz inexistente', ciudad: 'gn:1' }])), /no existe en el índice/);
});

// ---- catálogo real: base estable (v2) + correcciones controladas
const cat = new Catalogo(fuenteEnDisco());
const f = fuenteEnDisco();

test('base estable: el catálogo real conserva las ciudades del v2 (sin altas ni bajas de GeoNames)', () => {
  const meta = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../src/geo/data/catalogo/meta.json'), 'utf8'));
  assert.equal(meta.formato, 3);
  assert.equal(meta.ciudades, 172063);
  assert.equal(meta.aeropuertos, 3145);
  assert.ok(f.ficha('gn:4509884')); // Dayton sigue ahí
});

test('Innsbruck conserva su población, su aeropuerto INN y sus nombres alternativos del v2', () => {
  const c = f.ficha('gn:2775220')!;
  assert.equal(c.nombre, 'Innsbruck');
  assert.equal(c.poblacion, 132493);
  assert.deepEqual(c.aeropuertos, ['INN']);
  assert.equal(f.aeropuertos()['INN']!.ciudadId, 'gn:2775220');
  const r = resolverDestino(cat, 'Innsbruck');
  assert.equal(r.estado, 'reconocido');
  if (r.estado === 'reconocido') {
    assert.equal(r.identidad.id, 'gn:2775220');
    const acc = accesoAereoDeCiudad(cat, { ...r.identidad, tipo: 'ciudad' } as never);
    assert.deepEqual(acc.propios.map((a) => a.iata), ['INN']);
    assert.deepEqual(acc.acceso, []);
  }
  assert.ok(buscarDestinos(cat, 'инсбрук').some((x) => x.id === 'gn:2775220'), 'alias en cirílico conservado');
  assert.equal(buscarDestinos(cat, 'innsbruck')[0]?.id, 'gn:2775220');
  assert.equal(buscarDestinos(cat, 'inn')[0]?.id, 'gn:2775220', 'INN: ciudad primero');
  assert.ok(buscarDestinos(cat, 'inn').some((x) => x.tipo === 'aeropuerto' && x.id === 'iata:INN'));
});

test('Venice/Venecia/Venezia y Porto/Oporto: correcciones controladas', () => {
  for (const q of ['Venecia', 'venice', 'Venezia']) {
    const r = resolverDestino(cat, q);
    assert.equal(r.estado === 'reconocido' && r.identidad.id, 'gn:3164603', q);
  }
  for (const q of ['Oporto', 'Porto']) {
    const r = resolverDestino(cat, q);
    assert.equal(r.estado === 'reconocido' && r.identidad.id, 'gn:2735943', q);
  }
  assert.equal(buscarDestinos(cat, 'venecia')[0]?.id, 'gn:3164603');
  assert.ok(!buscarDestinos(cat, 'venecia', { limite: 12 }).some((x) => x.id === 'gn:4509884'), 'Dayton ya no es Venecia');
  assert.ok(!buscarDestinos(cat, 'oporto', { limite: 12 }).some((x) => x.id === 'gn:3031582'), 'Burdeos ya no es Oporto');
  // Lo que NO se retira: alias reales de GeoNames (Dayton «venice», Burdeos «porto») siguen siendo buscables.
  assert.ok(buscarDestinos(cat, 'venice', { limite: 12 }).some((x) => x.id === 'gn:4509884') || f.entradas('venice').some((e) => e[1] === 'gn:4509884'));
  assert.ok(f.entradas('porto').some((e) => e[1] === 'gn:3031582'));
  assert.ok(f.entradas('venetia').some((e) => e[1] === 'gn:3164603'), 'alias de Venecia conservado');
});

test('exónimos añadidos: asociaciones comprobadas y el país explícito sigue deshaciendo la ambigüedad', () => {
  const id = (q: string, pais?: string) => { const r = resolverDestino(cat, q, pais ? { pais } : {}); return r.estado === 'reconocido' ? r.identidad.id : r.estado; };
  for (const [q, esperado] of [['Seúl', 'gn:1835848'], ['Pekín', 'gn:1816670'], ['El Cairo', 'gn:360630'], ['Brujas', 'gn:2800931'], ['Gante', 'gn:2797656']] as const) assert.equal(id(q), esperado, q);
  assert.equal(id('Bruges', 'FR'), 'gn:3029799');
  assert.equal(id('El Cairo', 'CO'), 'gn:3684785');
  assert.equal(id('Pekin', 'US'), 'aclaracion');
});
