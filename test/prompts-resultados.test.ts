// Los prompts ya no dictan listas de resultados en markdown ni monedas fijas: las tarjetas salen de los datos estructurados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INSTRUCCIONES_HOTELES_APIFY_AGENTE, INSTRUCCIONES_HOTELES_APIFY_MANAGER } from '../src/services/hoteles-instrucciones.ts';

const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const prompts = [src, INSTRUCCIONES_HOTELES_APIFY_AGENTE, INSTRUCCIONES_HOTELES_APIFY_MANAGER].join('\n');

test('ningún prompt impone «€» como moneda ni formatos de línea con importes fijos', () => {
  assert.doesNotMatch(prompts, /\[precio total\]\s*€/);
  assert.doesNotMatch(prompts, /\d+\s*€\s*por noche/);
  assert.doesNotMatch(prompts, /0 €/);
  assert.doesNotMatch(prompts, /primer importe en €/i);
  assert.match(prompts, /Moneda no confirmada|moneda no confirmada/);
});

test('el Travel Manager solo explica: no escribe las listas de vuelos, hoteles ni actividades ni la línea «Estado de actividades»', () => {
  assert.doesNotMatch(src, /Estado de actividades: <estado>/);
  assert.doesNotMatch(src, /Formato preferido para cada vuelo/);
  assert.doesNotMatch(src, /FORMATO OBLIGATORIO PARA CADA VUELO/);
  assert.doesNotMatch(src, /#### Alojamientos recomendados\n/);
  assert.match(src, /NO escribas listas ni tablas con las opciones/);
});

test('Tiqets no aparece en ningún prompt ni herramienta (solo el módulo de plataformas lo conserva desactivado)', () => {
  assert.doesNotMatch(prompts, /tiqets/i);
});
