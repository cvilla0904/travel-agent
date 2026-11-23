// Informe sobre el catálogo REAL generado (src/geo/data/catalogo): tamaños, buckets, endpoint y nombres curados.
// Uso: npx tsx scripts/verificar-catalogo-real.ts   (tras npm run geo:preparar o geo:reempaquetar)
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';
import { verificarIntegridad } from '../src/geo/empaquetar.ts';
import { normalizar } from '../src/geo/normalizar.ts';
import { resolverDestino } from '../src/geo/resolver.ts';
import { crearHandler } from '../api/geo.ts';
import { CIUDADES_EQUIVALENTES } from '../src/services/ciudades.ts';

const dir = DIR_CATALOGO;
const kb = (b: number) => (b / 1024).toFixed(1) + ' KB';
const mb = (b: number) => (b / 1048576).toFixed(2) + ' MB';
const walk = (d: string): Array<[string, number]> => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : [[path.relative(dir, path.join(d, e.name)), fs.statSync(path.join(d, e.name)).size] as [string, number]]);

console.log('## 1. Integridad y metadatos');
console.log('integridad:', verificarIntegridad(dir).join('; ') || 'OK');
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
console.log(JSON.stringify({ ...meta, sha256: undefined }));

console.log('\n## 2. Tamaños de archivos');
const archivos = walk(dir);
const total = archivos.reduce((a, [, s]) => a + s, 0);
const paisesGz = archivos.filter(([n]) => n.startsWith('paises/'));
console.log(`total: ${mb(total)} en ${archivos.length} archivos`);
for (const [n, s] of archivos.filter(([n]) => !n.startsWith('paises/')).sort((a, b) => b[1] - a[1])) console.log(`  ${n}: ${mb(s)}`);
const gz = paisesGz.map(([, s]) => s).sort((a, b) => b - a);
console.log(`  paises/*.json.gz: ${paisesGz.length} archivos, ${mb(gz.reduce((a, b) => a + b, 0))} en total, mayor ${mb(gz[0] ?? 0)}, mediana ${kb(gz[gz.length >> 1] ?? 0)}`);
const mayores = paisesGz.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, s]) => `${n.slice(7, 9)} ${mb(s)}`).join(', ');
console.log(`  países más grandes: ${mayores}`);
const fichas = fs.statSync(path.join(dir, 'fichas.dat')).size;
console.log(`  ficha media: ${(fichas / meta.ciudades).toFixed(0)} bytes (${meta.ciudades} ciudades)`);

console.log('\n## 3. Buckets del índice');
const dirIdx = JSON.parse(fs.readFileSync(path.join(dir, 'indice-dir.json'), 'utf8')) as Record<string, [number, number]>;
const tam = Object.entries(dirIdx).map(([p, v]) => [p, v[1]] as [string, number]).sort((a, b) => a[1] - b[1]);
const pct = (q: number) => tam[Math.min(tam.length - 1, Math.floor(tam.length * q))]![1];
console.log(`buckets: ${tam.length} · mediana ${kb(pct(0.5))} · p90 ${kb(pct(0.9))} · p99 ${kb(pct(0.99))} · máximo ${kb(tam[tam.length - 1]![1])}`);
console.log('10 mayores:', tam.slice(-10).reverse().map(([p, s]) => `«${p}» ${kb(s)}`).join(', '));
console.log(`indice-dir.json: ${kb(fs.statSync(path.join(dir, 'indice-dir.json')).size)}`);

console.log('\n## 4. Endpoint real (handler de api/geo.ts)');
const cat = new Catalogo(fuenteEnDisco());
const handler = crearHandler(() => cat);
const llamar = (query: Record<string, string>) => {
  const res: any = { statusCode: 200, body: undefined, setHeader() { return res; }, status(c: number) { res.statusCode = c; return res; }, json(d: unknown) { res.body = d; return res; } };
  const t = process.hrtime.bigint(); handler({ method: 'GET', query }, res); return { res, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};
const consultas: Array<Record<string, string>> = [
  { q: 'mad' }, { q: 'san' }, { q: 'san seb' }, { q: 'sao' }, { q: 'são paulo' }, { q: 'москва' }, { q: '東京' }, { q: 'القاهرة' }, { q: 'bog' }, { q: 'mad', pais: 'ES' },
  { q: 'san', pais: 'CO' }, { q: 'valencia' }, { q: 'colombia' }, { q: 'toscana' }, { q: 'london' }, { q: 'zzzzqx' },
];
for (const c of consultas) {
  const a = llamar(c); const b = llamar(c); const body = a.res.body as any;
  const resumen = (body.resultados ?? []).slice(0, 4).map((r: any) => `${r.tipo[0]}:${r.nombre}/${r.codigoPais}${r.aeropuertos ? '[' + r.aeropuertos.join(',') + ']' : ''}`).join(' | ');
  console.log(`  ${JSON.stringify(c)} → ${a.res.statusCode} · ${body.total ?? '-'} res · ${JSON.stringify(body).length} B · 1ª ${a.ms.toFixed(1)} ms · 2ª ${b.ms.toFixed(2)} ms · ${resumen}`);
}
const m = process.memoryUsage(); console.log(`memoria tras las consultas: RSS ${mb(m.rss)}, heap ${mb(m.heapUsed)}`);

console.log('\n## 5. Nombres curados (ciudades.ts) frente al catálogo real');
let ok = 0; const fallos: string[] = [];
for (const g of CIUDADES_EQUIVALENTES) for (const nombre of g.nombres) {
  const r = buscarDestinos(cat, nombre, { limite: 12 });
  const hay = r.some((x) => x.tipo === 'ciudad' && normalizar(x.nombre) !== '' );
  const res = resolverDestino(cat, nombre);
  const encontrada = r.some((x) => x.tipo === 'ciudad') || res.estado !== 'no_encontrado';
  if (encontrada && hay) ok++; else fallos.push(`${g.consulta}: «${nombre}»`);
}
console.log(`nombres curados que el catálogo encuentra como ciudad: ${ok}; sin resultado: ${fallos.length}`);
if (fallos.length) console.log('SIN RESULTADO:', fallos.join('; '));
const noResuelven: string[] = [];
for (const g of CIUDADES_EQUIVALENTES) for (const nombre of g.nombres) {
  const res = resolverDestino(cat, nombre);
  if (res.estado === 'reconocido' && res.identidad.tipo === 'ciudad') continue;
  noResuelven.push(`${g.consulta}: «${nombre}» → ${res.estado}${res.estado === 'aclaracion' ? ' (' + res.candidatos.slice(0, 3).map((c) => c.nombre + '/' + c.pais).join(', ') + ')' : ''}`);
}
console.log(`resolverDestino sin resultado único de ciudad: ${noResuelven.length}`);
if (noResuelven.length) console.log(noResuelven.join('\n'));
