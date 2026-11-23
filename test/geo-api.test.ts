import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/geo.js';

function respuestaFalsa() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(nombre: string, valor: string) { this.headers[nombre] = valor; return this; },
    status(codigo: number) { this.statusCode = codigo; return this; },
    json(datos: unknown) { this.body = datos; return this; },
  };
}

test('API geográfica rechaza métodos distintos de GET', () => {
  const res = respuestaFalsa();
  handler({ method: 'POST', query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});

test('API geográfica exige al menos tres caracteres', () => {
  const res = respuestaFalsa();
  handler({ method: 'GET', query: { q: 'ma' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(String((res.body as { error: string }).error), /3 y 100/);
});

test('API geográfica limita el tamaño de la consulta', () => {
  const res = respuestaFalsa();
  handler({ method: 'GET', query: { q: 'x'.repeat(101) } }, res);
  assert.equal(res.statusCode, 400);
});
