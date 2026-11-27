// validarUbicacion: los alias cortos de ciudad no coinciden por subcadena accidental (palabra completa).
import test from 'node:test';
import assert from 'node:assert/strict';
import { direccionNombraCiudad, validarUbicacion } from '../src/services/hoteles-apify-normalizar.js';
import { datosCiudad, variantesCiudad } from '../src/services/ciudades.js';

test('direccionNombraCiudad: palabra completa, no subcadena', () => {
  assert.equal(direccionNombraCiudad('Váci utca 1, Budapest, Hungría', 'budapest'), true);
  assert.equal(direccionNombraCiudad('Váci utca 1, Budapest', 'bud'), false, '«bud» está dentro de «Budapest»');
  assert.equal(direccionNombraCiudad('Calle Mayor 3, Madison, WI', 'mad'), false);
  assert.equal(direccionNombraCiudad('Calle Mayor 3, Madrid', 'mad'), false);
  assert.equal(direccionNombraCiudad('Jalan Raya, Bogor, Indonesia', 'bog'), false);
  assert.equal(direccionNombraCiudad('Calle 100, Bogotá D.C., Colombia', 'bogota d.c.'), true, 'variante con signos y espacios');
  assert.equal(direccionNombraCiudad('Corniche, El Cairo, Egipto', 'el cairo'), true);
  assert.equal(direccionNombraCiudad('Corniche, Cairo', 'el cairo'), false);
  assert.equal(direccionNombraCiudad('Av. Madrid 5, Valencia', 'madrid'), true, 'palabra completa legítima (calle con ese nombre): sigue aceptándose solo en 8–30 km');
  assert.equal(direccionNombraCiudad('', 'madrid'), false);
  assert.equal(direccionNombraCiudad('Madrid', ''), false);
});

test('un alias corto ya no hace aceptar un hotel a 8–30 km de otra ciudad', () => {
  // Madrid: la variante corta «mad» (IATA) estaba en la lista; antes bastaba que «Madison»/«Madera» la contuvieran.
  const d = datosCiudad('Madrid, España')!;
  const opciones = { paisCodigo: 'ES', centro: { lat: d.lat, lng: d.lng }, nombresCiudad: variantesCiudad('Madrid, España') };
  const a15km = { latitude: d.lat + 0.135, longitude: d.lng, countryCode: 'ES' };
  assert.equal(validarUbicacion({ ...a15km, address: 'Calle del Mar 2, Madera de Abajo' }, opciones).ok, false);
  assert.equal(validarUbicacion({ ...a15km, address: 'Calle Real 1, Alcobendas, Madrid' }, opciones).ok, true, 'la dirección nombra Madrid: se acepta');
  assert.equal(validarUbicacion({ ...a15km, address: 'Calle Real 1, Alcobendas' }, opciones).ok, false);
});

test('Budapest y Salento: los casos legítimos se conservan', () => {
  const b = datosCiudad('Budapest, Hungría')!;
  const ob = { paisCodigo: 'HU', centro: { lat: b.lat, lng: b.lng }, nombresCiudad: variantesCiudad('Budapest, Hungría') };
  assert.equal(validarUbicacion({ latitude: b.lat + 0.1, longitude: b.lng, countryCode: 'HU', address: 'Fő utca 2, Budapest' }, ob).ok, true);
  assert.equal(validarUbicacion({ latitude: b.lat + 0.1, longitude: b.lng, countryCode: 'HU', address: 'Fő utca 2, Budaörs' }, ob).ok, false, 'Budaörs no es Budapest');
  const s = datosCiudad('Salento, Quindío, Colombia')!;
  const os = { paisCodigo: 'CO', centro: { lat: s.lat, lng: s.lng }, nombresCiudad: variantesCiudad('Salento, Quindío, Colombia') };
  assert.equal(validarUbicacion({ latitude: s.lat + 0.1, longitude: s.lng, countryCode: 'CO', address: 'Vereda Cocora, Salento, Quindío' }, os).ok, true);
  assert.equal(validarUbicacion({ latitude: s.lat + 0.1, longitude: s.lng, countryCode: 'CO', address: 'Carrera 14, Armenia, Quindío' }, os).ok, false);
});
