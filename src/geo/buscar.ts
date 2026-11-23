import { Catalogo } from './catalogo.js';
import { normalizar } from './normalizar.js';
import { identidadDe } from './resolver.js';
import type { EntradaIndice, Identidad } from './tipos.js';

export interface ResultadoBusqueda {
  id: string;
  tipo: Identidad['tipo'];
  nombre: string;
  codigoPais: string | null;
  nombrePais: string | null;
  latitud?: number;
  longitud?: number;
  aeropuertos?: string[];
  coincidencia: 'exacta' | 'prefijo';
}

export const LONGITUD_MIN_CONSULTA = 3;
/** Los nombres chinos, japoneses y coreanos son cortos (東京, 서울): con dos caracteres ya son una consulta útil. */
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
export function longitudMinimaConsulta(clave: string): number { return CJK.test(clave) ? 2 : LONGITUD_MIN_CONSULTA; }
export function consultaValida(clave: string): boolean {
  const n = Array.from(clave).length;
  return n >= longitudMinimaConsulta(clave) && n <= LONGITUD_MAX_CONSULTA;
}
export const LONGITUD_MAX_CONSULTA = 100;
const PRIORIDAD_TIPO = { c: 0, p: 1, r: 2, a: 3 } as const;

interface Candidato { entrada: EntradaIndice; clave: string; exacta: boolean }

/**
 * Autocompletado: nombres que empiezan por `texto` (o coinciden exactamente), sin recorrer el índice completo.
 * Solo se lee el bucket del prefijo; las fichas se consultan únicamente para los `limite` resultados mostrados.
 * Orden: coincidencia exacta, ciudad > país > región > aeropuerto, población, nombre normalizado.
 */
export function buscarDestinos(cat: Catalogo, texto: string, opciones: { pais?: string; limite?: number } = {}): ResultadoBusqueda[] {
  const clave = normalizar(texto);
  const limite = Math.min(12, Math.max(1, opciones.limite ?? 8));
  const pais = opciones.pais?.toUpperCase();

  const mejores = new Map<string, Candidato>();
  for (const [nombre, entradas] of cat.buscarPrefijo(clave)) {
    const exacta = nombre === clave;
    for (const entrada of entradas) {
      if (pais && entrada[2] !== pais) continue;
      const id = `${entrada[0]}:${entrada[1]}`;
      const previo = mejores.get(id);
      if (!previo || (exacta && !previo.exacta) || (exacta === previo.exacta && nombre.length < previo.clave.length)) {
        mejores.set(id, { entrada, clave: nombre, exacta });
      }
    }
  }

  const ordenados = [...mejores.values()].sort((a, b) =>
    Number(b.exacta) - Number(a.exacta) ||
    PRIORIDAD_TIPO[a.entrada[0]] - PRIORIDAD_TIPO[b.entrada[0]] ||
    (b.entrada[3] ?? 0) - (a.entrada[3] ?? 0) ||
    a.clave.length - b.clave.length ||
    (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));

  const out: ResultadoBusqueda[] = [];
  for (const c of ordenados) {
    if (out.length >= limite) break;
    const identidad = identidadDe(cat, c.entrada);
    if (!identidad) continue;
    const p = identidad.pais ? cat.pais(identidad.pais) : undefined;
    out.push({
      id: identidad.id, tipo: identidad.tipo, nombre: identidad.nombre, codigoPais: identidad.pais, nombrePais: p?.nombre ?? null,
      ...(typeof identidad.lat === 'number' ? { latitud: identidad.lat } : {}),
      ...(typeof identidad.lon === 'number' ? { longitud: identidad.lon } : {}),
      ...(identidad.aeropuertos?.length ? { aeropuertos: identidad.aeropuertos } : {}),
      coincidencia: c.exacta ? 'exacta' : 'prefijo',
    });
  }
  return out;
}
