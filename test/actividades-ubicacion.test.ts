// Verificación de ubicación de actividades (caso real Bruselas 2026-11-19: 10 registros «Atracciones Paris»).
// Sin red ni proveedores: datos simulados que reproducen la forma del dataset del actor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluarUbicacionActividad, filtrarActividadesDeCiudad, coordenadasActividad, distanciaKm, consultasActividadesParaDestino,
} from '../src/services/actividades-ciudad.ts';
import { datosCiudad } from '../src/services/ciudades.ts';

const URL_BXL = 'https://www.civitatis.com/es/bruselas/visita-guiada-bruselas/';
const reg = (extra: Record<string, unknown>) => ({ title: 'Actividad', url: URL_BXL, platform: 'civitatis', ...extra });
const BRUSELAS = { latitude: 50.8467, longitude: 4.3525 };   // Grand-Place
const PARIS = { latitude: 48.8584, longitude: 2.2945 };      // Torre Eiffel
const MALINAS = { latitude: 51.0259, longitude: 4.4777 };    // ~24 km de Bruselas
const AMBERES = { latitude: 51.2194, longitude: 4.4025 };    // ~41 km de Bruselas

test('Bruselas: etiqueta correcta (en cualquier idioma) y coordenadas coherentes → aceptada por ciudad', () => {
  for (const destino of ['Bruselas', 'Brussels']) {
    const ev = evaluarUbicacionActividad(reg({ city: 'Brussels', ...BRUSELAS }), destino);
    assert.equal(ev.ok, true);
    assert.equal(ev.verificacion, 'ciudad');
    assert.ok(ev.distanciaKm! < 2);
  }
  assert.equal(evaluarUbicacionActividad(reg({ city: 'Atracciones Bruselas' }), 'Bruselas').ok, true, 'prefijo «Atracciones» del proveedor');
});

test('CASO REAL: «Atracciones Paris» con coordenadas de París NO aparece en Bruselas', () => {
  const ev = evaluarUbicacionActividad(reg({ city: 'Atracciones Paris', ...PARIS }), 'Brussels');
  assert.equal(ev.ok, false);
  assert.equal(ev.motivo, 'ciudad_distinta_y_coordenadas_lejos');
  assert.equal(ev.ciudadProveedor, 'Atracciones Paris');
  assert.ok(ev.distanciaKm! > 250);
});

test('«Atracciones Paris» sin coordenadas: se descarta y el motivo dice que no se pudo comprobar', () => {
  const ev = evaluarUbicacionActividad(reg({ city: 'Atracciones Paris' }), 'Brussels');
  assert.deepEqual([ev.ok, ev.motivo], [false, 'ciudad_distinta_sin_coordenadas']);
});

test('etiqueta incorrecta pero coordenadas de Bruselas: se acepta por coordenadas y NO se reescribe la etiqueta', () => {
  const origen = reg({ city: 'Atracciones Paris', title: 'Atomium', ...BRUSELAS });
  const { validas, diagnostico } = filtrarActividadesDeCiudad([origen], 'Brussels');
  assert.equal(validas.length, 1);
  assert.equal(validas[0].city, 'Atracciones Paris', 'el registro original no se modifica');
  assert.deepEqual(
    { v: validas[0]._ubicacion.verificacion, c: validas[0]._ubicacion.ciudadProveedor },
    { v: 'coordenadas', c: 'Atracciones Paris' },
  );
  assert.equal(diagnostico.aceptadasPorCoordenadas, 1);
});

test('etiqueta «Brussels» pero coordenadas de París: incoherente, se descarta', () => {
  const ev = evaluarUbicacionActividad(reg({ city: 'Brussels', ...PARIS }), 'Bruselas');
  assert.deepEqual([ev.ok, ev.motivo], [false, 'coordenadas_contradicen_etiqueta']);
});

