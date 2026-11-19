import { Catalogo } from './catalogo.js';
import { resolverDestino } from './resolver.js';
import { distanciaKm } from './normalizar.js';
import type { Aeropuerto, Ciudad } from './tipos.js';

export const MAX_CIUDADES_PAIS = 5;
export const RADIO_METROPOLITANO_KM = 50;
/** Pesos de la fórmula (documentados en src/geo/README.md). */
export const PESOS = { tipoAeropuerto: 0.45, poblacion: 0.35, variosAeropuertos: 0.20 };
const POBLACION_REF = 30_000_000;

export interface CiudadSeleccionada {
  ciudad: Ciudad;
  aeropuertos: Aeropuerto[];
  principal: Aeropuerto;
  motivo: 'editorial' | 'puntuacion';
  puntuacion: number;
}
export interface SeleccionPais {
  pais: string;
  ciudades: CiudadSeleccionada[];
  /** Incidencias: destacados que no se pudieron resolver o sin aeropuerto comercial. */
  avisos: string[];
}

function puntuar(c: Ciudad, aeropuertos: Aeropuerto[]): number {
  const tipo = aeropuertos.some((a) => a.tipo === 'large') ? 1 : 0.5;
  const pob = Math.min(1, Math.log10(Math.max(c.poblacion, 1)) / Math.log10(POBLACION_REF));
  const varios = aeropuertos.length >= 3 ? 1 : aeropuertos.length === 2 ? 0.5 : 0;
  return PESOS.tipoAeropuerto * tipo + PESOS.poblacion * pob + PESOS.variosAeropuertos * varios;
}

/**
 * Hasta `max` ciudades de llegada de un país.
 * 1) Las del archivo editorial destacados.json (en su orden), si tienen aeropuerto comercial.
 * 2) El resto por puntuación: tipo de aeropuerto, población (escala logarítmica) y nº de aeropuertos.
 * Los aeropuertos del mismo área urbana (≤ 50 km) cuentan como una sola ciudad.
 * El catálogo no incluye rutas ni tráfico de pasajeros: la conectividad real se comprueba al buscar vuelos.
 */
export function seleccionarCiudadesPais(cat: Catalogo, iso: string, max = MAX_CIUDADES_PAIS): SeleccionPais {
  const pais = iso.toUpperCase();
  const shard = cat.shard(pais);
  const avisos: string[] = [];
  if (!shard) return { pais, ciudades: [], avisos: [`No hay datos del país ${pais} en el catálogo.`] };

  const conAeropuerto = (c: Ciudad) => c.aeropuertos.map((i) => shard.aeropuertos[i]).filter((a): a is Aeropuerto => !!a);
  const elegidas: CiudadSeleccionada[] = [];
  const lejosDeElegidas = (c: Ciudad) => elegidas.every((e) => distanciaKm(c, e.ciudad) > RADIO_METROPOLITANO_KM);
  const meter = (c: Ciudad, motivo: 'editorial' | 'puntuacion') => {
    const aeropuertos = conAeropuerto(c).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'large' ? -1 : 1));
    if (!aeropuertos.length || !lejosDeElegidas(c)) return false;
    elegidas.push({ ciudad: c, aeropuertos, principal: aeropuertos[0]!, motivo, puntuacion: puntuar(c, aeropuertos) });
    return true;
  };

  for (const nombre of cat.destacados().paises[pais]?.ciudades ?? []) {
    if (elegidas.length >= max) break;
    const r = resolverDestino(cat, nombre, { pais });
    if (r.estado !== 'reconocido' || r.identidad.tipo !== 'ciudad') { avisos.push(`Destacado «${nombre}» no resuelto de forma única en el catálogo.`); continue; }
    const c = shard.ciudades[r.identidad.id]!;
    if (!meter(c, 'editorial')) avisos.push(`Destacado «${nombre}» sin aeropuerto comercial propio o ya cubierto por otra ciudad cercana.`);
  }

  const resto = Object.values(shard.ciudades)
    .filter((c) => conAeropuerto(c).length > 0 && !elegidas.some((e) => e.ciudad.id === c.id))
    .map((c) => ({ c, p: puntuar(c, conAeropuerto(c)) }))
    .sort((a, b) => b.p - a.p || b.c.poblacion - a.c.poblacion);
  for (const { c } of resto) { if (elegidas.length >= max) break; meter(c, 'puntuacion'); }

  return { pais, ciudades: elegidas.slice(0, max), avisos };
}
