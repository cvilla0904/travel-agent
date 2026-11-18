import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// public/estado-busqueda.js es un script clásico: se evalúa en un contexto aislado con un almacén inyectado.
const codigo = fs.readFileSync(new URL('../public/estado-busqueda.js', import.meta.url), 'utf8');
function cargar() {
  const ctx: any = { window: undefined };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx.MogavelEstado;
}
function almacenMemoria() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, _m: m };
}
const DATOS = { sessionId: 'sesion-1', mensaje: 'Quiero viajar de Madrid a Roma', modo: 'complete', formulario: { origen: 'Madrid', destino: 'Roma' } };

test('estado: iniciar guarda la búsqueda como pendiente con sessionId, mensaje y formulario', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  assert.equal(E.iniciar(DATOS), true);
  const s = E.leer();
  assert.equal(s.estado, 'pendiente');
  assert.equal(s.sessionId, 'sesion-1');
  assert.equal(s.mensaje, DATOS.mensaje);
  assert.deepEqual(JSON.parse(JSON.stringify(s.formulario)), DATOS.formulario); // JSON: evita comparar prototipos de otro contexto vm
  assert.equal(s.respuestas.length, 0);
});

test('estado: iniciar rechaza datos incompletos y no guarda nada', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  assert.equal(E.iniciar({ ...DATOS, sessionId: '' }), false);
  assert.equal(E.iniciar({ ...DATOS, mensaje: '' }), false);
  assert.equal(E.iniciar(null), false);
  assert.equal(E.leer(), null);
});

test('estado: pendiente → en_curso → completa conserva las respuestas y el sessionId', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  E.iniciar(DATOS);
  assert.equal(E.marcarEnCurso(), true);
  assert.equal(E.leer().estado, 'en_curso');
  E.agregarRespuesta('### Vuelos\n...');
  E.agregarRespuesta('### Presupuesto\n...');
  const s = E.leer();
  assert.equal(s.estado, 'completa');
  assert.equal(s.respuestas.length, 2);
  assert.equal(s.sessionId, 'sesion-1');
});

test('estado: un error sin respuestas queda como error; con respuestas previas no pierde la búsqueda', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  E.iniciar(DATOS); E.marcarError('boom');
  assert.equal(E.leer().estado, 'error');
  assert.equal(E.leer().error, 'boom');
  E.iniciar(DATOS); E.agregarRespuesta('x'); E.marcarError('fallo posterior');
  assert.equal(E.leer().estado, 'completa');
  assert.equal(E.leer().respuestas.length, 1);
});

test('estado: JSON corrupto o versión distinta se ignora', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  a.setItem(E.CLAVE, '{no es json');
  assert.equal(E.leer(), null);
  a.setItem(E.CLAVE, JSON.stringify({ v: 2, sessionId: 'x', respuestas: [] }));
  assert.equal(E.leer(), null);
});

test('estado: almacenamiento que lanza o que no persiste => iniciar devuelve false (la portada usa el flujo antiguo)', () => {
  const E1 = cargar().crear({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => {} });
  assert.equal(E1.iniciar(DATOS), false);
  const E2 = cargar().crear({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  assert.equal(E2.iniciar(DATOS), false);
  const E3 = cargar().crear(null);
  assert.equal(E3.iniciar(DATOS), false);
  assert.equal(E3.leer(), null);
});

test('estado: se limita el histórico de respuestas y limpiar borra la búsqueda', () => {
  const a = almacenMemoria(); const E = cargar().crear(a);
  E.iniciar(DATOS);
  for (let i = 0; i < 40; i++) E.agregarRespuesta('r' + i);
  assert.equal(E.leer().respuestas.length, 30);
  assert.equal(E.leer().respuestas.at(-1), 'r39');
  E.limpiar();
  assert.equal(E.leer(), null);
});
