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
  /** 'nombre': coincide con un nombre propio de la entidad (nombre, ASCII, curado, IATA); 'alias': con una traducción, transliteración o nombre histórico. */
  via: 'nombre' | 'alias';
  /** Solo si via = 'alias': el alias (normalizado) que ha coincidido, distinto del nombre mostrado. */
  alias?: string;
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
/**
 * Un pueblo diminuto cuyo nombre coincide EXACTAMENTE con lo escrito no debe tapar a una gran ciudad que empieza igual
 * («buda» → Buda (Texas), Buda (Rumanía)… antes que Budapest; «rio» → Rio (EE. UU.) antes que Rio de Janeiro).
 * Solo si existe al menos una ciudad grande con ese prefijo, las coincidencias exactas de ciudades pequeñas se tratan como
 * coincidencias por prefijo (siguen apareciendo, ordenadas por población). Nada cambia si el nombre exacto es una ciudad
 * mediana o grande, un país, una región o un aeropuerto.
 */
export const POBLACION_CIUDAD_PEQUENA = 30_000;
export const POBLACION_CIUDAD_GRANDE = 300_000;
/** Solo para consultas cortas: una palabra más larga ya suele ser el nombre completo que la persona quería escribir. */
export const LONGITUD_MAX_CONSULTA_AMBIGUA = 6;

interface Candidato { entrada: EntradaIndice; clave: string; exacta: boolean; propio: boolean }
/** 0 nombre propio exacto · 1 nombre propio por prefijo · 2 alias exacto · 3 alias por prefijo. */
const nivel = (c: { exacta: boolean; propio: boolean }) => (c.propio ? 0 : 2) + (c.exacta ? 0 : 1);

/**
 * Autocompletado: nombres que empiezan por `texto` (o coinciden exactamente), sin recorrer el índice completo.
 * Solo se lee el bucket del prefijo; las fichas se consultan únicamente para los `limite` resultados mostrados.
 * Orden: 1) nombre propio exacto, 2) nombre propio por prefijo, 3) alias exacto, 4) alias por prefijo; dentro de cada nivel,
 * ciudad > país > región > aeropuerto, población y nombre normalizado. Los alias siguen siendo buscables: solo se ordenan después.
 * Cada entidad aparece una vez, con su mejor coincidencia (un nombre propio siempre gana a un alias).
 */
export function buscarDestinos(cat: Catalogo, texto: string, opciones: { pais?: string; limite?: number } = {}): ResultadoBusqueda[] {
  const clave = normalizar(texto);
  const limite = Math.min(12, Math.max(1, opciones.limite ?? 8));
  const pais = opciones.pais?.toUpperCase();

  const mejores = new Map<string, Candidato>();
  for (const [nombre, entradas] of cat.buscarPrefijo(clave)) {
    const exacta = nombre === clave;
    for (const entrada of entradas) {
      const propio = entrada[4] === 1;
      if (pais && entrada[2] !== pais) continue;
      const id = `${entrada[0]}:${entrada[1]}`;
      const previo = mejores.get(id);
      const nuevo = { exacta, propio };
      if (!previo || nivel(nuevo) < nivel(previo) || (nivel(nuevo) === nivel(previo) && nombre.length < previo.clave.length)) {
        mejores.set(id, { entrada, clave: nombre, exacta, propio });
      }
    }
  }

  const poblacion = (c: Candidato) => c.entrada[3] ?? 0;
  const hayGrande = Array.from(clave).length <= LONGITUD_MAX_CONSULTA_AMBIGUA && [...mejores.values()].some((c) => c.entrada[0] === 'c' && c.propio && !c.exacta && poblacion(c) >= POBLACION_CIUDAD_GRANDE);
  const nivelEfectivo = (c: Candidato) =>
    hayGrande && c.entrada[0] === 'c' && c.propio && c.exacta && poblacion(c) < POBLACION_CIUDAD_PEQUENA ? 1 : nivel(c);

  const ordenados = [...mejores.values()].sort((a, b) =>
    nivelEfectivo(a) - nivelEfectivo(b) ||
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
      via: c.propio ? 'nombre' : 'alias',
      ...(c.propio ? {} : { alias: c.clave }),
    });
  }
  return out;
}
