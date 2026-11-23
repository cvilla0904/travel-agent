// ciudades.ts con el catálogo geográfico: la tabla curada no se degrada y el catálogo amplía la cobertura.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { catalogoDePrueba } from './geo-fixture.ts';
import { codigoPaisDesdeNombre, consultaProveedorParaCiudad, datosCiudad, establecerCatalogoGeo, variantesCiudad } from '../src/services/ciudades.ts';

test.afterEach(() => establecerCatalogoGeo(undefined));

test('Bruselas con catálogo disponible sigue dando nombre en español, consulta en inglés y las variantes curadas', () => {
  const sin = { datos: datosCiudad('Bruselas'), consulta: consultaProveedorParaCiudad('Bruselas'), variantes: variantesCiudad('Bruselas') };
  establecerCatalogoGeo(catalogoDePrueba());
  const con = { datos: datosCiudad('Bruselas'), consulta: consultaProveedorParaCiudad('Bruselas'), variantes: variantesCiudad('Bruselas') };
  assert.equal(con.datos?.es, 'Bruselas');
  assert.equal(con.consulta, 'Brussels');
  assert.deepEqual(con.datos, sin.datos);
  for (const v of sin.variantes) assert.ok(con.variantes.includes(v), `variante curada conservada: ${v}`);
  assert.ok(con.variantes.includes('brussels') && con.variantes.includes('bruselas'));
});

test('ciudad que no está en la tabla curada: la resuelve el catálogo (Dubrovnik, São Paulo con y sin tilde)', () => {
  establecerCatalogoGeo(catalogoDePrueba());
  assert.equal(datosCiudad('Dubrovnik')?.en, 'Dubrovnik');
  assert.equal(consultaProveedorParaCiudad('São Paulo'), 'Sao Paulo');
  assert.equal(consultaProveedorParaCiudad('sao paulo'), 'Sao Paulo');
  assert.ok(variantesCiudad('Sao Paulo').includes('sao paulo'));
});

test('ambigua o desconocida: no se inventa nada, se conserva el texto', () => {
  establecerCatalogoGeo(catalogoDePrueba());
  assert.equal(datosCiudad('Valencia, Venezuela')?.es, 'Valencia');
  assert.equal(consultaProveedorParaCiudad('Ciudadinexistente'), 'Ciudadinexistente');
  assert.deepEqual(variantesCiudad('Ciudadinexistente'), ['ciudadinexistente']);
  assert.equal(datosCiudad('Ciudadinexistente'), null);
});

test('catálogo no generado: el diccionario curado sigue funcionando y no rompe', () => {
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-vacio-'));
  try {
    establecerCatalogoGeo(new Catalogo(fuenteEnDisco(vacio)));
    assert.equal(datosCiudad('Bruselas')?.es, 'Bruselas');
    assert.equal(consultaProveedorParaCiudad('Bruselas'), 'Brussels');
    assert.equal(consultaProveedorParaCiudad('Ciudadinexistente'), 'Ciudadinexistente');
    assert.equal(codigoPaisDesdeNombre('Italia'), 'it');
  } finally { fs.rmSync(vacio, { recursive: true, force: true }); }
});

test('el resultado del catálogo se memoriza (una sola resolución por texto)', () => {
  const cat = catalogoDePrueba();
  let llamadas = 0;
  const original = cat.entradas.bind(cat);
  cat.entradas = (k: string) => { llamadas++; return original(k); };
  establecerCatalogoGeo(cat);
  datosCiudad('Dubrovnik'); const tras1 = llamadas;
  for (let i = 0; i < 20; i++) { datosCiudad('Dubrovnik'); consultaProveedorParaCiudad('Dubrovnik'); variantesCiudad('Dubrovnik'); }
  assert.equal(llamadas, tras1);
});
