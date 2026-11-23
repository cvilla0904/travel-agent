/**
 * Formato v2 del catálogo en disco (se genera en desarrollo; en ejecución solo se lee).
 *
 *   catalogo/indice-dir.json     prefijo de 3 caracteres → [desplazamiento, longitud] dentro de indice.dat
 *   catalogo/indice.dat          buckets JSON {clave normalizada → entradas}, cada uno comprimido con gzip por separado
 *   catalogo/fichas.idx          tabla binaria ordenada de [geonameid, desplazamiento, longitud] (uint32 little-endian)
 *   catalogo/fichas.dat          fichas de ciudad en JSON (array), una tras otra
 *   catalogo/aeropuertos.json    todos los aeropuertos comerciales por IATA (unos miles: se carga entero)
 *   catalogo/paises.json         países
 *   catalogo/paises/XX.json.gz   ciudades y aeropuertos de un país (solo para operaciones por país)
 *   catalogo/meta.json           versión, fecha, recuentos y SHA-256 de cada archivo
 *
 * Una consulta lee el directorio (≈cientos de KB, una vez) y UN bucket (unos KB); nunca el índice completo.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Aeropuerto, FichaCiudad, Indice, MetaCatalogo, Pais, ShardPais } from './tipos.js';

export const FORMATO_CATALOGO = 2;
export const LONGITUD_PREFIJO = 3;

export type DirIndice = Record<string, [number, number]>;

/** Prefijo de bucket: primeros 3 caracteres (puntos de código, no unidades UTF-16: respeta Unicode). */
export function prefijoBucket(clave: string): string {
  return Array.from(clave).slice(0, LONGITUD_PREFIJO).join('');
}

export function empaquetarIndice(indice: Indice): { dir: DirIndice; datos: Buffer } {
  const grupos = new Map<string, Record<string, Indice['nombres'][string]>>();
  for (const [clave, entradas] of Object.entries(indice.nombres)) {
    const p = prefijoBucket(clave);
    let g = grupos.get(p);
    if (!g) { g = {}; grupos.set(p, g); }
    g[clave] = entradas;
  }
  const dir: DirIndice = {};
  const trozos: Buffer[] = [];
  let desplazamiento = 0;
  for (const p of [...grupos.keys()].sort()) {
    const comprimido = zlib.gzipSync(Buffer.from(JSON.stringify(grupos.get(p)), 'utf8'));
    dir[p] = [desplazamiento, comprimido.length];
    trozos.push(comprimido);
    desplazamiento += comprimido.length;
  }
  return { dir, datos: Buffer.concat(trozos) };
}

/** «gn:2800866» → 2800866. Las ciudades del catálogo siempre tienen id numérico de GeoNames. */
export function geonameid(id: string): number | undefined {
  const m = /^gn:(\d{1,10})$/.exec(id);
  return m ? Number(m[1]) : undefined;
}

export function empaquetarFichas(shards: Record<string, ShardPais>): { idx: Buffer; dat: Buffer; total: number } {
  const filas: Array<{ n: number; texto: string }> = [];
  for (const shard of Object.values(shards)) {
    for (const c of Object.values(shard.ciudades)) {
      const n = geonameid(c.id);
      if (n === undefined) throw new Error(`Id de ciudad no válido para el formato v2: ${c.id}`);
      // [nombre, ascii, país, población, lat, lon, aeropuertos]
      filas.push({ n, texto: JSON.stringify([c.nombre, c.nombreAscii ?? c.nombre, c.pais, c.poblacion, c.lat, c.lon, c.aeropuertos]) });
    }
  }
  filas.sort((a, b) => a.n - b.n);
  for (let i = 1; i < filas.length; i++) if (filas[i]!.n === filas[i - 1]!.n) throw new Error(`Id de ciudad duplicado: gn:${filas[i]!.n}`);
  const idx = Buffer.alloc(filas.length * 12);
  const trozos: Buffer[] = [];
  let desplazamiento = 0;
  filas.forEach((f, i) => {
    const b = Buffer.from(f.texto, 'utf8');
    idx.writeUInt32LE(f.n, i * 12);
    idx.writeUInt32LE(desplazamiento, i * 12 + 4);
    idx.writeUInt32LE(b.length, i * 12 + 8);
    trozos.push(b);
    desplazamiento += b.length;
  });
  return { idx, dat: Buffer.concat(trozos), total: filas.length };
}

export function fichaDesdeFila(id: string, f: unknown[]): FichaCiudad {
  return { id, nombre: f[0] as string, nombreAscii: f[1] as string, pais: f[2] as string, poblacion: f[3] as number, lat: f[4] as number, lon: f[5] as number, aeropuertos: f[6] as string[] };
}

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

export interface DatosEscritura {
  indice: Indice; paises: Pais[]; shards: Record<string, ShardPais>;
}

/** Escribe el catálogo v2 en `dir` (normalmente src/geo/data/catalogo). No toca otros archivos de src/geo/data. */
export function escribirCatalogo(dir: string, c: DatosEscritura, ahora = new Date()): MetaCatalogo {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'paises'), { recursive: true });
  const sumas: Record<string, string> = {};
  const escribir = (nombre: string, contenido: Buffer | string) => {
    fs.writeFileSync(path.join(dir, nombre), contenido);
    sumas[nombre] = sha(contenido);
  };

  const { dir: dirIdx, datos } = empaquetarIndice(c.indice);
  escribir('indice.dat', datos);
  escribir('indice-dir.json', JSON.stringify(dirIdx));
  const fichas = empaquetarFichas(c.shards);
  escribir('fichas.idx', fichas.idx);
  escribir('fichas.dat', fichas.dat);

  const aeropuertos: Record<string, Aeropuerto> = {};
  for (const s of Object.values(c.shards)) for (const a of Object.values(s.aeropuertos)) aeropuertos[a.iata] = a;
  escribir('aeropuertos.json', JSON.stringify(aeropuertos));
  escribir('paises.json', JSON.stringify(c.paises));
  for (const [iso, shard] of Object.entries(c.shards)) escribir(`paises/${iso}.json.gz`, zlib.gzipSync(Buffer.from(JSON.stringify(shard), 'utf8')));

  const meta: MetaCatalogo = {
    formato: FORMATO_CATALOGO, generado: ahora.toISOString(), ciudades: fichas.total,
    aeropuertos: Object.keys(aeropuertos).length, paises: c.paises.length, buckets: Object.keys(dirIdx).length, sha256: sumas,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  return meta;
}

/** Comprueba que los archivos de `dir` coinciden con meta.json. Devuelve los problemas encontrados (vacío = íntegro). */
export function verificarIntegridad(dir: string): string[] {
  const problemas: string[] = [];
  let meta: MetaCatalogo;
  try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as MetaCatalogo; }
  catch { return ['falta meta.json']; }
  if (meta.formato !== FORMATO_CATALOGO) problemas.push(`formato ${String(meta.formato)} (se esperaba ${FORMATO_CATALOGO})`);
  for (const [nombre, esperado] of Object.entries(meta.sha256)) {
    try { if (sha(fs.readFileSync(path.join(dir, nombre))) !== esperado) problemas.push(`${nombre}: SHA-256 distinto`); }
    catch { problemas.push(`${nombre}: no se puede leer`); }
  }
  return problemas;
}
