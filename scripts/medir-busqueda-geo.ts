/**
 * Mide la búsqueda de autocompletado sobre un catálogo real en disco: tiempo en frío (primera consulta de un proceso nuevo,
 * incluye abrir el directorio y leer el bucket) y en caliente (mediana y p95), y los 8 primeros resultados.
 *
 *   npx tsx scripts/medir-busqueda-geo.ts [dirCatalogo] [--json]
 *
 * Cada consulta en frío se mide en un proceso hijo para que no se beneficie de cachés de otra consulta.
 */
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';

const CONSULTAS = ['san', 'mad', 'bog', 'bruselas', '東京', 'zzzzqx'];
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dir = path.resolve(args[0] ?? DIR_CATALOGO);

if (process.env.MEDIR_UNA) {
  const q = process.env.MEDIR_UNA;
  const t0 = performance.now();
  const cat = new Catalogo(fuenteEnDisco(dir));
  const primera = buscarDestinos(cat, q);
  const frio = performance.now() - t0;
  const tiempos: number[] = [];
  for (let i = 0; i < 200; i++) { const t = performance.now(); buscarDestinos(cat, q); tiempos.push(performance.now() - t); }
  tiempos.sort((a, b) => a - b);
  console.log(JSON.stringify({ q, frio, medianaCaliente: tiempos[100]!, p95Caliente: tiempos[190]!, rss: process.memoryUsage().rss, resultados: primera }));
  process.exit(0);
}

const salida: any[] = [];
for (const q of CONSULTAS) {
  const reps: any[] = [];
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, dir], { env: { ...process.env, MEDIR_UNA: q }, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    reps.push(JSON.parse(r.stdout.trim().split('\n').pop()!));
  }
  const med = (k: string) => reps.map((x) => x[k]).sort((a, b) => a - b)[2];
  salida.push({ q, frioMs: med('frio'), calienteMedianaMs: med('medianaCaliente'), calienteP95Ms: med('p95Caliente'), rssMB: med('rss') / 1048576, resultados: reps[0].resultados });
}
if (process.argv.includes('--json')) { console.log(JSON.stringify(salida, null, 1)); process.exit(0); }
console.log(`Catálogo: ${dir}`);
for (const s of salida) {
  console.log(`\n"${s.q}"  frío ${s.frioMs.toFixed(1)} ms · caliente mediana ${s.calienteMedianaMs.toFixed(3)} ms (p95 ${s.calienteP95Ms.toFixed(3)}) · RSS ${s.rssMB.toFixed(0)} MB · ${s.resultados.length} resultados`);
  s.resultados.slice(0, 8).forEach((r: any) => console.log(`   ${String(r.coincidencia).padEnd(7)}${r.via ? ' ' + String(r.via).padEnd(6) : ''} ${r.nombre} (${r.codigoPais ?? '-'}) ${r.tipo}${r.alias ? '  ← alias «' + r.alias + '»' : ''}`));
}
