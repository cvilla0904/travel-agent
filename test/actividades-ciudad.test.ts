// Filtro geográfico de actividades (Bruselas, Viena, Praga…), diagnóstico y multidestino. Sin red ni proveedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actividadEsDeCiudad, filtrarActividadesDeCiudad, actividadParaMultidestino, consultasActividadesParaDestino,
} from '../src/services/actividades-ciudad.ts';

const act = (city: string | undefined, title = 'Tour de prueba', extra: Record<string, unknown> = {}) =>
  ({ title, city, url: 'https://www.civitatis.com/es/x/', ...extra });

test('Bruselas, Viena y Praga: el nombre pedido en cualquier idioma casa con la ciudad del proveedor', () => {
  const casos: Array<[string, string[]]> = [
    ['Bruselas', ['Brussels', 'Bruselas', 'Bruxelles', 'Brussels, Belgium', 'Brussels (Belgium)']],
    ['Brussels', ['Brussels', 'Bruselas', 'Bruxelles']],
    ['Viena', ['Vienna', 'Viena', 'Wien', 'Vienna, Austria', 'Things to do Vienna', 'Vienna attractions']],
    ['Vienna', ['Vienna', 'Viena', 'Wien']],
    ['Praga', ['Prague', 'Praga', 'Praha', 'Prague, Czech Republic']],
    ['Prague', ['Praga', 'Praha']],
    ['Bruselas, Bélgica', ['Brussels']],
  ];
  for (const [pedida, ciudades] of casos) {
    for (const c of ciudades) assert.equal(actividadEsDeCiudad(act(c), pedida), true, `${pedida} ← ${c}`);
  }
});

test('se mantienen las equivalencias anteriores (Roma, Florencia, Venecia, Múnich, Cartagena, Bogotá)', () => {
  assert.equal(actividadEsDeCiudad(act('Rome'), 'Roma'), true);
  assert.equal(actividadEsDeCiudad(act('Florence'), 'Florencia'), true);
  assert.equal(actividadEsDeCiudad(act('Venice'), 'Venecia'), true);
  assert.equal(actividadEsDeCiudad(act('Munich'), 'Múnich'), true);
  assert.equal(actividadEsDeCiudad(act('Cartagena de Indias'), 'Cartagena'), true);
  assert.equal(actividadEsDeCiudad(act('Bogotá'), 'Bogota'), true);
});

test('NEGATIVOS: nunca se acepta una actividad de otra ciudad', () => {
  assert.equal(actividadEsDeCiudad(act('Barcelona'), 'Praga'), false);
  assert.equal(actividadEsDeCiudad(act('Barcelona'), 'Prague'), false);
  assert.equal(actividadEsDeCiudad(act('Paris'), 'Bruselas'), false);
  assert.equal(actividadEsDeCiudad(act('Budapest'), 'Viena'), false);
  assert.equal(actividadEsDeCiudad(act('Venice'), 'Viena'), false, 'Venice contiene «ven» pero no es Viena');
  assert.equal(actividadEsDeCiudad(act('Rome'), 'Florencia'), false);
  // No es una coincidencia por prefijo suelto.
  assert.equal(actividadEsDeCiudad(act('Viennaville'), 'Viena'), false);
  assert.equal(actividadEsDeCiudad(act('Brussels Airport Town'), 'Bruselas'), false);
});

test('sin ciudad estructurada: solo vale si el título la menciona como palabra completa', () => {
  assert.equal(actividadEsDeCiudad({ title: 'Vienna Walking Tour', url: 'https://x' }, 'Viena'), true);
  assert.equal(actividadEsDeCiudad({ title: 'Paseo por Viena imperial', url: 'https://x' }, 'Viena'), true);
  assert.equal(actividadEsDeCiudad({ title: 'Free tour por Bruselas', url: 'https://x' }, 'Brussels'), true);
  assert.equal(actividadEsDeCiudad({ title: 'Excursión a Salzburgo desde Viena', url: 'https://x' }, 'Praga'), false);
  assert.equal(actividadEsDeCiudad({ title: 'Tour de aromas y sabores', url: 'https://x' }, 'Roma'), false, '«roma» dentro de «aromas» no cuenta');
  assert.equal(actividadEsDeCiudad({ title: 'Tour genérico', url: 'https://x' }, 'Viena'), false);
});

test('ciudad desconocida o vacía: se usa el propio nombre y nunca se acepta una ciudad distinta', () => {
  assert.equal(actividadEsDeCiudad(act('Tallinn'), 'Tallin'), false, 'sin variante conocida no se adivina');
  assert.equal(actividadEsDeCiudad(act('Tallinn'), 'Tallinn'), true);
  assert.equal(actividadEsDeCiudad(act('Oslo'), ''), false);
});

