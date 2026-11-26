// El identificador manda: ciudad, país, región y tipo de un destino con identidad editorial los impone el servidor.
// Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { REGIONES_EDITORIALES } from '../src/geo/regiones-editoriales.js';
import { DESTINOS_EDITORIALES } from '../src/geo/destinos-editoriales.js';
import { etiquetaDestino, normalizarDestinoSeleccionado } from '../src/services/destino-seleccionado.js';
import { codigoPaisDesdeDestino, datosCiudad, regionCurada } from '../src/services/ciudades.js';

const cat = new Catalogo(fuenteEnDisco());

/** Lo que debe salir de cada identificador editorial, sea cual sea el resto de lo que envíe el cliente. */
const CANONICO: Record<string, { nombre: string; pais: string; codigoPais: string; region: string; etiqueta: string }> = {
  'gn:3670352': { nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', region: 'Quindío', etiqueta: 'Salento, Quindío, Colombia' },
  'gn:3168676': { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Campania', etiqueta: 'Salento, Campania, Italia' },
  'gn:3687238': { nombre: 'Cartagena', pais: 'Colombia', codigoPais: 'CO', region: 'Bolívar', etiqueta: 'Cartagena, Bolívar, Colombia' },
  'gn:2520058': { nombre: 'Cartagena', pais: 'España', codigoPais: 'ES', region: 'Región de Murcia', etiqueta: 'Cartagena, Región de Murcia, España' },
  'ed:salento-apulia': { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Apulia', etiqueta: 'Salento, Apulia, Italia' },
  'ed:algarve': { nombre: 'Algarve', pais: 'Portugal', codigoPais: 'PT', region: 'Algarve', etiqueta: 'Algarve, Portugal' },
  'ed:azores': { nombre: 'Azores', pais: 'Portugal', codigoPais: 'PT', region: 'Azores', etiqueta: 'Azores, Portugal' },
  'ed:bali': { nombre: 'Bali', pais: 'Indonesia', codigoPais: 'ID', region: 'Bali', etiqueta: 'Bali, Indonesia' },
  'ed:cerdena': { nombre: 'Cerdeña', pais: 'Italia', codigoPais: 'IT', region: 'Cerdeña', etiqueta: 'Cerdeña, Italia' },
  'ed:corcega': { nombre: 'Córcega', pais: 'Francia', codigoPais: 'FR', region: 'Córcega', etiqueta: 'Córcega, Francia' },
  'ed:creta': { nombre: 'Creta', pais: 'Grecia', codigoPais: 'GR', region: 'Creta', etiqueta: 'Creta, Grecia' },
  'ed:dolomitas': { nombre: 'Dolomitas', pais: 'Italia', codigoPais: 'IT', region: 'Trentino-Alto Adigio', etiqueta: 'Dolomitas, Trentino-Alto Adigio, Italia' },
  'ed:fuerteventura': { nombre: 'Fuerteventura', pais: 'España', codigoPais: 'ES', region: 'Canarias', etiqueta: 'Fuerteventura, Canarias, España' },
  'ed:gran-canaria': { nombre: 'Gran Canaria', pais: 'España', codigoPais: 'ES', region: 'Canarias', etiqueta: 'Gran Canaria, Canarias, España' },
  'ed:isla-de-pascua': { nombre: 'Isla de Pascua', pais: 'Chile', codigoPais: 'CL', region: 'Valparaíso', etiqueta: 'Isla de Pascua, Valparaíso, Chile' },
  'ed:lanzarote': { nombre: 'Lanzarote', pais: 'España', codigoPais: 'ES', region: 'Canarias', etiqueta: 'Lanzarote, Canarias, España' },
  'ed:madeira': { nombre: 'Madeira', pais: 'Portugal', codigoPais: 'PT', region: 'Madeira', etiqueta: 'Madeira, Portugal' },
  'ed:mallorca': { nombre: 'Mallorca', pais: 'España', codigoPais: 'ES', region: 'Islas Baleares', etiqueta: 'Mallorca, Islas Baleares, España' },
  'ed:menorca': { nombre: 'Menorca', pais: 'España', codigoPais: 'ES', region: 'Islas Baleares', etiqueta: 'Menorca, Islas Baleares, España' },
  'ed:positano': { nombre: 'Positano', pais: 'Italia', codigoPais: 'IT', region: 'Campania', etiqueta: 'Positano, Campania, Italia' },
  'ed:santorini': { nombre: 'Santorini', pais: 'Grecia', codigoPais: 'GR', region: 'Cícladas', etiqueta: 'Santorini, Cícladas, Grecia' },
  'ed:sicilia': { nombre: 'Sicilia', pais: 'Italia', codigoPais: 'IT', region: 'Sicilia', etiqueta: 'Sicilia, Italia' },
};

/** Combinaciones contradictorias que un cliente manipulado (o con un fallo) podría enviar con ese identificador. */
const CONTRADICCIONES = [
  { pais: 'Colombia', codigoPais: 'CO', region: 'Quindío' },
  { pais: 'Italia', codigoPais: 'IT', region: 'Apulia' },
  { pais: 'España', codigoPais: 'ES', region: 'Región de Murcia' },
  { pais: 'Francia', codigoPais: 'fr', region: '' },
  { pais: '', codigoPais: '', region: 'Bolívar' },
  { nombre: 'Madrid', tipo: 'region', pais: 'España', codigoPais: 'ES', region: 'Madrid' },
  { nombre: 'Lima', tipo: 'pais', pais: 'Perú', codigoPais: 'PE', region: 'Lima', lat: 1, lng: 2, latitud: 3, longitud: 4, centro: { lat: 5 } },
];

test('todo identificador editorial figura en la tabla de comprobación (no queda ninguno sin cubrir)', () => {
  const editoriales = [...Object.keys(REGIONES_EDITORIALES), ...Object.keys(DESTINOS_EDITORIALES)].sort();
  assert.deepEqual(Object.keys(CANONICO).sort(), editoriales);
});

test('el identificador impone ciudad, país, código de país, región y tipo, con cualquier combinación contradictoria del cliente', () => {
  for (const [id, esperado] of Object.entries(CANONICO)) {
    for (const c of CONTRADICCIONES) {
      const d = normalizarDestinoSeleccionado({ nombre: 'Salento', tipo: 'ciudad', ...c, id })!;
      const caso = `${id} + ${JSON.stringify(c)}`;
      assert.deepEqual(d, { nombre: esperado.nombre, pais: esperado.pais, codigoPais: esperado.codigoPais, region: esperado.region, id, tipo: 'ciudad' }, caso);
      assert.equal(etiquetaDestino(d), esperado.etiqueta, caso);
    }
  }
});

test('el ejemplo de la revisión: id de Campania con país Colombia ya no produce «Salento, Campania, Colombia»', () => {
  const d = normalizarDestinoSeleccionado({ nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', id: 'gn:3168676' })!;
  assert.equal(etiquetaDestino(d), 'Salento, Campania, Italia');
  assert.equal(d.codigoPais, 'IT');
  // …y el backend resuelve la etiqueta al municipio de Campania, no a Quindío.
  const r = datosCiudad(etiquetaDestino(d))!;
  assert.ok(Math.abs(r.lat - 40.249) < 0.1 && Math.abs(r.lng - 15.189) < 0.1, `${r.lat},${r.lng}`);
  assert.equal(codigoPaisDesdeDestino(etiquetaDestino(d)), 'it');
});

test('tras imponer la identidad, la etiqueta resuelve en el backend a la ciudad del identificador (coordenadas, país y región)', () => {
  for (const [id, esperado] of Object.entries(CANONICO)) {
    const d = normalizarDestinoSeleccionado({ nombre: 'x', pais: 'Francia', codigoPais: 'FR', region: 'Normandía', id })!;
    const e = etiquetaDestino(d);
    const r = datosCiudad(e);
    assert.ok(r, id);
    const ref = id.startsWith('ed:')
      ? { lat: DESTINOS_EDITORIALES[id]!.centro.lat, lon: DESTINOS_EDITORIALES[id]!.centro.lon }
      : cat.ciudad(id, esperado.codigoPais)!;
    const dKm = Math.hypot((r!.lat - ref.lat) * 111, (r!.lng - ref.lon) * 111 * Math.cos(ref.lat * Math.PI / 180));
    assert.ok(dKm < 15, `${id}: ${e} resuelve a ${r!.lat},${r!.lng} (a ${dKm.toFixed(1)} km de la ciudad del identificador)`);
    assert.equal(codigoPaisDesdeDestino(e), esperado.codigoPais.toLowerCase(), id);
    // Campania (sin entrada curada) y Cartagena de Indias (la tabla curada no muestra región) no tienen región curada.
    if (!['gn:3168676', 'gn:3687238'].includes(id)) assert.equal(regionCurada(e), esperado.region, id);
  }
});

test('el cliente nunca aporta coordenadas: solo salen los campos permitidos', () => {
  for (const id of [...Object.keys(CANONICO), 'gn:3117735', undefined]) {
    const d = normalizarDestinoSeleccionado({ nombre: 'Madrid', pais: 'España', id, lat: 1, lng: 2, latitud: 3, longitud: 4, centro: { lat: 5 }, coordenadas: [1, 2] })!;
    assert.deepEqual(Object.keys(d).filter((k) => !['nombre', 'pais', 'codigoPais', 'region', 'id', 'tipo'].includes(k)), [], String(id));
  }
});

test('destinos normales del catálogo: sin identidad editorial no cambia nada (se conserva lo saneado)', () => {
  assert.deepEqual(normalizarDestinoSeleccionado({ nombre: 'Madrid', pais: 'España', codigoPais: 'es', region: 'Comunidad de Madrid', id: 'gn:3117735', tipo: 'ciudad' }),
    { nombre: 'Madrid', pais: 'España', codigoPais: 'ES', region: 'Comunidad de Madrid', id: 'gn:3117735', tipo: 'ciudad' });
  assert.deepEqual(normalizarDestinoSeleccionado({ nombre: 'Lecce', pais: 'Italia', codigoPais: 'IT', id: 'gn:3174953', tipo: 'ciudad' }),
    { nombre: 'Lecce', pais: 'Italia', codigoPais: 'IT', id: 'gn:3174953', tipo: 'ciudad' });
  assert.deepEqual(normalizarDestinoSeleccionado({ nombre: 'Madrid, España', pais: 'España' }), { nombre: 'Madrid, España', pais: 'España' }, 'destino escrito a mano, sin id');
  // Un id de catálogo que no es editorial sigue sin imponer región ni país (no hay dato editorial contra el que contrastar).
  assert.equal(normalizarDestinoSeleccionado({ nombre: 'Lecce', region: 'Apulia', id: 'gn:3174953' })!.region, 'Apulia');
});

test('identificadores inventados o mal formados se descartan y no heredan identidad', () => {
  for (const id of ['ed:no-existe', 'ED:salento-apulia', 'ed:salento-apulia ', 'ed:salento-apulia; x', 'gn:3168676x', 'gn:']) {
    const d = normalizarDestinoSeleccionado({ nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', id })!;
    assert.equal(d.id, undefined, id);
    assert.equal(d.region, undefined, id);
  }
});
