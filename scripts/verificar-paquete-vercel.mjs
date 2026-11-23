// Verificación del paquete de las funciones de Vercel SIN desplegar nada ni usar claves:
//  1) estima el tamaño real de cada función (código empaquetado + node_modules trazado con @vercel/nft + includeFiles);
//  2) emula el diseño de /var/task (LAMBDA_TASK_ROOT) con solo los archivos incluidos y lanza las consultas reales a api/geo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { nodeFileTrace } from '@vercel/nft';

const raiz = process.cwd();
const MB = (n) => (n / 1048576).toFixed(2) + ' MB';
const tam = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function recorrer(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, salida); else salida.push(p);
  }
  return salida;
}
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const datos = path.join(raiz, 'src/geo/data');
// includeFiles de vercel.json: "src/geo/data/{catalogo/**,regiones.json,destacados.json}"
const incluidos = [...recorrer(path.join(datos, 'catalogo')), path.join(datos, 'regiones.json'), path.join(datos, 'destacados.json')].filter((f) => fs.existsSync(f));
const bytesIncluidos = incluidos.reduce((a, f) => a + tam(f), 0);
console.log(`includeFiles: ${incluidos.length} archivos, ${MB(bytesIncluidos)}`);
for (const b of vercel.builds ?? []) console.log(`  vercel.json build ${b.src}: includeFiles=${b.config?.includeFiles}`);

const sim = path.join(raiz, '.sim-vercel');
fs.rmSync(sim, { recursive: true, force: true });
fs.mkdirSync(sim, { recursive: true });
const resumen = {};
for (const nombre of ['geo', 'chat']) {
  const salida = path.join(sim, `${nombre}.mjs`);
  const r = await build({
    entryPoints: [path.join(raiz, 'api', `${nombre}.ts`)], outfile: salida, bundle: true, platform: 'node', format: 'esm',
    packages: 'external', metafile: true, logLevel: 'error', target: 'node22',
  });
  const locales = Object.keys(r.metafile.inputs).filter((f) => !f.startsWith('node_modules'));
  const paquetes = new Set();
  for (const inp of Object.values(r.metafile.inputs)) for (const i of inp.imports) if (i.external && !i.path.startsWith('node:')) {
    const m = i.path.startsWith('@') ? i.path.split('/').slice(0, 2).join('/') : i.path.split('/')[0];
    paquetes.add(m);
  }
  const { fileList, warnings } = await nodeFileTrace([salida], { base: raiz, processCwd: raiz });
  const archivos = [...fileList].map((f) => path.join(raiz, f)).filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  const nm = archivos.filter((f) => f.includes(`${path.sep}node_modules${path.sep}`));
  const bytesNm = nm.reduce((a, f) => a + tam(f), 0);
  const bytesCodigo = tam(salida);
  const total = bytesCodigo + bytesNm + bytesIncluidos;
  const toca = (re) => locales.filter((f) => re.test(f));
  resumen[nombre] = { total };
  console.log(`\n== api/${nombre}.ts (estimación del paquete)`);
  console.log(`  código empaquetado: ${MB(bytesCodigo)} · módulos locales: ${locales.length} · paquetes externos: ${[...paquetes].join(', ') || 'ninguno'}`);
  console.log(`  node_modules trazado: ${nm.length} archivos, ${MB(bytesNm)}`);
  console.log(`  includeFiles (catálogo + regiones + destacados): ${MB(bytesIncluidos)}`);
  console.log(`  TOTAL estimado sin comprimir: ${MB(total)} (límite Vercel Functions: 250 MB sin comprimir) → ${total < 250 * 1048576 ? 'dentro del límite' : 'EXCEDE'}`);
  console.log(`  código local que lee el catálogo: ${toca(/src\/geo\//).map((f) => f.replace('src/geo/', '')).slice(0, 12).join(', ')}`);
  console.log(`  archivos de datos duplicados en el trazado (fuera de includeFiles): ${archivos.filter((f) => f.startsWith(datos)).length}`);
}

// Emulación de /var/task: solo bundle + includeFiles, y se lanza desde un cwd ajeno.
const tarea = fs.mkdtempSync(path.join(os.tmpdir(), 'var-task-'));
fs.mkdirSync(path.join(tarea, 'api'), { recursive: true });
fs.copyFileSync(path.join(sim, 'geo.mjs'), path.join(tarea, 'api', 'geo.mjs'));
for (const f of incluidos) { const d = path.join(tarea, path.relative(raiz, f)); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(f, d); }
process.env.LAMBDA_TASK_ROOT = tarea;
process.chdir(os.tmpdir());
const { default: handler } = await import(path.join(tarea, 'api', 'geo.mjs'));
const llamar = (q) => new Promise((ok) => {
  const res = { cab: {}, setHeader(k, v) { this.cab[k] = v; }, status(c) { this.codigo = c; return this; }, json(o) { ok({ codigo: this.codigo, cuerpo: o, cab: this.cab }); return this; } };
  handler({ method: 'GET', query: { q } }, res);
});
console.log(`\n== api/geo en un /var/task emulado (${tarea}), cwd=${process.cwd()}`);
for (const q of ['mad', 'san', 'san seb', 'são', 'моск', '東京', 'bog', 'bruselas', 'nueva york', 'zzzzqx']) {
  const { codigo, cuerpo } = await llamar(q);
  const lista = (cuerpo.resultados ?? []).slice(0, 3).map((r) => `${r.nombre ?? r.name}${r.pais ? ' (' + r.pais + ')' : ''}[${r.tipo ?? ''}${r.codigo ? ' ' + r.codigo : ''}]`).join(' · ');
  console.log(`  q=${JSON.stringify(q)} → HTTP ${codigo} total=${cuerpo.total ?? '-'} ${lista}${cuerpo.codigo ? ' código=' + cuerpo.codigo : ''}`);
}
// Caso 503: el mismo bundle en un /var/task SIN catálogo debe responder 503 CATALOGO_NO_GENERADO (nunca un 200 vacío).
const vacia = fs.mkdtempSync(path.join(os.tmpdir(), 'var-task-vacio-'));
fs.mkdirSync(path.join(vacia, 'api'), { recursive: true });
fs.copyFileSync(path.join(sim, 'geo.mjs'), path.join(vacia, 'api', 'geo.mjs'));
process.env.LAMBDA_TASK_ROOT = vacia;
const { default: handlerVacio } = await import(path.join(vacia, 'api', 'geo.mjs'));
await new Promise((ok) => {
  const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { console.log(`  sin catálogo: q="mad" → HTTP ${this.c} código=${o.codigo}`); ok(); return this; } };
  handlerVacio({ method: 'GET', query: { q: 'mad' } }, res);
});
fs.rmSync(sim, { recursive: true, force: true });
