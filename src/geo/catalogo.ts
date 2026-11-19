import fs from 'node:fs';
import path from 'node:path';
import type { Aeropuerto, Ciudad, Destacados, Indice, Pais, Region, ShardPais } from './tipos.js';

/** Origen de los datos: permite inyectar un catálogo de prueba sin tocar el disco. */
export interface Fuente {
  indice(): Indice;
  paises(): Pais[];
  pais(iso: string): ShardPais | undefined;
  regiones(): Region[];
  destacados(): Destacados;
}

export class CatalogoNoDisponible extends Error {
  constructor(detalle: string) {
    super(`El catálogo geográfico no está generado (${detalle}). Ejecuta scripts/construir-catalogo-geo.ts con los archivos de GeoNames y OurAirports.`);
    this.name = 'CatalogoNoDisponible';
  }
}

export class Catalogo {
  constructor(private fuente: Fuente) {}
  indice() { return this.fuente.indice(); }
  paises() { return this.fuente.paises(); }
  regiones() { return this.fuente.regiones(); }
  destacados() { return this.fuente.destacados(); }
  shard(iso: string): ShardPais | undefined { return this.fuente.pais(iso.toUpperCase()); }
  ciudad(id: string, iso: string): Ciudad | undefined { return this.shard(iso)?.ciudades[id]; }
  aeropuerto(iata: string, iso: string): Aeropuerto | undefined { return this.shard(iso)?.aeropuertos[iata.toUpperCase()]; }
  /** Busca un aeropuerto por IATA en los países indicados (o en el índice si no se indica). */
  aeropuertoPorIata(iata: string): Aeropuerto | undefined {
    const e = this.indice().nombres[iata.toLowerCase()]?.find((x) => x[0] === 'a');
    return e ? this.aeropuerto(iata, e[2]) : undefined;
  }
}

/** Fuente real: lee src/geo/data (índice una vez; cada país solo cuando se necesita). */
export function fuenteEnDisco(dir = path.join(import.meta.dirname, 'data')): Fuente {
  let indice: Indice | undefined;
  let paises: Pais[] | undefined;
  const shards = new Map<string, ShardPais | undefined>();
  const leer = <T>(f: string): T => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as T; }
    catch (e) { throw new CatalogoNoDisponible(f); }
  };
  return {
    indice: () => (indice ??= leer<Indice>('indice.json')),
    paises: () => (paises ??= leer<Pais[]>('paises.json')),
    pais: (iso) => {
      if (!shards.has(iso)) {
        const f = path.join(dir, 'paises', `${iso}.json`);
        shards.set(iso, fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as ShardPais) : undefined);
      }
      return shards.get(iso);
    },
    regiones: () => leer<Region[]>('regiones.json'),
    destacados: () => leer<Destacados>('destacados.json'),
  };
}
