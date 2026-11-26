// Relevancia de consultas cortas: una ciudad grande que empieza igual no queda tapada por pueblos diminutos de nombre exacto.
// Catálogo versionado real, sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { buscarDestinos } from '../src/geo/buscar.js';

const cat = new Catalogo(fuenteEnDisco());
const nombres = (q: string, limite = 7) => buscarDestinos(cat, q, { limite }).map((r) => r.nombre);

test('«buda» y «budap» muestran Budapest entre los primeros resultados', () => {
  const buda = buscarDestinos(cat, 'buda', { limite: 7 });
  const pos = buda.findIndex((r) => r.id === 'gn:3054643');
  assert.ok(pos >= 0 && pos <= 2, `Budapest en las 3 primeras posiciones de «buda» (posición ${pos + 1})`);
  assert.equal(buscarDestinos(cat, 'budap')[0]!.id, 'gn:3054643');
  assert.equal(buscarDestinos(cat, 'budapest')[0]!.id, 'gn:3054643');
});

test('consultas cortas con gran ciudad por prefijo: Rio → Rio de Janeiro, Bogot → Bogotá', () => {
  assert.equal(buscarDestinos(cat, 'rio')[0]!.id, 'gn:3451190');
  assert.equal(buscarDestinos(cat, 'bogot')[0]!.id, 'gn:3688689');
});

test('no se degrada: los nombres exactos de ciudades grandes siguen primero', () => {
  const primeros: Record<string, string> = {
    madrid: 'gn:3117735', paris: 'gn:2988507', lima: 'gn:3936456', porto: 'gn:2735943', roma: 'gn:3169070', londres: 'gn:2643743',
    tokyo: 'gn:1850147', cairo: 'gn:360630', granada: 'gn:2517117', salento: 'gn:3670352', bruselas: 'gn:2800866', medellin: 'gn:3674962',
    bogota: 'gn:3688689', cartagena: 'gn:3687238', venecia: 'gn:3164603', oporto: 'gn:2735943',
  };
  for (const [q, id] of Object.entries(primeros)) assert.equal(buscarDestinos(cat, q)[0]!.id, id, q);
});

test('los pueblos pequeños siguen siendo buscables (solo se ordenan después)', () => {
  const ada = buscarDestinos(cat, 'ada', { limite: 12 }).map((r) => r.nombre);
  assert.ok(ada.includes('Adamstown'), 'Adamstown (capital de Pitcairn) sigue apareciendo tras las ciudades grandes');
  assert.ok(nombres('salento', 12).filter((n) => n === 'Salento').length >= 2, 'ambos Salento (Colombia, Italia) siguen apareciendo');
});
