import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { FORMATO_CATALOGO, LONGITUD_PREFIJO, fichaDesdeFila, geonameid, prefijoBucket, type DirIndice } from './empaquetar.js';
import type {
  Aeropuerto, Ciudad, Destacados, Indice, EntradaIndice, FichaCiudad, MetaCatalogo, Pais, PreferidoCatalogo, Region, ShardPais,
} from './tipos.js';

/**
 * Origen de los datos. Ninguna operación exige cargar el catálogo completo:
 * - entradas / buscarPrefijo leen UN bucket (los primeros 3 caracteres de la clave);
 * - ficha lee UNA ciudad por su id de GeoNames;
 * - pais carga el archivo de un país (solo para selección de ciudades y acceso aéreo).
 */
export interface Fuente {
  /** Entradas cuyo nombre normalizado es exactamente `clave`. */
  entradas(clave: string): EntradaIndice[];
  /** Nombres normalizados que empiezan por `clave`, con sus entradas (sin orden garantizado). */
  buscarPrefijo(clave: string): Array<[string, EntradaIndice[]]>;
  ficha(id: string): FichaCiudad | undefined;
  aeropuertos(): Record<string, Aeropuerto>;
  /** nombre normalizado → ciudad curada preferida, generado a partir de las ciudades curadas (puede estar vacío). */
  preferidos(): Record<string, PreferidoCatalogo>;
  paises(): Pais[];
  pais(iso: string): ShardPais | undefined;
  regiones(): Region[];
  destacados(): Destacados;
}

export class CatalogoNoDisponible extends Error {
  constructor(detalle: string) {
    super(`El catálogo geográfico no está generado (${detalle}). Ejecuta «npm run geo:preparar» (o convierte un catálogo v2 con «npm run geo:reclasificar»).`);
    this.name = 'CatalogoNoDisponible';
  }
}

export class Catalogo {
  private porIso?: Map<string, Pais>;
  private porRegion?: Map<string, Region>;
  constructor(private fuente: Fuente) {}
  entradas(clave: string) { return this.fuente.entradas(clave); }
  buscarPrefijo(clave: string) { return this.fuente.buscarPrefijo(clave); }
  ficha(id: string) { return this.fuente.ficha(id); }
  paises() { return this.fuente.paises(); }
  pais(iso: string): Pais | undefined {
    this.porIso ??= new Map(this.fuente.paises().map((p) => [p.iso, p]));
    return this.porIso.get(iso);
  }
  regiones() { return this.fuente.regiones(); }
  region(id: string): Region | undefined {
    this.porRegion ??= new Map(this.fuente.regiones().map((r) => [r.id, r]));
    return this.porRegion.get(id);
  }
  destacados() { return this.fuente.destacados(); }
  /** País preferido para un nombre repetido: primero el editorial (destacados.json), luego el derivado de las ciudades curadas. */
  preferido(clave: string): { pais: string; id?: string } | undefined {
    const editorial = this.fuente.destacados().preferidos[clave];
    const curada = this.fuente.preferidos()[clave];
    // El país editorial prevalece; si la ciudad curada es de ese mismo país, se aprovecha su id para desempatar
    // entre varias entidades del país («London» y «City of London»).
    if (editorial) return curada && curada.pais === editorial ? { pais: editorial, id: curada.id } : { pais: editorial };
    return curada;
  }
  shard(iso: string): ShardPais | undefined { return this.fuente.pais(iso.toUpperCase()); }
  /** Ciudad completa (con nombres alternativos). Carga el archivo del país: para una ficha ligera usa ficha(). */
  ciudad(id: string, iso: string): Ciudad | undefined { return this.shard(iso)?.ciudades[id]; }
  aeropuertoPorIata(iata: string): Aeropuerto | undefined { return this.fuente.aeropuertos()[iata.toUpperCase()]; }
  /** Todos los aeropuertos comerciales del catálogo (para resolver «Brussels Airport» por nombre). */
  todosAeropuertos(): Aeropuerto[] { return Object.values(this.fuente.aeropuertos()); }
  aeropuerto(iata: string, _iso?: string): Aeropuerto | undefined { return this.aeropuertoPorIata(iata); }
}

