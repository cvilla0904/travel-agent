// Mide latencia y memoria del catálogo v2.
//   npx tsx scripts/medir-catalogo-geo.ts            → catálogo REAL de src/geo/data/catalogo (si existe)
//   npx tsx scripts/medir-catalogo-geo.ts --sintetico → catálogo SINTÉTICO de 172.000 ciudades en un directorio temporal
// Los datos sintéticos NO son geografía real: solo sirven para estimar escala (tamaño de archivos, tiempos, memoria).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { escribirCatalogo } from '../src/geo/empaquetar.ts';
import { resolverDestino } from '../src/geo/resolver.ts';
import type { Indice, Pais, ShardPais, EntradaIndice } from '../src/geo/tipos.ts';

const sintetico = process.argv.includes('--sintetico');
const iDir = process.argv.indexOf('--dir');
let dir = iDir > 0 ? path.resolve(process.argv[iDir + 1]!) : DIR_CATALOGO;
let temporal: string | undefined;
const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';

if (sintetico && iDir < 0) {
  temporal = dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-sint-'));
  let semilla = 12345;
  const rnd = () => ((semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const sil = ['san', 'santa', 'mad', 'bar', 'por', 'mon', 'vil', 'lon', 'new', 'tor', 'ber', 'kra', 'sha', 'ban', 'cal', 'dal', 'gra', 'hel', 'ist', 'jak'];
  const fin = ['ville', 'burg', 'ton', 'polis', 'grad', 'abad', 'pur', 'dorf', 'mar', 'dos', 'nia', 'lan'];
  const paises: Pais[] = []; const shards: Record<string, ShardPais> = {}; const nombres: Record<string, EntradaIndice[]> = {};
  for (let i = 0; i < 246; i++) { const iso = String.fromCharCode(65 + (i / 26 | 0)) + String.fromCharCode(65 + (i % 26)); paises.push({ iso, nombre: 'Pais ' + iso, nombres: ['pais ' + iso.toLowerCase()] }); shards[iso] = { iso, ciudades: {}, aeropuertos: {} }; }
  for (let i = 0; i < 172063; i++) {
    const iso = paises[(rnd() * 246) | 0]!.iso, id = `gn:${100000 + i}`;
    const nombre = `${sil[(rnd() * sil.length) | 0]}${fin[(rnd() * fin.length) | 0]}${i % 997}`;
    const pop = Math.floor(rnd() ** 4 * 5e6);
    const alt = [nombre + ' alt1', 'x' + nombre, nombre.split('').reverse().join('')];
    shards[iso]!.ciudades[id] = { id, nombre, nombreAscii: nombre, pais: iso, poblacion: pop, lat: rnd() * 180 - 90, lon: rnd() * 360 - 180, nombres: alt, aeropuertos: [] };
    for (const n of [nombre, ...alt]) (nombres[n] ??= []).push(['c', id, iso, pop]);
  }
  const indice: Indice = { v: 1, nombres };
  console.log(`[SINTÉTICO] claves de índice: ${Object.keys(nombres).length}`);
  console.log(`[SINTÉTICO] indice.json equivalente: ${mb(Buffer.byteLength(JSON.stringify(indice)))}`);
  escribirCatalogo(dir, { indice, paises, shards });
  // La memoria se mide en un proceso aparte para no contar las estructuras usadas al generar los datos.
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, '--sintetico', '--dir', dir], { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(dir, 'meta.json'))) { console.error('No hay catálogo v2. Ejecuta npm run geo:reempaquetar o geo:preparar.'); process.exit(1); }
const du = (d: string): number => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? du(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`${sintetico ? '[SINTÉTICO]' : '[REAL]'} catalogo/: ${mb(du(dir))} en total · indice.dat ${mb(fs.statSync(path.join(dir, 'indice.dat')).size)} · fichas.dat ${mb(fs.statSync(path.join(dir, 'fichas.dat')).size)}`);

const consultas = sintetico ? ['san', 'santa', 'mad', 'londonville', 'zzz'] : ['mad', 'san', 'san seb', 'são', 'москв', '東京', 'bog', 'lon', 'new', 'zzzzz'];
const t0 = process.hrtime.bigint();
const cat = new Catalogo(fuenteEnDisco(dir, path.resolve(import.meta.dirname, '../src/geo/data')));
const ms = (a: bigint) => Number(process.hrtime.bigint() - a) / 1e6;
const filas: string[] = [];
for (const q of consultas) {
  const a = process.hrtime.bigint(); const r = buscarDestinos(cat, q); const frio = ms(a);
  const b = process.hrtime.bigint(); buscarDestinos(cat, q); const caliente = ms(b);
  filas.push(`  «${q}»: ${r.length} resultados · 1ª (frío) ${frio.toFixed(1)} ms · 2ª ${caliente.toFixed(2)} ms · primeros: ${r.slice(0, 3).map((x) => x.nombre).join(', ')}`);
}
console.log('Autocompletado (incluye el arranque en la primera consulta):'); filas.forEach((f) => console.log(f));
const a = process.hrtime.bigint(); try { resolverDestino(cat, sintetico ? 'zzz' : 'Madrid'); } catch (e) { console.log(String(e)); }
console.log(`resolverDestino: ${ms(a).toFixed(1)} ms`);
// Peor caso: el prefijo con más claves.
const dirIdx = JSON.parse(fs.readFileSync(path.join(dir, 'indice-dir.json'), 'utf8')) as Record<string, [number, number]>;
const mayor = Object.entries(dirIdx).sort((x, y) => y[1][1] - x[1][1])[0]!;
const c = process.hrtime.bigint(); const grande = buscarDestinos(cat, mayor[0]); console.log(`Bucket más grande «${mayor[0]}» (${(mayor[1][1] / 1024).toFixed(0)} KB comprimidos): ${ms(c).toFixed(1)} ms, ${grande.length} resultados`);
const m = process.memoryUsage();
console.log(`Memoria tras las consultas: RSS ${mb(m.rss)} · heap ${mb(m.heapUsed)} · tiempo total ${ms(t0).toFixed(0)} ms`);
const tam = JSON.stringify({ ok: true, resultados: buscarDestinos(cat, consultas[0]!) }).length;
console.log(`Tamaño de la respuesta de «${consultas[0]}»: ${tam} bytes`);
