// Salida de la herramienta buscar_actividades (estados + trazabilidad) con un proveedor simulado. Sin red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buscarActividadesDestino } from '../src/services/actividades-busqueda.ts';
import type { EjecucionActor } from '../src/services/apify.ts';

const ejec = (items: any[], status = 'SUCCEEDED'): EjecucionActor =>
  ({ items, status, runId: 'bj6wLcAd7EEhXEpGl', datasetId: 'ghYzUFUJY9MlneHsd', consultas: [] });
const quien = (p: Promise<EjecucionActor> | EjecucionActor) => async () => p;
let n = 0; // la herramienta deduplica por URL: cada registro simulado lleva la suya
const item = (extra: Record<string, unknown>) =>
  ({ title: 'Tour', url: `https://www.civitatis.com/es/bruselas/x${++n}/`, platform: 'civitatis', priceFrom: 20, ...extra });
const PARIS = { latitude: 48.8584, longitude: 2.2945 };
const BXL = { latitude: 50.8467, longitude: 4.3525 };

test('CASO REAL Bruselas: 10 registros «Atracciones Paris» → sin_resultados por ubicación, NO ok ni error', async () => {
  const diez = Array.from({ length: 10 }, (_, i) => item({ title: `Paris ${i}`, city: 'Atracciones Paris', ...PARIS }));
  const r = await buscarActividadesDestino({ destino: 'Brussels', tipos: ['cultura'] }, quien(ejec(diez)));
  assert.equal(r.estado, 'sin_resultados');
  assert.equal(r.motivo, 'descartadas_por_ubicacion');
  assert.match(r.mensaje!, /10 resultados.*Atracciones Paris/);
  assert.equal(r.actividades.length, 0);
  assert.deepEqual(r.proveedor, { runId: 'bj6wLcAd7EEhXEpGl', status: 'SUCCEEDED' });
  assert.equal(r.diagnosticoBusqueda.resultadosProveedor, 10);
  assert.equal(r.diagnosticoBusqueda.descartadasPorCiudad, 10);
});

test('mezcla Bruselas + París: solo salen las de Bruselas, con ciudad del proveedor y plataforma', async () => {
  const datos = [
    item({ title: 'Atomium', city: 'Brussels', ...BXL, platform: 'tiqets' }),
    item({ title: 'Torre Eiffel', city: 'Atracciones Paris', ...PARIS }),
    item({ title: 'Chocolate', city: 'Atracciones Paris', ...BXL }), // etiqueta mala, coordenadas de Bruselas
  ];
  const r = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, quien(ejec(datos)));
  assert.equal(r.estado, 'ok');
  assert.deepEqual(r.actividades.map((a) => a.nombre).sort(), ['Atomium', 'Chocolate']);
  const atomium = r.actividades.find((a) => a.nombre === 'Atomium')!;
  assert.deepEqual([atomium.plataforma, atomium.ciudadProveedor, atomium.verificacionUbicacion, atomium.latitud], ['tiqets', 'Brussels', 'ciudad', BXL.latitude]);
  const choco = r.actividades.find((a) => a.nombre === 'Chocolate')!;
  assert.deepEqual([choco.ciudadProveedor, choco.verificacionUbicacion], ['Atracciones Paris', 'coordenadas']);
  assert.equal(r.diagnosticoBusqueda.aceptadasPorCoordenadas, 1);
});

test('error del proveedor: no lanza; estado error con mensaje (no es «sin actividades»)', async () => {
  const r = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, async () => { throw new Error('APIFY_API_TOKEN no está configurada.'); });
  assert.equal(r.estado, 'error');
  assert.match(r.mensaje!, /No se pudo consultar.*APIFY_API_TOKEN/);
  assert.deepEqual(r.actividades, []);
});

test('ejecución aún RUNNING: con resultados válidos → parcial; sin resultados → parcial (no sin_resultados)', async () => {
  const con = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, quien(ejec([item({ city: 'Brussels' })], 'RUNNING')));
  assert.equal(con.estado, 'parcial');
  assert.equal(con.actividades.length, 1);
  const sin = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, quien(ejec([], 'RUNNING')));
  assert.equal(sin.estado, 'parcial');
  assert.equal(sin.actividades.length, 0);
});

test('proveedor terminado sin registros → sin_resultados / proveedor_sin_resultados', async () => {
  const r = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, quien(ejec([])));
  assert.deepEqual([r.estado, r.motivo], ['sin_resultados', 'proveedor_sin_resultados']);
});

test('precios: se conservan y la ausencia de precio no es gratis', async () => {
  const r = await buscarActividadesDestino({ destino: 'Bruselas', tipos: [] }, quien(ejec([
    item({ title: 'Con precio', city: 'Brussels', priceFrom: 32.5 }), item({ title: 'Sin precio', city: 'Brussels', priceFrom: undefined }),
  ])));
  const por = (n: string) => r.actividades.find((a) => a.nombre === n)!;
  assert.equal(por('Con precio').precio, 32.5);
  assert.equal(por('Sin precio').precio, null);
  assert.equal(por('Sin precio').esGratis, false);
});