class Lru<K, V> {
  private m = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: K, v: V) {
    this.m.delete(k); this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }
}

/**
 * Carpeta de datos. En local y en pruebas es la contigua a este archivo; en una función de Vercel el código puede estar
 * empaquetado en otro sitio y los archivos de `includeFiles` conservan su ruta relativa a la raíz del proyecto
 * (LAMBDA_TASK_ROOT o el directorio de trabajo). Se usa el primer candidato que contiene el catálogo.
 */
function resolverDirDatos(): string {
  const candidatos = [
    path.join(import.meta.dirname, 'data'),
    ...(process.env.LAMBDA_TASK_ROOT ? [path.join(process.env.LAMBDA_TASK_ROOT, 'src', 'geo', 'data')] : []),
    path.join(process.cwd(), 'src', 'geo', 'data'),
  ];
  return candidatos.find((d) => fs.existsSync(path.join(d, 'catalogo', 'meta.json'))) ?? candidatos[0]!;
}
const DIR_DATOS = resolverDirDatos();
export const DIR_CATALOGO = path.join(DIR_DATOS, 'catalogo');

/** Lee `longitud` bytes de `desde` sin cargar el archivo entero. */
function leerTrozo(fd: number, desde: number, longitud: number): Buffer {
  const b = Buffer.alloc(longitud);
  let leidos = 0;
  while (leidos < longitud) {
    const n = fs.readSync(fd, b, leidos, longitud - leidos, desde + leidos);
    if (n <= 0) throw new Error('lectura truncada');
    leidos += n;
  }
  return b;
}

/**
 * Fuente real: lee src/geo/data/catalogo (formato v3).
 * Al arrancar solo se cargan el directorio de buckets y la tabla de fichas; cada consulta lee un bucket.
 */
