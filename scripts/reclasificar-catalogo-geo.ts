// Convierte el catálogo en disco (v2 o v3) al formato v3: marca en el índice qué claves son nombres propios y cuáles alias.
// No descarga nada, no añade ni quita claves; solo reescribe indice.dat, indice-dir.json y meta.json.
// Uso: npx tsx scripts/reclasificar-catalogo-geo.ts [catalogo-origen] [catalogo-destino] [--tolerante]   (por defecto src/geo/data/catalogo, en el sitio)
import fs from 'node:fs';
import path from 'node:path';
import { clasificarIndice, type ContextoClasificacion } from '../src/geo/clasificar.ts';
import { leerFichasCompletas, leerIndiceCompleto, reescribirIndice, verificarIntegridad } from '../src/geo/empaquetar.ts';
import { CIUDADES_EQUIVALENTES } from '../src/services/ciudades.ts';
import type { Pais, Region } from '../src/geo/tipos.ts';
import type { CorreccionesAsociacion } from '../src/geo/construir.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dirDatos = path.resolve(import.meta.dirname, '../src/geo/data');
const origen = path.resolve(args[0] ?? path.join(dirDatos, 'catalogo'));
const destino = path.resolve(args[1] ?? origen);
const json = <T>(f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as T;

const paises = json<Pais[]>(path.join(origen, 'paises.json'));
const curados = json<Record<string, string[]>>(path.join(dirDatos, 'paises-curados.json'));
const es = new Intl.DisplayNames(['es'], { type: 'region' });
const en = new Intl.DisplayNames(['en'], { type: 'region' });
const nombresPaisCurados: Record<string, string[]> = {};
for (const p of paises) {
  const a = es.of(p.iso), b = en.of(p.iso);
  nombresPaisCurados[p.iso] = [...new Set([...(a && a !== p.iso ? [a] : []), ...(b && b !== p.iso ? [b] : []), ...(curados[p.iso] ?? [])])];
}
const ciudades = new Map(leerFichasCompletas(origen).map((f) => [f.id, { nombre: f.nombre, ascii: f.nombreAscii ?? f.nombre, pais: f.pais, poblacion: f.poblacion, aeropuertos: f.aeropuertos }]));
const ctx: ContextoClasificacion = { ciudades, paises, nombresPaisCurados, regiones: json<Region[]>(path.join(dirDatos, 'regiones.json')), curadas: CIUDADES_EQUIVALENTES, correcciones: json<CorreccionesAsociacion>(path.join(dirDatos, 'correcciones-asociacion.json')), tolerante: process.argv.includes('--tolerante') };

const t0 = Date.now();
const { indice, preferidos } = clasificarIndice(leerIndiceCompleto(origen), ctx);
const meta = reescribirIndice(origen, destino, indice, preferidos);
const problemas = verificarIntegridad(destino);
if (problemas.length) throw new Error('Verificación fallida: ' + problemas.join('; '));
let propios = 0, alias = 0;
for (const l of Object.values(indice.nombres)) for (const e of l) (e[4] === 1 ? propios++ : alias++);
console.log(`Catálogo v${meta.formato} escrito en ${destino} (${Date.now() - t0} ms): ${Object.keys(indice.nombres).length} claves, ${propios} entradas de nombre propio, ${alias} de alias.`);
