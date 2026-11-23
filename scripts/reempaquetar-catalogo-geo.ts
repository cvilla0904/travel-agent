// Convierte el catálogo antiguo (indice.json + paises/XX.json en src/geo/data) al formato v2 (src/geo/data/catalogo),
// sin volver a descargar nada. No borra ni modifica los archivos antiguos.
// Uso: npx tsx scripts/reempaquetar-catalogo-geo.ts [carpeta-de-datos]   (por defecto src/geo/data)
import fs from 'node:fs';
import path from 'node:path';
import { escribirCatalogo, verificarIntegridad } from '../src/geo/empaquetar.ts';
import type { Indice, Pais, ShardPais } from '../src/geo/tipos.ts';

const dir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, '../src/geo/data'));
const leer = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T;
if (!fs.existsSync(path.join(dir, 'indice.json'))) { console.error('No hay catálogo antiguo (src/geo/data/indice.json). Ejecuta npm run geo:preparar.'); process.exit(1); }

const indice = leer<Indice>('indice.json');
const paises = leer<Pais[]>('paises.json');
const shards: Record<string, ShardPais> = {};
for (const f of fs.readdirSync(path.join(dir, 'paises'))) {
  if (f.endsWith('.json')) shards[f.replace('.json', '')] = leer<ShardPais>(`paises/${f}`);
}
// El formato antiguo no guardaba población en el índice: se completa desde las fichas de ciudad.
const poblacion = new Map<string, number>();
for (const s of Object.values(shards)) for (const c of Object.values(s.ciudades)) poblacion.set(c.id, c.poblacion);
let completadas = 0;
for (const entradas of Object.values(indice.nombres)) {
  entradas.forEach((e, i) => { if (e[0] === 'c' && e.length === 3) { entradas[i] = [e[0], e[1], e[2], poblacion.get(e[1]) ?? 0]; completadas++; } });
}
const meta = escribirCatalogo(path.join(dir, 'catalogo'), { indice, paises, shards });
const problemas = verificarIntegridad(path.join(dir, 'catalogo'));
if (problemas.length) throw new Error('Verificación fallida: ' + problemas.join('; '));
console.log(`Reempaquetado: ${meta.ciudades} ciudades, ${meta.aeropuertos} aeropuertos, ${meta.paises} países, ${meta.buckets} buckets (${completadas} entradas con población añadida).`);
