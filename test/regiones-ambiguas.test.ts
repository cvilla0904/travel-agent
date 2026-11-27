// Prefijos ambiguos entre región y país mientras se escribe («Salento, Cam»: Campania o Camboya; «Cartagena, Bol»: Bolívar o Bolivia).
// Catálogo real en disco; para la lectura doble se añade en memoria una «Cartagena» boliviana (solo para la prueba). Sin red ni proveedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { buscarDestinos } from '../src/geo/buscar.js';
import { crearHandler } from '../api/geo.js';

const real = new Catalogo(fuenteEnDisco());
const QUINDIO = 'gn:3670352', APULIA = 'ed:salento-apulia', CAMPANIA = 'gn:3168676', CART_CO = 'gn:3687238', CART_ES = 'gn:2520058';
const ids = (q: string, cat: Catalogo = real, limite = 12) => buscarDestinos(cat, q, { limite }).map((r) => r.id);

// Catálogo con una «Cartagena» en Bolivia (id sintético): permite que el país a medio escribir y la región compitan de verdad.
const ID_BOLIVIA = 'gn:900000001';
const ENTRADA_BOLIVIA: any = ['c', ID_BOLIVIA, 'BO', 5000, 1];
const conCartagenaBoliviana = new Proxy(real, {
  get(destino: any, prop) {
    const v = destino[prop];
    if (typeof v !== 'function') return v;
    if (prop === 'entradas') return (c: string) => [...destino.entradas(c), ...(c === 'cartagena' ? [ENTRADA_BOLIVIA] : [])];
    if (prop === 'buscarPrefijo') {
      return (c: string) => {
        const r: Array<[string, any[]]> = destino.buscarPrefijo(c).map(([n, es]: [string, any[]]) => [n, es]);
        if ('cartagena'.startsWith(c) || c.startsWith('cartagena')) {
          const i = r.findIndex(([n]) => n === 'cartagena');
          if (i >= 0) r[i] = ['cartagena', [...r[i]![1], ENTRADA_BOLIVIA]];
          else if ('cartagena'.startsWith(c)) r.push(['cartagena', [ENTRADA_BOLIVIA]]);
        }
        return r;
      };
    }
    if (prop === 'ficha') return (id: string) => (id === ID_BOLIVIA ? { id: ID_BOLIVIA, nombre: 'Cartagena', nombreAscii: 'Cartagena', pais: 'BO', poblacion: 5000, lat: -17.0, lon: -65.0 } : destino.ficha(id));
    return v.bind(destino);
  },
}) as Catalogo;

test('el catálogo con Cartagena boliviana funciona (control de la prueba)', () => {
  const r = buscarDestinos(conCartagenaBoliviana, 'Cartagena, Bolivia');
  assert.deepEqual(r.map((x) => x.id), [ID_BOLIVIA]);
  assert.equal(r[0]!.codigoPais, 'BO');
});

test('«Salento, Cam»: Campania gana a Camboya/Camerún (que no tienen Salento) y se muestra con región y país', () => {
  for (const q of ['Salento, Cam', 'salento, CAM', 'Salento,Cam']) {
    const r = buscarDestinos(real, q);
    assert.deepEqual(r.map((x) => x.id), [CAMPANIA], q);
    assert.equal(r[0]!.region, 'Campania');
    assert.equal(r[0]!.codigoPais, 'IT');
    assert.equal(r[0]!.nombrePais, 'Italia');
  }
});

test('«Salento, Cam…» a medio escribir: Camp/Campa/Campania priorizan Campania; Camb/Camboya (país) no devuelven nada', () => {
  for (const q of ['Salento, Camp', 'Salento, Campa', 'Salento, Campania']) assert.equal(ids(q)[0], CAMPANIA, q);
  for (const q of ['Salento, Camb', 'Salento, Camboya', 'Salento, Camerún', 'Salento, Cameroon']) assert.deepEqual(ids(q), [], q);
});

test('«Salento, Bol»: ningún Salento en Bolivia ni en una región «Bol…» → vacío, sin error; Bolivia completa tampoco', () => {
  for (const q of ['Salento, Bol', 'Salento, Boli', 'Salento, Bolivia', 'Salento, Bolívar']) {
    assert.doesNotThrow(() => ids(q), q);
  }
  assert.deepEqual(ids('Salento, Bol'), []);
  assert.deepEqual(ids('Salento, Bolivia'), []);
});

test('«Cartagena, Bol»: Bolívar (Colombia) se ofrece aunque «bol» empiece como Bolivia', () => {
  const r = buscarDestinos(real, 'Cartagena, Bol');
  assert.deepEqual(r.map((x) => x.id), [CART_CO]);
  assert.equal(r[0]!.region, 'Bolívar');
  assert.equal(r[0]!.nombrePais, 'Colombia');
  assert.equal(ids('Cartagena, Bolívar')[0], CART_CO);
  assert.equal(ids('Cartagena, Bolivar')[0], CART_CO);
});

