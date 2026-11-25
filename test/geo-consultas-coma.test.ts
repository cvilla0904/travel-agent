// Autocompletado con comas: «Salento, Italia», «Salento, Quindío», «Cartagena, España». Catálogo real, sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { buscarDestinos } from '../src/geo/buscar.js';
import { REGIONES_EDITORIALES } from '../src/geo/regiones-editoriales.js';
import { CIUDADES_EQUIVALENTES } from '../src/services/ciudades.js';
import handler from '../api/geo.js';

const cat = new Catalogo(fuenteEnDisco());
const SALENTO_CO = 'gn:3670352', SALENTO_IT = 'gn:3168676', SALENTO_AP = 'ed:salento-apulia', CARTAGENA_CO = 'gn:3687238', CARTAGENA_ES = 'gn:2520058';
const ids = (q: string, limite = 5) => buscarDestinos(cat, q, { limite }).map((r) => r.id);

test('el país tras la coma acota la búsqueda', () => {
  assert.deepEqual(ids('Salento, Italia'), [SALENTO_AP, SALENTO_IT], 'Salento de Apulia (editorial) y municipio de Campania');
  assert.deepEqual(ids('Salento, Italy'), [SALENTO_AP, SALENTO_IT]);
  assert.deepEqual(ids('Salento, Colombia'), [SALENTO_CO]);
  assert.deepEqual(ids('Cartagena, España').slice(0, 1), [CARTAGENA_ES]);
  assert.ok(!ids('Cartagena, España').includes(CARTAGENA_CO));
  assert.deepEqual(ids('cartagena, es').slice(0, 1), [CARTAGENA_ES], 'código ISO de dos letras');
  assert.deepEqual(ids('Cartagena, Colombia').slice(0, 1), [CARTAGENA_CO]);
});

test('el país se reconoce mientras se escribe («Salento, ita», «Salento, Col»)', () => {
  assert.deepEqual(ids('Salento, ita'), [SALENTO_AP, SALENTO_IT]);
  assert.deepEqual(ids('Salento, Col'), [SALENTO_CO]);
});

test('la región escrita prioriza a la ciudad que la declara, sin excluir a las demás', () => {
  assert.equal(ids('Salento, Quindío')[0], SALENTO_CO);
  assert.ok(ids('Salento, Quindío').includes(SALENTO_IT), 'Italia sigue disponible');
  assert.deepEqual(ids('Salento, Quindío, Colombia'), [SALENTO_CO]);
  assert.equal(ids('Cartagena, Murcia')[0], CARTAGENA_ES);
  assert.equal(ids('Cartagena, Murcia, España')[0], CARTAGENA_ES);
});

test('una ciudad como calificador sugiere su país: «Salento, Lecce» → Italia primero; con país explícito, solo Italia', () => {
  assert.equal(ids('Salento, Lecce')[0], SALENTO_AP, 'Lecce es Apulia; Campania queda como alternativa');
  assert.equal(ids('Salento, Lecce')[1], SALENTO_IT);
  assert.deepEqual(ids('Salento, Lecce, Italia'), [SALENTO_AP, SALENTO_IT]);
});

test('calificador desconocido: no deja sin resultados ni cambia el orden de la consulta simple', () => {
  assert.deepEqual(ids('Cartagena, zzzz'), ids('Cartagena'));
  assert.deepEqual(ids('Salento,'), ids('Salento'));
  assert.deepEqual(buscarDestinos(cat, 'a, Italia'), [], 'primer tramo demasiado corto');
});

test('el resultado incluye la región cuando se conoce', () => {
  const r = buscarDestinos(cat, 'Salento', { limite: 5 });
  assert.equal(r.find((x) => x.id === SALENTO_CO)?.region, 'Quindío');
  assert.equal(r.find((x) => x.id === SALENTO_IT)?.region, 'Campania', 'el municipio italiano se distingue del de Lecce y del de Quindío');
  assert.equal(buscarDestinos(cat, 'Madrid')[0]!.region, undefined);
});

test('la región editorial y la tabla curada coinciden (una sola verdad para Salento)', () => {
  const salento = CIUDADES_EQUIVALENTES.find((g) => g.consulta === 'Salento')!;
  assert.equal(salento.region, REGIONES_EDITORIALES[SALENTO_CO]!.nombre);
  for (const c of salento.regiones!) assert.ok(REGIONES_EDITORIALES[SALENTO_CO]!.claves.includes(c), c);
});

test('/api/geo acepta consultas con coma y devuelve la región', () => {
  const res: any = { statusCode: 200, headers: {}, body: undefined, setHeader(n: string, v: string) { this.headers[n] = v; return this; }, status(c: number) { this.statusCode = c; return this; }, json(d: unknown) { this.body = d; return this; } };
  handler({ method: 'GET', query: { q: 'Salento, Italia', limite: '5' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.resultados.map((r: any) => r.id), [SALENTO_AP, SALENTO_IT]);
  const res2: any = { ...res, body: undefined };
  handler({ method: 'GET', query: { q: 'Salento, Quindío', limite: '5' } }, res2);
  assert.equal(res2.body.resultados[0].region, 'Quindío');
});
