// Catálogo SIN Italia: el destino editorial «Salento (Apulia)» no se ofrece, no hay duplicados ni errores.
// El catálogo real se envuelve en un proxy que oculta TODO lo italiano (país, índice y entradas). Sin red ni proveedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { buscarDestinos } from '../src/geo/buscar.js';
import { crearHandler } from '../api/geo.js';
import { DESTINOS_EDITORIALES } from '../src/geo/destinos-editoriales.js';

const real = new Catalogo(fuenteEnDisco());
const sinItalia = new Proxy(real, {
  get(destino: any, prop) {
    const v = destino[prop];
    if (typeof v !== 'function') return v;
    if (prop === 'pais') return (iso: string) => (String(iso).toUpperCase() === 'IT' ? undefined : destino.pais(iso));
    if (prop === 'buscarPrefijo') return (c: string) => destino.buscarPrefijo(c).map(([n, es]: [string, any[]]) => [n, es.filter((e) => e[2] !== 'IT')]).filter(([, es]: [string, any[]]) => es.length);
    if (prop === 'entradas') return (c: string) => destino.entradas(c).filter((e: any) => e[2] !== 'IT');
    return v.bind(destino);
  },
}) as Catalogo;

const CONSULTAS = ['Salento', 'salen', 'Salento, Italia', 'Salento, it', 'Salento, Lecce', 'Salento, Puglia', 'Salento, Apulia', 'Salento, Campania',
  'Salento, Colombia', 'Salento, Quindío', 'Cartagena, Murcia', 'Cartagena', 'Madrid', 'Lecce', 'Roma', 'ita'];

test('el propio proxy funciona: el catálogo simulado no conoce Italia ni nada italiano', () => {
  assert.equal(sinItalia.pais('IT'), undefined);
  assert.ok(real.pais('IT'), 'el real sí la tiene');
  assert.deepEqual(buscarDestinos(sinItalia, 'Lecce'), [], 'Lecce no existe en el catálogo simulado');
  assert.deepEqual(buscarDestinos(sinItalia, 'Roma').filter((r) => r.codigoPais === 'IT'), []);
});

test('sin Italia no se ofrece Salento (Apulia) en ninguna consulta, sin errores ni duplicados', () => {
  for (const q of CONSULTAS) {
    let r: ReturnType<typeof buscarDestinos> = [];
    assert.doesNotThrow(() => { r = buscarDestinos(sinItalia, q, { limite: 12 }); }, q);
    const ids = r.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, `${q}: sin duplicados`);
    for (const d of Object.values(DESTINOS_EDITORIALES)) assert.ok(!ids.includes(d.id), `${q}: no debe ofrecerse ${d.id}`);
    assert.ok(!r.some((x) => x.codigoPais === 'IT'), `${q}: nada italiano`);
    assert.ok(!r.some((x) => x.id.startsWith('ed:')), q);
  }
});

test('sin Italia, «Salento» sigue ofreciendo Quindío y el filtro pais=IT devuelve vacío', () => {
  assert.deepEqual(buscarDestinos(sinItalia, 'Salento').map((r) => r.id), ['gn:3670352']);
  assert.deepEqual(buscarDestinos(sinItalia, 'Salento', { pais: 'IT' }), []);
  assert.deepEqual(buscarDestinos(sinItalia, 'Salento, Quindío').map((r) => [r.id, r.region]), [['gn:3670352', 'Quindío']]);
});

test('sin Italia, /api/geo responde 200 con el mismo contrato y sin el destino editorial', () => {
  const handler = crearHandler(() => sinItalia);
  for (const q of ['Salento', 'Salento, Italia', 'Salento, Lecce']) {
    let cuerpo: any; let codigo = 0;
    const res: any = { setHeader() { return res; }, status(c: number) { codigo = c; return res; }, json(d: unknown) { cuerpo = d; return res; } };
    handler({ method: 'GET', query: { q } }, res);
    assert.equal(codigo, 200, q);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.total, cuerpo.resultados.length);
    assert.ok(!cuerpo.resultados.some((r: any) => r.id.startsWith('ed:')), q);
  }
});

test('control: con el catálogo real (con Italia) el destino editorial sí aparece, una sola vez', () => {
  for (const q of ['Salento', 'Salento, Italia', 'Salento, Lecce']) {
    const ids = buscarDestinos(real, q, { limite: 12 }).map((r) => r.id);
    assert.equal(ids.filter((i) => i === 'ed:salento-apulia').length, 1, q);
  }
});
