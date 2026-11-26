// Modo de búsqueda (complete | flights | hotels | activities): validación, resolución entre turnos, herramientas e
// instrucciones por modo. Lógica pura, sin SDK, sin red ni créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERRAMIENTAS_POR_MODO, MODOS_BUSQUEDA, claveModoSesion, esModoBusqueda, instruccionesDeModo, resolverModo, validarModo,
} from '../src/services/modo-busqueda.ts';

test('los cuatro modos son los que envía la portada', () => {
  assert.deepEqual([...MODOS_BUSQUEDA], ['complete', 'flights', 'hotels', 'activities']);
});

test('validarModo: acepta los cuatro, trata la ausencia como «no indicado» y rechaza cualquier otro valor', () => {
  for (const m of MODOS_BUSQUEDA) assert.deepEqual(validarModo(m), { ok: true, modo: m });
  assert.deepEqual(validarModo(undefined), { ok: true, modo: null });
  assert.deepEqual(validarModo(null), { ok: true, modo: null });
  for (const malo of ['', 'Activities', 'actividades', 'all', 'complete ', 7, {}, [], true]) {
    const r = validarModo(malo);
    assert.equal(r.ok, false, `debe rechazar ${JSON.stringify(malo)}`);
    if (!r.ok) { assert.equal(r.status, 400); assert.match(r.error, /Modo de búsqueda no válido/); }
  }
  assert.equal(esModoBusqueda('hotels'), true);
  assert.equal(esModoBusqueda('hoteles'), false);
});

test('resolverModo: el modo enviado manda; si no se envía se conserva el de la sesión; sin ninguno, complete', () => {
  assert.equal(resolverModo('activities', undefined), 'activities');
  assert.equal(resolverModo('flights', 'hotels'), 'flights', 'el modo enviado prevalece sobre el guardado');
  assert.equal(resolverModo(null, 'activities'), 'activities', 'seguimiento sin modo: se mantiene el de la sesión');
  assert.equal(resolverModo(null, null), 'complete');
  assert.equal(resolverModo(null, 'valor-corrupto'), 'complete', 'un valor guardado no válido no se usa');
});

test('cada sesión guarda su modo con una clave propia', () => {
  assert.equal(claveModoSesion('abc'), 'chat:modo:abc');
  assert.notEqual(claveModoSesion('a'), claveModoSesion('b'));
});

test('herramientas por modo: cada modo exclusivo solo dispone de la de su categoría; complete no cambia', () => {
  assert.deepEqual(HERRAMIENTAS_POR_MODO.activities, ['activities_agent']);
  assert.deepEqual(HERRAMIENTAS_POR_MODO.hotels, ['hotel_agent']);
  assert.deepEqual(HERRAMIENTAS_POR_MODO.flights, ['flight_agent']);
  assert.equal(HERRAMIENTAS_POR_MODO.complete, null, 'complete conserva todas las herramientas');
});

test('instrucciones: complete no añade nada; los exclusivos prohíben las otras categorías', () => {
  assert.equal(instruccionesDeModo('complete'), '');
  const act = instruccionesDeModo('activities');
  assert.match(act, /SOLO ACTIVIDADES/);
  assert.match(act, /NO pidas fechas, ciudad de origen/);
  assert.match(act, /NO busques vuelos ni alojamiento/);
  const hot = instruccionesDeModo('hotels');
  assert.match(hot, /SOLO HOTELES/);
  assert.match(hot, /NO pidas ciudad de origen/);
  assert.match(hot, /NO busques vuelos ni actividades/);
  const vue = instruccionesDeModo('flights');
  assert.match(vue, /SOLO VUELOS/);
  assert.match(vue, /origen, destino, fecha de ida, fecha de vuelta y número de pasajeros/);
  assert.match(vue, /NO busques hoteles ni actividades/);
});