test('localidad próxima (Malinas, ~24 km) con etiqueta propia se acepta por coordenadas; Amberes (~41 km) no', () => {
  const cerca = evaluarUbicacionActividad(reg({ city: 'Mechelen', ...MALINAS }), 'Bruselas');
  assert.deepEqual([cerca.ok, cerca.verificacion, cerca.ciudadProveedor], [true, 'coordenadas', 'Mechelen']);
  assert.ok(cerca.distanciaKm! > 15 && cerca.distanciaKm! < 30);
  const lejos = evaluarUbicacionActividad(reg({ city: 'Antwerp', ...AMBERES }), 'Bruselas');
  assert.deepEqual([lejos.ok, lejos.motivo], [false, 'ciudad_distinta_y_coordenadas_lejos']);
});

test('coordenadas insuficientes o inválidas se ignoran (0,0, texto, fuera de rango, una sola)', () => {
  for (const c of [{ latitude: 0, longitude: 0 }, { latitude: 'x', longitude: 'y' }, { latitude: 120, longitude: 4 }, { latitude: 50.8 }, {}]) {
    assert.equal(coordenadasActividad(reg(c)), null);
  }
  assert.deepEqual(coordenadasActividad(reg({ latitude: '50.85', longitude: '4.35' })), { lat: 50.85, lng: 4.35 });
  // Con coordenadas inservibles y etiqueta de otra ciudad, no hay forma de rescatarla.
  const ev = evaluarUbicacionActividad(reg({ city: 'Atracciones Paris', latitude: 0, longitude: 0 }), 'Bruselas');
  assert.equal(ev.ok, false);
});

test('sin ciudad: valen las coordenadas; sin ellas, solo la mención explícita en el título', () => {
  assert.equal(evaluarUbicacionActividad(reg({ ...BRUSELAS }), 'Bruselas').verificacion, 'coordenadas');
  assert.equal(evaluarUbicacionActividad(reg({ ...PARIS }), 'Bruselas').ok, false);
  assert.equal(evaluarUbicacionActividad(reg({ title: 'Tour por Bruselas' }), 'Bruselas').verificacion, 'titulo');
  const nada = evaluarUbicacionActividad(reg({ title: 'Tour genérico' }), 'Bruselas');
  assert.deepEqual([nada.ok, nada.motivo], [false, 'sin_ciudad_ni_mencion']);
});

test('destino fuera de la tabla (p. ej. Sarajevo): no hay centro, así que NO se usan coordenadas y manda la etiqueta', () => {
  assert.equal(datosCiudad('Sarajevo'), null);
  assert.equal(evaluarUbicacionActividad(reg({ city: 'Sarajevo' }), 'Sarajevo').ok, true);
  const otra = evaluarUbicacionActividad(reg({ city: 'Mostar', latitude: 43.34, longitude: 17.81 }), 'Sarajevo');
  assert.deepEqual([otra.ok, otra.motivo], [false, 'ciudad_distinta_sin_coordenadas']);
});

test('el título y la URL no bastan: título + URL válidos con ciudad de otro sitio se descartan siempre', () => {
  const diez = Array.from({ length: 10 }, (_, i) => reg({ title: `Tour ${i}`, city: 'Atracciones Paris', ...PARIS }));
  const { validas, diagnostico } = filtrarActividadesDeCiudad(diez, 'Brussels');
  assert.equal(validas.length, 0);
  assert.equal(diagnostico.descartadasPorCiudad, 10);
  assert.deepEqual(diagnostico.descartesPorMotivo, { ciudad_distinta_y_coordenadas_lejos: 10 });
  assert.deepEqual(diagnostico.ciudadesDescartadas, ['Atracciones Paris']);
});

test('consultas al actor: siempre nombre local + inglés (Civitatis /es/ usa «bruselas»)', () => {
  assert.deepEqual(consultasActividadesParaDestino('Brussels'), ['Brussels', 'Bruselas']);
  assert.deepEqual(consultasActividadesParaDestino('Bruselas'), ['Bruselas', 'Brussels']);
  assert.deepEqual(consultasActividadesParaDestino('Bruxelles'), ['Bruxelles', 'Bruselas', 'Brussels']);
});

test('tabla de centros: Bruselas–París ≈ 264 km (sanidad de la fórmula)', () => {
  const b = datosCiudad('Bruselas')!, p = datosCiudad('París')!;
  const d = distanciaKm(b, p);
  assert.ok(d > 255 && d < 275, String(d));
});
