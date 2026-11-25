// Homónimos de la tabla curada: ninguna ciudad curada se aplica a un destino de OTRO país.
// Usa el catálogo versionado en disco. Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CIUDADES_EQUIVALENTES, consultaProveedorParaCiudad, datosCiudad, grupoCurado, variantesCiudad } from '../src/services/ciudades.js';

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

test('todos los grupos curados declaran su país (condición del mecanismo general)', () => {
  for (const g of CIUDADES_EQUIVALENTES) assert.match(g.pais, /^[a-z]{2}$/, g.consulta);
});

test('Cartagena, España ya no devuelve las coordenadas de Cartagena de Indias', () => {
  for (const t of ['Cartagena, España', 'Cartagena, Murcia, España', 'Cartagena, Spain']) {
    const d = datosCiudad(t);
    assert.ok(d, t);
    assert.ok(km(d!, { lat: 37.6, lng: -0.98 }) < 15, `${t}: Cartagena (Murcia), no ${d!.lat},${d!.lng}`);
    assert.equal(consultaProveedorParaCiudad(t), 'Cartagena', t);
    assert.ok(!variantesCiudad(t).includes('cartagena de indias'), `${t}: sin variantes de Cartagena de Indias`);
  }
});

test('Cartagena sin país y con Colombia siguen siendo Cartagena de Indias (preferencia editorial)', () => {
  for (const t of ['Cartagena', 'Cartagena, Colombia', 'cartagena de indias']) {
    assert.equal(datosCiudad(t)?.en, 'Cartagena de Indias', t);
    assert.equal(consultaProveedorParaCiudad(t), 'Cartagena de Indias', t);
  }
});

test('mecanismo general: «<ciudad curada>, <otro país>» nunca devuelve el centro curado', () => {
  for (const g of CIUDADES_EQUIVALENTES) {
    const propio = datosCiudad(`${g.nombres[0]}, ${g.pais.toUpperCase()}`);
    assert.ok(propio, `${g.consulta} con su propio país`);
    const otro = g.pais === 'au' ? 'NZ' : 'AU';
    assert.equal(grupoCurado(`${g.nombres[0]}, ${otro}`), undefined, `${g.consulta}, ${otro} no usa la entrada curada`);
    const d = datosCiudad(`${g.nombres[0]}, ${otro}`);
    if (d) assert.ok(km(d, propio!) > 100, `${g.consulta}, ${otro}: ${d.en} no debe estar en el centro curado`);
  }
});

test('casos ambiguos pedidos: Venecia, Nápoles, Sevilla, Florencia, Colonia, París, Madrid, Barcelona', () => {
  const venice = datosCiudad('Venecia, Italia')!, naples = datosCiudad('Nápoles, Italia')!, seville = datosCiudad('Sevilla, España')!;
  assert.equal(venice.en, 'Venice'); assert.equal(naples.en, 'Naples'); assert.equal(seville.en, 'Seville');
  for (const [t, curada] of [['Venecia, Estados Unidos', venice], ['Nápoles, Estados Unidos', naples], ['Sevilla, Colombia', seville], ['Florencia, Colombia', datosCiudad('Florencia, Italia')!],
    ['Colonia, Uruguay', datosCiudad('Colonia, Alemania')!], ['París, Estados Unidos', datosCiudad('París, Francia')!],
    ['Madrid, Colombia', datosCiudad('Madrid, España')!], ['Barcelona, Venezuela', datosCiudad('Barcelona, España')!]] as const) {
    const d = datosCiudad(t);
    if (d) assert.ok(km(d, curada) > 100, `${t} no debe resolverse al centro curado (${d.en})`);
  }
  assert.equal(datosCiudad('Madrid, Colombia')!.en, 'Madrid');
  assert.ok(km(datosCiudad('Madrid, Colombia')!, datosCiudad('Madrid, España')!) > 1000);
});

test('sin país en el texto la tabla manda (Madrid, Venecia, Sevilla)', () => {
  assert.equal(datosCiudad('Venecia')!.en, 'Venice');
  assert.equal(datosCiudad('Sevilla')!.en, 'Seville');
  assert.equal(datosCiudad('Madrid')!.en, 'Madrid');
});

test('si el catálogo no resuelve el homónimo, el nombre inglés y las variantes de la tabla se conservan (ruta SearchAPI con paisCodigo explícito)', () => {
  // «Florencia, Estados Unidos» con paisCodigo «it» explícito: el proveedor sigue buscando «Florence» y valida el país por su cuenta.
  assert.equal(consultaProveedorParaCiudad('Florencia, Estados Unidos'), 'Florence');
  assert.ok(variantesCiudad('Florencia, Estados Unidos').includes('florence'));
  assert.equal(datosCiudad('Florencia, Estados Unidos'), null, 'pero ya no se le atribuye el centro de Florencia (Italia)');
  // Si el catálogo SÍ lo resuelve, manda el catálogo.
  assert.equal(consultaProveedorParaCiudad('Cartagena, España'), 'Cartagena');
  assert.ok(!variantesCiudad('Cartagena, España').includes('cartagena de indias'));
});