test('lectura doble: «Cartagena, Bol» ofrece Bolívar (Colombia) y Cartagena de Bolivia, con región y país visibles; «Bolivia» entera acota solo al país', () => {
  const r = buscarDestinos(conCartagenaBoliviana, 'Cartagena, Bol');
  assert.deepEqual(r.map((x) => x.id), [CART_CO, ID_BOLIVIA], 'la región escrita va primero y el país no desaparece');
  assert.deepEqual(r.map((x) => [x.region ?? null, x.nombrePais]), [['Bolívar', 'Colombia'], [null, 'Bolivia']]);
  assert.deepEqual(ids('Cartagena, Bolivia', conCartagenaBoliviana), [ID_BOLIVIA]);
  assert.deepEqual(ids('Cartagena, bo', conCartagenaBoliviana), [ID_BOLIVIA], 'ISO-2 «bo»: país sin ambigüedad');
  // Sin la lectura de país, «Cartagena, Bol» no puede perder a la boliviana ni a la colombiana: ambas están.
  assert.ok(ids('Cartagena, Boli', conCartagenaBoliviana).includes(ID_BOLIVIA) && ids('Cartagena, Boli', conCartagenaBoliviana).includes(CART_CO));
});

test('«Cartagena, Mur» y «Salento, Ap…»: las regiones que no empiezan como un país siguen funcionando', () => {
  const r = buscarDestinos(real, 'Cartagena, Mur');
  assert.equal(r[0]!.id, CART_ES);
  assert.equal(r[0]!.region, 'Región de Murcia');
  for (const q of ['Cartagena, Murcia', 'Cartagena, Región de Murcia']) assert.equal(ids(q)[0], CART_ES, q);
  assert.equal(ids('Salento, Apu')[0], APULIA);
  assert.equal(ids('Salento, Apul')[0], APULIA);
  // Dos letras («ap») no son todavía una región ni un país: no alteran el orden por defecto.
  assert.deepEqual(ids('Salento, Ap').filter((i) => [QUINDIO, APULIA, CAMPANIA].includes(i)), [QUINDIO, APULIA, CAMPANIA]);
});

test('las búsquedas por país siguen acotando: nombre completo, prefijo y ISO-2; una región no desplaza al país', () => {
  assert.deepEqual(ids('Salento, Colombia'), [QUINDIO]);
  assert.deepEqual(ids('Salento, Col'), [QUINDIO]);
  assert.deepEqual(ids('Salento, co'), [QUINDIO]);
  assert.deepEqual(ids('Salento, Italia'), [APULIA, CAMPANIA]);
  assert.deepEqual(ids('Salento, Ita'), [APULIA, CAMPANIA]);
  assert.deepEqual(ids('Salento, it'), [APULIA, CAMPANIA]);
  assert.equal(ids('Salento, Campania, Italia')[0], CAMPANIA);
  assert.deepEqual(ids('Salento, Campania, Italia').sort(), [APULIA, CAMPANIA].sort());
  assert.deepEqual(ids('Cartagena, Colombia').includes(CART_ES), false);
  assert.deepEqual(ids('Cartagena, España')[0], CART_ES);
  assert.equal(ids('Cartagena, Esp').includes(CART_CO), false);
  // El prefijo de país sin ciudad editorial que lo reclame se comporta como siempre: «Roma, Cam» no devuelve nada.
  assert.deepEqual(ids('Roma, Cam'), []);
});

test('el prefijo ambiguo no se aplica a otras ciudades: «Madrid, Cam» no recibe candidatos editoriales', () => {
  assert.ok(!ids('Madrid, Cam').some((i) => [CAMPANIA, APULIA, QUINDIO].includes(i)));
});

test('/api/geo: «Salento, Cam» devuelve Campania con región, país y coordenadas', () => {
  const handler = crearHandler(() => real);
  let cuerpo: any; let codigo = 0;
  const res: any = { setHeader() { return res; }, status(c: number) { codigo = c; return res; }, json(d: unknown) { cuerpo = d; return res; } };
  handler({ method: 'GET', query: { q: 'Salento, Cam' } }, res);
  assert.equal(codigo, 200);
  assert.equal(cuerpo.total, 1);
  const r = cuerpo.resultados[0];
  assert.equal(r.id, CAMPANIA);
  assert.equal(r.region, 'Campania');
  assert.equal(r.codigoPais, 'IT');
  assert.equal(typeof r.latitud, 'number');
});
