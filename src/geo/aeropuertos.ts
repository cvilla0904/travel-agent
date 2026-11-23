import { Catalogo } from './catalogo.js';
import { distanciaKm } from './normalizar.js';
import type { Aeropuerto, AeropuertoAcceso, Ciudad } from './tipos.js';

export const RADIO_ACCESO_KM = 200;
export const MAX_ACCESO = 3;

export interface AccesoAereo {
  /** Aeropuertos comerciales propios de la ciudad (catálogo). */
  propios: Aeropuerto[];
  /** Si no hay propios: aeropuertos de acceso del mismo país, con distancia en línea recta (aproximada). */
  acceso: Array<Aeropuerto & { distanciaKm: number; editorial: boolean }>;
}

/**
 * Aeropuertos para llegar a una ciudad. Nunca cambia el destino en silencio: si la ciudad no tiene
 * aeropuerto propio, los de acceso se devuelven marcados como tales y con su distancia.
 * Orden de las fuentes de acceso: 1) editorial documentada (destacados.acceso), 2) los más cercanos del catálogo.
 */
export function accesoAereoDeCiudad(cat: Catalogo, ciudad: Ciudad): AccesoAereo {
  const shard = cat.shard(ciudad.pais);
  const propios = ciudad.aeropuertos.map((i) => shard?.aeropuertos[i]).filter((a): a is Aeropuerto => !!a);
  if (propios.length || !shard) return { propios, acceso: [] };

  const editorial = cat.destacados().acceso[ciudad.id] ?? [];
  const lista = editorial.length
    ? editorial.map((i) => shard.aeropuertos[i]).filter((a): a is Aeropuerto => !!a).map((a) => ({ a, editorial: true }))
    : Object.values(shard.aeropuertos).map((a) => ({ a, editorial: false }));
  const acceso = lista
    .map(({ a, editorial }) => ({ ...a, distanciaKm: Math.round(distanciaKm(ciudad, a)), editorial }))
    .filter((a) => a.editorial || a.distanciaKm <= RADIO_ACCESO_KM)
    .sort((x, y) => x.distanciaKm - y.distanciaKm)
    .slice(0, MAX_ACCESO);
  return { propios: [], acceso };
}

/** Aeropuertos de acceso de una región (editorial, validada contra el catálogo) con distancia al centro. */
export function accesoAereoDeRegion(cat: Catalogo, regionId: string): { aeropuertos: AeropuertoAcceso[]; sinCatalogo: string[] } {
  const r = cat.region(regionId);
  if (!r) return { aeropuertos: [], sinCatalogo: [] };
  const aeropuertos: AeropuertoAcceso[] = [];
  const sinCatalogo: string[] = [];
  for (const iata of r.aeropuertosAcceso) {
    const a = cat.aeropuertoPorIata(iata);
    if (a) aeropuertos.push({ iata: a.iata, nombre: a.nombre, distanciaKm: Math.round(distanciaKm(r.centro, a)), esAcceso: true });
    else sinCatalogo.push(iata);
  }
  return { aeropuertos: aeropuertos.sort((x, y) => x.distanciaKm - y.distanciaKm), sinCatalogo };
}