export function fuenteEnDisco(dir = DIR_CATALOGO, dirEditorial = DIR_DATOS): Fuente {
  const leerJson = <T>(base: string, f: string): T => {
    try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf8')) as T; }
    catch { throw new CatalogoNoDisponible(path.join(path.basename(base), f)); }
  };
  const abrir = (f: string): number => {
    try { return fs.openSync(path.join(dir, f), 'r'); } catch { throw new CatalogoNoDisponible(`catalogo/${f}`); }
  };
  let listo: { dir: DirIndice; fdIndice: number; idx: Buffer; fdFichas: number; meta: MetaCatalogo } | undefined;
  const iniciar = () => {
    if (listo) return listo;
    const meta = leerJson<MetaCatalogo>(dir, 'meta.json');
    if (meta.formato !== FORMATO_CATALOGO) throw new CatalogoNoDisponible(`formato ${String(meta.formato)} no soportado`);
    let idx: Buffer;
    try { idx = fs.readFileSync(path.join(dir, 'fichas.idx')); } catch { throw new CatalogoNoDisponible('catalogo/fichas.idx'); }
    return (listo = { dir: leerJson<DirIndice>(dir, 'indice-dir.json'), fdIndice: abrir('indice.dat'), idx, fdFichas: abrir('fichas.dat'), meta });
  };

  const buckets = new Lru<string, Record<string, EntradaIndice[]>>(128);
  const bucket = (prefijo: string): Record<string, EntradaIndice[]> => {
    const hit = buckets.get(prefijo);
    if (hit) return hit;
    const l = iniciar();
    const pos = l.dir[prefijo];
    const datos = pos ? (JSON.parse(zlib.gunzipSync(leerTrozo(l.fdIndice, pos[0], pos[1])).toString('utf8')) as Record<string, EntradaIndice[]>) : {};
    buckets.set(prefijo, datos);
    return datos;
  };

  const fichas = new Lru<string, FichaCiudad | null>(2048);
  let aeropuertos: Record<string, Aeropuerto> | undefined;
  let preferidos: Record<string, PreferidoCatalogo> | undefined;
  let paises: Pais[] | undefined;
  let regiones: Region[] | undefined;
  let destacados: Destacados | undefined;
  const shards = new Lru<string, ShardPais | null>(6);

  return {
    entradas: (clave) => bucket(prefijoBucket(clave))[clave] ?? [],
    buscarPrefijo: (clave) => {
      const out: Array<[string, EntradaIndice[]]> = [];
      const recorrer = (b: Record<string, EntradaIndice[]>) => { for (const k in b) if (k.startsWith(clave)) out.push([k, b[k]!]); };
      if (Array.from(clave).length >= LONGITUD_PREFIJO) recorrer(bucket(prefijoBucket(clave)));
      else for (const p of Object.keys(iniciar().dir)) if (p.startsWith(clave)) recorrer(bucket(p));
      return out;
    },
    ficha: (id) => {
      const n = geonameid(id);
      if (n === undefined) return undefined;
      const hit = fichas.get(id);
      if (hit !== undefined) return hit ?? undefined;
      const { idx, fdFichas } = iniciar();
      let lo = 0, hi = idx.length / 12 - 1, ficha: FichaCiudad | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const v = idx.readUInt32LE(mid * 12);
        if (v === n) {
          const fila = JSON.parse(leerTrozo(fdFichas, idx.readUInt32LE(mid * 12 + 4), idx.readUInt32LE(mid * 12 + 8)).toString('utf8')) as unknown[];
          ficha = fichaDesdeFila(id, fila);
          break;
        }
        if (v < n) lo = mid + 1; else hi = mid - 1;
      }
      fichas.set(id, ficha);
      return ficha ?? undefined;
    },
    aeropuertos: () => (aeropuertos ??= (iniciar(), leerJson<Record<string, Aeropuerto>>(dir, 'aeropuertos.json'))),
    paises: () => (paises ??= (iniciar(), leerJson<Pais[]>(dir, 'paises.json'))),
    preferidos: () => (preferidos ??= (iniciar(), fs.existsSync(path.join(dir, 'preferidos.json')) ? leerJson<Record<string, PreferidoCatalogo>>(dir, 'preferidos.json') : {})),
    pais: (iso) => {
      iniciar();
      const hit = shards.get(iso);
      if (hit !== undefined) return hit ?? undefined;
      let s: ShardPais | null = null;
      if (/^[A-Z]{2}$/.test(iso)) {
        try { s = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'paises', `${iso}.json.gz`))).toString('utf8')) as ShardPais; } catch { s = null; }
      }
      shards.set(iso, s);
      return s ?? undefined;
    },
    regiones: () => (regiones ??= leerJson<Region[]>(dirEditorial, 'regiones.json')),
    destacados: () => (destacados ??= leerJson<Destacados>(dirEditorial, 'destacados.json')),
  };
}

/** Fuente en memoria (pruebas y utilidades): misma semántica que la de disco, sin empaquetar. */
export function fuenteEnMemoria(
  c: { indice: Indice; paises: Pais[]; shards: Record<string, ShardPais>; preferidos?: Record<string, PreferidoCatalogo> },
  editorial: { regiones: () => Region[]; destacados: () => Destacados },
): Fuente {
  const nombres = c.indice.nombres;
  const claves = Object.keys(nombres);
  const fichas = new Map<string, FichaCiudad>();
  const aeropuertos: Record<string, Aeropuerto> = {};
  for (const s of Object.values(c.shards)) {
    for (const x of Object.values(s.ciudades)) fichas.set(x.id, { id: x.id, nombre: x.nombre, nombreAscii: x.nombreAscii ?? x.nombre, pais: x.pais, poblacion: x.poblacion, lat: x.lat, lon: x.lon, aeropuertos: x.aeropuertos });
    for (const a of Object.values(s.aeropuertos)) aeropuertos[a.iata] = a;
  }
  return {
    entradas: (k) => nombres[k] ?? [],
    buscarPrefijo: (k) => claves.filter((x) => x.startsWith(k)).map((x) => [x, nombres[x]!]),
    ficha: (id) => fichas.get(id),
    aeropuertos: () => aeropuertos,
    preferidos: () => c.preferidos ?? {},
    paises: () => c.paises,
    pais: (iso) => c.shards[iso],
    regiones: editorial.regiones,
    destacados: editorial.destacados,
  };
}
