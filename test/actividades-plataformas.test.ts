// Plataformas de actividades: Civitatis es la única activa y Tiqets queda preparado para reactivarse. Sin red ni créditos:
// el actor se sustituye por un cliente falso y no se usa ningún token real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTOR_ID, PLATAFORMAS_ACTIVAS, PLATAFORMAS_DISPONIBLES, WAIT_SECS, buscarActividadesApify, buscarActividadesApifyDetallado,
  buscarActividadesApifyMultidestino, establecerClienteApify, etiquetaPlataformas, inputActor, validarPlataformas,
} from '../src/services/apify.ts';

const raiz = path.resolve(import.meta.dirname, '..');
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), 'utf8');

type Llamada = { actor: string; input: any; opciones: any };

/** Cliente falso: registra lo que se enviaría al actor y devuelve un dataset vacío. No hay red. */
function clienteFalso(llamadas: Llamada[]) {
  return () => ({
    actor: (actor: string) => ({
      call: async (input: any, opciones: any) => {
        llamadas.push({ actor, input, opciones });
        return { status: 'SUCCEEDED', id: 'run-falso', defaultDatasetId: 'dataset-falso' };
      },
    }),
    dataset: () => ({ listItems: async () => ({ items: [] }) }),
  });
}

function conClienteFalso<T>(llamadas: Llamada[], fn: () => Promise<T>): Promise<T> {
  const tokenPrevio = process.env.APIFY_API_TOKEN;
  process.env.APIFY_API_TOKEN = 'token-de-prueba-no-real';
  establecerClienteApify(clienteFalso(llamadas));
  return fn().finally(() => {
    establecerClienteApify(undefined);
    if (tokenPrevio === undefined) delete process.env.APIFY_API_TOKEN; else process.env.APIFY_API_TOKEN = tokenPrevio;
  });
}

test('solo Civitatis está disponible: Tiqets no existe en el proyecto', () => {
  assert.deepEqual([...PLATAFORMAS_ACTIVAS], ['civitatis']);
  assert.deepEqual([...PLATAFORMAS_DISPONIBLES], ['civitatis']);
  assert.ok(PLATAFORMAS_ACTIVAS.every((p) => (PLATAFORMAS_DISPONIBLES as readonly string[]).includes(p)));
});

test('inputActor envía solo Civitatis por defecto y no cambia el resto del input', () => {
  const input = inputActor(['Bruselas', 'Brussels']);
  assert.deepEqual(input.platforms, ['civitatis']);
  assert.deepEqual(input, {
    searchQueries: ['Bruselas', 'Brussels'],
    platforms: ['civitatis'],
    currency: 'EUR',
    language: 'es',
    includeActivityDetails: true,
    maxResults: 20,
    maxResultsPerQuery: 10,
  });
});

test('Tiqets se rechaza: nunca llega al actor', () => {
  assert.throws(() => inputActor(['Roma'], ['tiqets']), /no válidas: tiqets/);
  assert.throws(() => inputActor(['Roma'], ['civitatis', 'tiqets']), /tiqets/);
});

test('protección: lista vacía o plataforma desconocida lanzan error y nunca llegan al actor', () => {
  assert.throws(() => inputActor(['Roma'], []), /no puede estar vacía/);
  assert.throws(() => inputActor(['Roma'], ['viator']), /no válidas: viator/);
  assert.throws(() => inputActor(['Roma'], ['civitatis', 'getyourguide']), /getyourguide/);
  assert.throws(() => inputActor(['Roma'], 'civitatis' as any), /no válidas/);
  assert.throws(() => validarPlataformas([]), /vacía/);
  assert.deepEqual(validarPlataformas(['civitatis', 'civitatis']), ['civitatis'], 'sin duplicados');
});

test('la etiqueta de los textos refleja las plataformas activas', () => {
  assert.equal(etiquetaPlataformas(), 'Civitatis');
  assert.throws(() => etiquetaPlataformas([]));
});

test('los tres caminos de ejecución hacia Apify usan solo Civitatis por defecto (cliente falso, sin red)', async () => {
  const llamadas: Llamada[] = [];
  await conClienteFalso(llamadas, async () => {
    await buscarActividadesApifyDetallado({ destino: 'Bruselas' });          // destino único (herramienta buscar_actividades)
    await buscarActividadesApify({ destino: 'Bruselas', categoria: 'cultura' }); // búsqueda simple
    await buscarActividadesApifyMultidestino(['Bruselas', 'Viena']);          // multidestino
  });
  assert.equal(llamadas.length, 3, 'exactamente una ejecución por camino');
  for (const l of llamadas) {
    assert.equal(l.actor, ACTOR_ID);
    assert.deepEqual(l.input.platforms, ['civitatis']);
    assert.deepEqual(l.opciones, { waitSecs: WAIT_SECS });
    assert.equal(l.input.language, 'es');
  }
  assert.deepEqual(llamadas[0]!.input.searchQueries, ['Bruselas', 'Brussels']);
  assert.ok(llamadas[2]!.input.searchQueries.includes('Viena') && llamadas[2]!.input.searchQueries.includes('Bruselas'));
});

test('sin token no se llega a construir ningún cliente ni se llama al actor', async () => {
  const llamadas: Llamada[] = [];
  const previo = process.env.APIFY_API_TOKEN;
  delete process.env.APIFY_API_TOKEN;
  establecerClienteApify(clienteFalso(llamadas));
  try {
    await assert.rejects(() => buscarActividadesApifyDetallado({ destino: 'Bruselas' }), /APIFY_API_TOKEN/);
  } finally {
    establecerClienteApify(undefined);
    if (previo !== undefined) process.env.APIFY_API_TOKEN = previo;
  }
  assert.equal(llamadas.length, 0);
});

test('el script de diagnóstico comparte inputActor y no fija plataformas por su cuenta', () => {
  const script = leer('scripts/diagnostico-actividades.ts');
  assert.match(script, /inputActor\(/);
  assert.doesNotMatch(script, /platforms/i);
  assert.doesNotMatch(script, /tiqets/i);
});

test('ningún otro archivo del código fija plataformas de actividades ni cita Tiqets en prompts', () => {
  const apify = leer('src/services/apify.ts');
  assert.equal((apify.match(/platforms:/g) ?? []).length, 1, 'un único punto donde se construye platforms');
  const index = leer('src/index.ts');
  assert.doesNotMatch(index, /Civitatis y Tiqets/, 'los textos no nombran Tiqets de forma fija');
  assert.equal((index.match(/etiquetaPlataformas\(\)/g) ?? []).length, 3, 'herramienta + dos prompts');
});