test('diagnóstico: distingue lo que devolvió el proveedor, lo válido y lo descartado por ciudad', () => {
  const datos = [
    act('Brussels', 'Tour Grand Place'), act('Brussels', 'Chocolate tour'),
    act('Barcelona', 'Sagrada Familia'), act('Paris', 'Louvre'),
    { title: '', city: 'Brussels', url: 'https://x' },            // sin título
    { title: 'Sin enlace', city: 'Brussels', url: '' },           // sin URL
    { title: 'URL rara', city: 'Brussels', url: 'ftp://x' },       // URL no HTTP(S)
  ];
  const { validas, diagnostico } = filtrarActividadesDeCiudad(datos, 'Bruselas');
  assert.equal(validas.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostico)), {
    resultadosProveedor: 7, sinTituloOUrl: 3, descartadasPorCiudad: 2, resultadosValidos: 2,
    ciudadesDescartadas: ['Barcelona', 'Paris'],
    aceptadasPorCoordenadas: 0,
    descartesPorMotivo: { ciudad_distinta_sin_coordenadas: 2 },
  });
});

test('diagnóstico: cero del proveedor ≠ todo descartado por ciudad', () => {
  const vacio = filtrarActividadesDeCiudad([], 'Viena').diagnostico;
  assert.equal(vacio.resultadosProveedor, 0); assert.equal(vacio.descartadasPorCiudad, 0);
  const todoFiltrado = filtrarActividadesDeCiudad([act('Salzburg'), act('Graz')], 'Viena').diagnostico;
  assert.equal(todoFiltrado.resultadosProveedor, 2); assert.equal(todoFiltrado.descartadasPorCiudad, 2); assert.equal(todoFiltrado.resultadosValidos, 0);
  assert.equal(filtrarActividadesDeCiudad(undefined as any, 'Viena').diagnostico.resultadosProveedor, 0);
});

test('multidestino: se conservan las actividades sin precio numérico y NO se convierten en 0 ni en gratis', () => {
  const dataset = [
    act('Vienna', 'Palacio de Schönbrunn', { priceFrom: 24.5, priceCurrency: 'EUR' }),
    act('Vienna', 'Visita sin tarifa publicada'),                                  // precio pendiente
    act('Vienna', 'Free tour', { priceText: 'Gratis' }),                           // gratuita verificada
    act('Vienna', 'Cero no es gratis', { priceFrom: 0 }),
    act('Brussels', 'Atomium', { priceFrom: 16 }),
    act('Budapest', 'Baños Széchenyi', { priceFrom: 30 }),
  ];
  const { validas } = filtrarActividadesDeCiudad(dataset, 'Viena');
  const salida = validas.map((a) => actividadParaMultidestino(a, ['cultura']));
  assert.equal(salida.length, 4, 'las 4 de Viena, también las de precio pendiente');
  const por = (n: string) => salida.find((x) => x.nombre === n)!;
  assert.equal(por('Palacio de Schönbrunn').precio, 24.5);
  assert.equal(por('Visita sin tarifa publicada').precio, null);
  assert.equal(por('Visita sin tarifa publicada').esGratis, false);
  assert.equal(por('Free tour').esGratis, true);
  assert.equal(por('Cero no es gratis').precio, 0);
  assert.equal(por('Cero no es gratis').esGratis, false);
  assert.ok(!salida.some((x) => /Atomium|Széchenyi/.test(x.nombre)), 'nada de otras ciudades');
});

test('consultas al actor: Bruselas y Viena también se piden con su nombre inglés; no se alteran las ya existentes', () => {
  assert.deepEqual(consultasActividadesParaDestino('Bruselas'), ['Bruselas', 'Brussels']);
  assert.deepEqual(consultasActividadesParaDestino('Viena'), ['Viena', 'Vienna']);
  assert.deepEqual(consultasActividadesParaDestino('Praga'), ['Praga', 'Prague']);
  // «Brussels» solo daba /es/brussels/ en Civitatis (inexistente): ahora también se pide «Bruselas».
  assert.deepEqual(consultasActividadesParaDestino('Brussels'), ['Brussels', 'Bruselas']);
  assert.deepEqual(consultasActividadesParaDestino('Vienna'), ['Vienna', 'Viena']);
  assert.deepEqual(consultasActividadesParaDestino('Roma'), ['Roma', 'Rome']);
  assert.deepEqual(consultasActividadesParaDestino('Paris'), ['Paris', 'París']);
  assert.deepEqual(consultasActividadesParaDestino('Tallin'), ['Tallin']);
});

import { analizarDataset } from '../src/services/actividades-ciudad.ts';

test('análisis de dataset: separa proveedor / sin datos / descartadas por ciudad / precio, y muestra las etiquetas de ciudad', () => {
  const items = [
    act('Brussels', 'Atomium', { priceFrom: 16 }), act('Brussels', 'Chocolate tour'),
    act('Antwerp', 'Puerto de Amberes', { priceFrom: 20 }), act(undefined, 'Sin ciudad ni mención'),
    { title: 'Sin url', city: 'Brussels' },
  ];
  const r = analizarDataset(items, 'Bruselas');
  assert.deepEqual(r.consultas, ['Bruselas', 'Brussels']);
  assert.equal(r.resultadosProveedor, 5);
  assert.equal(r.sinTituloOUrl, 1);
  assert.equal(r.descartadasPorCiudad, 2);
  assert.equal(r.resultadosValidos, 2);
  assert.equal(r.validasConPrecio, 1); assert.equal(r.validasSinPrecio, 1);
  assert.deepEqual(r.ciudadesEnDataset, { Brussels: 3, Antwerp: 1, '(sin ciudad)': 1 });
  assert.ok(r.ejemplosDescartados.some((e: any) => e.ciudad === 'Antwerp'));
});
