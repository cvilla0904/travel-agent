/**
 * Clasificación de las claves del índice en NOMBRE PROPIO / ALIAS (formato v3).
 *
 * Nombre propio de una entidad: su nombre, su nombre ASCII, los nombres editoriales curados (p. ej. «bruselas»), el código IATA
 * de un aeropuerto, los nombres de una región editorial y, en un país, su nombre GeoNames y los curados.
 * Alias: el resto de nombres alternativos de GeoNames (traducciones, transliteraciones, nombres históricos…).
 *
 * El constructor (construir.ts) aplica esta misma regla al crear el índice. Este módulo la aplica a un catálogo ya generado
 * (v2) sin volver a descargar GeoNames: invierte el índice para recuperar los nombres de cada ciudad y repite la asociación
 * de ciudades curadas, de modo que el resultado es idéntico al de reconstruir (lo comprueba un test de equivalencia).
 */
import { asociarCuradas, marcarPropio, type GrupoCurado } from './construir.js';
import { normalizar } from './normalizar.js';
import type { EntradaIndice, Indice, Pais, PreferidoCatalogo, Region } from './tipos.js';

export interface ContextoClasificacion {
  /** id de ciudad («gn:123») → nombre y nombre ASCII. */
  ciudades: Map<string, { nombre: string; ascii: string; pais: string; poblacion: number; aeropuertos?: string[] }>;
  paises: Pais[];
  /** ISO → nombres curados de país (paises-curados.json + nombres Intl). */
  nombresPaisCurados: Record<string, string[]>;
  regiones: Region[];
  curadas: GrupoCurado[];
}

/** Entrada en la forma v3 sin indicador (para comparar catálogos v2 y v3). */
export function sinIndicador(e: EntradaIndice): EntradaIndice {
  return e.length === 5 ? (e[0] === 'c' ? [e[0], e[1], e[2], e[3]] : [e[0], e[1], e[2]]) : e;
}

/** Quita el indicador de nombre propio a todo el índice (equivale a un índice v2). */
export function aFormatoV2(indice: Indice): Indice {
  const nombres: Indice['nombres'] = {};
  for (const [k, l] of Object.entries(indice.nombres)) nombres[k] = l.map(sinIndicador);
  return { v: 1, nombres };
}

/**
 * Marca como propio lo que lo es. No añade ni quita claves ni entradas: solo reordena la relevancia, no oculta nada.
 * `indice` puede venir ya clasificado o sin clasificar (se parte siempre de la forma sin indicador).
 */
export function clasificarIndice(indice: Indice, ctx: ContextoClasificacion): { indice: Indice; preferidos: Record<string, PreferidoCatalogo> } {
  const base = aFormatoV2(indice);
  // Nombres normalizados de cada ciudad, recuperados del índice (necesarios para asociar las ciudades curadas).
  const nombresDe = new Map<string, string[]>();
  for (const [k, l] of Object.entries(base.nombres)) {
    for (const e of l) if (e[0] === 'c') { const a = nombresDe.get(e[1]); if (a) a.push(k); else nombresDe.set(e[1], [k]); }
  }
  const lista = [...ctx.ciudades].map(([id, c]) => ({ id: id.replace(/^gn:/, ''), pais: c.pais, poblacion: c.poblacion, nombres: nombresDe.get(id) ?? [c.nombre, c.ascii] }));
  const { extraPorCiudad, preferidos } = asociarCuradas(lista, ctx.curadas);

  const propiosCiudad = new Map<string, Set<string>>();
  for (const [id, c] of ctx.ciudades) {
    propiosCiudad.set(id, new Set([normalizar(c.nombre), normalizar(c.ascii), ...(c.aeropuertos ?? []).map(normalizar), ...(extraPorCiudad.get(id.replace(/^gn:/, '')) ?? [])]));
  }
  const propiosPais = new Map(ctx.paises.map((p) => [`pais:${p.iso}`, new Set([normalizar(p.nombres[0] ?? p.nombre), ...(ctx.nombresPaisCurados[p.iso] ?? []).map(normalizar)])]));
  const propiosRegion = new Map(ctx.regiones.map((r) => [r.id, new Set([r.nombre, ...r.nombres].map(normalizar))]));

  // Los nombres curados se garantizan en el índice de su ciudad (como hace el constructor).
  for (const [id, curados] of extraPorCiudad) {
    const c = ctx.ciudades.get(`gn:${id}`);
    if (!c) continue;
    for (const n of curados) {
      const l = base.nombres[n] ?? (base.nombres[n] = []);
      if (!l.some((x) => x[0] === 'c' && x[1] === `gn:${id}`)) l.push(['c', `gn:${id}`, c.pais, c.poblacion]);
    }
  }

  const nombres: Indice['nombres'] = {};
  for (const [k, l] of Object.entries(base.nombres)) {
    nombres[k] = l.map((e) => {
      const propio = e[0] === 'a' ? true
        : e[0] === 'c' ? propiosCiudad.get(e[1])?.has(k) === true
        : e[0] === 'p' ? propiosPais.get(e[1])?.has(k) === true
        : propiosRegion.get(e[1])?.has(k) === true;
      return propio ? marcarPropio(e) : e;
    });
  }
  return { indice: { v: 1, nombres }, preferidos };
}
