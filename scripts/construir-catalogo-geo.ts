// Genera src/geo/data a partir de los archivos de GeoNames y OurAirports.
// Uso: npx tsx scripts/construir-catalogo-geo.ts <carpeta-con-archivos>
// Archivos esperados: cities1000.txt, countryInfo.txt, airports.csv y (opcional) alternateNamesV2.txt.
import fs from 'node:fs';
import path from 'node:path';
import { CIUDADES_EQUIVALENTES } from '../src/services/ciudades.ts';
import { escribirCatalogo, verificarIntegridad } from '../src/geo/empaquetar.ts';
import {
  aeropuertosComerciales, construirCatalogo, parsearCountryInfo, parsearCsv, parsearGeoNames, parsearNombresAlternos,
} from '../src/geo/construir.ts';

const entrada = process.argv[2];
if (!entrada) { console.error('Uso: npx tsx scripts/construir-catalogo-geo.ts <carpeta>'); process.exit(1); }
const dirDatos = path.resolve(import.meta.dirname, '../src/geo/data');
const leer = (f: string, obligatorio = true) => {
  const p = path.join(entrada, f);
  if (!fs.existsSync(p)) { if (obligatorio) { console.error(`Falta ${p}`); process.exit(1); } return null; }
  return fs.readFileSync(p, 'utf8');
};

const geonames = parsearGeoNames(leer('cities1000.txt')!);
const paises = parsearCountryInfo(leer('countryInfo.txt')!);
const aeropuertos = aeropuertosComerciales(parsearCsv(leer('airports.csv')!));
const regiones = JSON.parse(fs.readFileSync(path.join(dirDatos, 'regiones.json'), 'utf8'));
const curados = JSON.parse(fs.readFileSync(path.join(dirDatos, 'paises-curados.json'), 'utf8')) as Record<string, string[]>;
const nombrePaisEs = new Intl.DisplayNames(['es'], { type: 'region' });
const nombrePaisEn = new Intl.DisplayNames(['en'], { type: 'region' });
for (const p of paises) {
  const es = nombrePaisEs.of(p.iso);
  const en = nombrePaisEn.of(p.iso);
  curados[p.iso] = [...new Set([...(es && es !== p.iso ? [es] : []), ...(en && en !== p.iso ? [en] : []), ...(curados[p.iso] ?? [])])];
}
if (geonames.length < 1000 || paises.length < 100 || aeropuertos.length < 500) {
  throw new Error('Fuentes incompletas o mal interpretadas: ciudades=' + geonames.length + ', países=' + paises.length + ', aeropuertos=' + aeropuertos.length + '. No se ha escrito el catálogo.');
}

let nombresAlternos: Map<string, string[]> | undefined;
const v2 = leer('alternateNamesV2.txt', false);
if (v2) {
  const idiomasPais = new Map(paises.map((p) => [p.geonameid, p.iso]));
  const idiomasPorIso = new Map(paises.map((p) => [p.iso, new Set(['es', 'en', ...p.idiomas])]));
  const paisDeCiudad = new Map(geonames.map((c) => [c.id, c.pais]));
  nombresAlternos = parsearNombresAlternos(v2, (geoid) => {
    const iso = paisDeCiudad.get(geoid) ?? idiomasPais.get(geoid);
    return iso ? idiomasPorIso.get(iso)! : new Set<string>();
  });
}

const r = construirCatalogo({ geonames, paises, aeropuertos, nombresPaisCurados: curados, regiones, ciudadesCuradas: CIUDADES_EQUIVALENTES, ...(nombresAlternos ? { nombresAlternos } : {}) });
const dirCatalogo = path.join(dirDatos, 'catalogo');
const meta = escribirCatalogo(dirCatalogo, r);
const problemas = verificarIntegridad(dirCatalogo);
if (problemas.length) throw new Error('El catálogo escrito no supera la verificación: ' + problemas.join('; '));

const tam = (f: string) => fs.statSync(path.join(dirCatalogo, f)).size;
console.log(`Ciudades (GeoNames cities1000): ${meta.ciudades} · aeropuertos comerciales: ${meta.aeropuertos} · sin ciudad cercana: ${r.sinCiudad.length}`);
console.log(`catalogo/: ${meta.buckets} buckets · indice.dat ${(tam('indice.dat') / 1024).toFixed(0)} KB · fichas.dat ${(tam('fichas.dat') / 1024).toFixed(0)} KB · ${meta.paises} países`);
if (r.curadasSinCiudad.length) console.log('Grupos de ciudades curadas SIN ciudad en el catálogo (revisar):', r.curadasSinCiudad.join(', '));
if (r.sinCiudad.length) console.log('Aeropuertos sin ciudad (revisar):', r.sinCiudad.join(' '));
