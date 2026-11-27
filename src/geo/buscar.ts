import { Catalogo } from './catalogo.js';
import { normalizar } from './normalizar.js';
import { identidadDe } from './resolver.js';
import { regionEditorial, todasRegionesEditoriales } from './regiones-editoriales.js';
import { DESTINOS_EDITORIALES, ORDEN_HOMONIMOS, type DestinoEditorial } from './destinos-editoriales.js';
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
  /** Región administrativa, solo cuando se conoce (regiones-editoriales.ts): «Quindío» para Salento (Colombia). */
  region?: string;
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
/** Fracción mínima del alias que debe estar escrita para sugerirlo cuando ya hay un nombre propio que encaja. */
const COBERTURA_MINIMA_ALIAS = 0.6;

interface Candidato { entrada: EntradaIndice; clave: string; exacta: boolean; propio: boolean; editorial?: DestinoEditorial }
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
  const consulta = partirConsulta(cat, texto);
  if (!consulta) return [];
  const clave = consulta.clave;
  const limite = Math.min(12, Math.max(1, opciones.limite ?? 8));
  const pais = opciones.pais?.toUpperCase();
  const paises = consulta.paises;
  const idsRegionAlternativa = consulta.idsRegionAlternativa;
  const paisesSugeridos = consulta.paisesSugeridos;

  const mejores = new Map<string, Candidato>();
  for (const [nombre, entradas] of cat.buscarPrefijo(clave)) {
    const exacta = nombre === clave;
    for (const entrada of entradas) {
      const propio = entrada[4] === 1;
      if (pais && entrada[2] !== pais) continue;
      if (paises && !paises.has(entrada[2]) && !(entrada[0] === 'c' && idsRegionAlternativa?.has(`${entrada[1]}`))) continue;
      const id = `${entrada[0]}:${entrada[1]}`;
      const previo = mejores.get(id);
      const nuevo = { exacta, propio };
      if (!previo || nivel(nuevo) < nivel(previo) || (nivel(nuevo) === nivel(previo) && nombre.length < previo.clave.length)) {
        mejores.set(id, { entrada, clave: nombre, exacta, propio });
      }
    }
  }

  // Los alias de GeoNames incluyen apodos y transliteraciones («paris of the north», «new york van java», «arubakaki»).
  // Un alias por PREFIJO es una sugerencia válida mientras se escribe, pero no cuando lo escrito ya es un nombre completo:
  // Si lo escrito (≥ 4 letras: los códigos IATA de 3 letras aún pueden estar a medias) coincide exactamente con algún nombre o alias,
  // los alias por prefijo se descartan: ya no se está completando nada.
  const completa = Array.from(clave).length >= 4 && [...mejores.values()].some((c) => c.exacta && c.entrada[0] !== 'a');
  // Mientras se escribe, si ya hay un nombre propio que encaja, un alias (de GeoNames) solo cuenta si lo escrito es una parte
  // sustancial de él: «arub» es el 44 % de «arubakaki» (transliteración ajena) y no lo sugiere; «madr» sí sugiere «madras» (67 %).
  // Con menos de 4 letras todavía no hay palabra que contrastar (los IATA de 3 letras y los prefijos mínimos admiten todos los alias).
  const hayPropio = Array.from(clave).length >= 4 && [...mejores.values()].some((c) => c.propio && c.entrada[0] !== 'a');
  const cobertura = (c: Candidato) => Array.from(clave).length / Math.max(1, Array.from(c.clave).length);
  for (const [id, c] of mejores) {
    if (c.propio || c.exacta) continue;
    if (completa || (hayPropio && cobertura(c) < COBERTURA_MINIMA_ALIAS)) mejores.delete(id);
  }

  // Un aeropuerto escrito a medias («paris», «new york») no compite con las ciudades que ya encajan: solo se ofrece si su nombre
  // o su código se ha escrito completo, o si no hay ninguna ciudad, país o región que encaje.
  if ([...mejores.values()].some((c) => c.entrada[0] !== 'a' && c.propio)) {
    for (const [id, c] of mejores) if (c.entrada[0] === 'a' && !c.exacta) mejores.delete(id);
  }

  // Destinos editoriales complementarios (p. ej. «Salento, Apulia»): compiten con los del catálogo por nombre, país y región.
  // Solo se ofrecen si el catálogo conoce su país (con un catálogo ajeno, como el de pruebas, no aparecen).
  for (const d of Object.values(DESTINOS_EDITORIALES)) {
    if (pais && d.pais !== pais) continue;
    if (paises && !paises.has(d.pais) && !idsRegionAlternativa?.has(d.id)) continue;
    if (!cat.pais(d.pais)) continue;
    const nombre = d.nombres.filter((n) => n.startsWith(clave)).sort((a, b) => a.length - b.length)[0];
    if (nombre === undefined) continue;
    mejores.set(d.id, { entrada: ['c', d.id, d.pais, 0, 1], clave: nombre, exacta: nombre === clave, propio: true, editorial: d });
  }

  // Un aeropuerto escrito por su nombre completo («Brussels Airport») o por su código («BRU») identifica también a su ciudad:
  // la ciudad se ofrece con la misma calidad de coincidencia y va antes (PRIORIDAD_TIPO); el aeropuerto sigue disponible.
  // Solo si lo escrito no es ya el nombre de una ciudad, país o región («Santorini» es el destino, no la ciudad de su aeropuerto).
  const hayDestinoExacto = [...mejores.values()].some((c) => c.entrada[0] !== 'a' && c.exacta && c.propio);
  for (const c of hayDestinoExacto ? [] : [...mejores.values()]) {
    if (c.entrada[0] !== 'a' || !c.exacta) continue;
    const ciudadId = cat.aeropuertoPorIata(`${c.entrada[1]}`)?.ciudadId;
    const ficha = ciudadId ? cat.ficha(ciudadId) : undefined;
    if (!ficha || mejores.has(`c:${ficha.id}`) || (pais && ficha.pais !== pais)) continue;
    mejores.set(`c:${ficha.id}`, { entrada: ['c', ficha.id, ficha.pais, ficha.poblacion, 1], clave: c.clave, exacta: true, propio: true });
  }

  const poblacion = (c: Candidato) => c.entrada[3] ?? 0;
  const hayGrande = Array.from(clave).length <= LONGITUD_MAX_CONSULTA_AMBIGUA && [...mejores.values()].some((c) => c.entrada[0] === 'c' && c.propio && !c.exacta && poblacion(c) >= POBLACION_CIUDAD_GRANDE);
  const nivelEfectivo = (c: Candidato) =>
    hayGrande && !c.editorial && c.entrada[0] === 'c' && c.propio && c.exacta && poblacion(c) < POBLACION_CIUDAD_PEQUENA ? 1 : nivel(c);

  // «Salento, Quindío»: la región escrita prioriza a la ciudad que la declara (sin excluir a las demás).
  // 2 = la región escrita es la de la ciudad (completa, o ya empezada: «Salento, Camp»); 1 = el calificador sugiere su país.
  const coincideRegion = (claves: string[], q: string) => claves.some((k) => k === q || (Array.from(q).length >= 3 && k.startsWith(q)));
  const afinidad = (c: Candidato): number => {
    const r = c.entrada[0] === 'c' ? regionEditorial(`${c.entrada[1]}`) : undefined;
    if (r && consulta.regiones.some((q) => coincideRegion(r.claves, q))) return 2;
    // «Salento, Lecce»: si el calificador es una ciudad de un único país (Italia), ese país prioriza a sus candidatos.
    return paisesSugeridos && paisesSugeridos.has(c.entrada[2]) ? 1 : 0;
  };
  // Homónimos de nombre exacto con orden editorial (Salento: Quindío, Apulia, Campania). Forman un bloque que se ordena entre
  // sí por esa lista y, frente al resto de resultados, por la mayor población del bloque: no adelanta a nada por ser editorial.
  const bloque = (c: Candidato): string[] | undefined => ORDEN_HOMONIMOS[c.clave];
  const posicionEnBloque = (c: Candidato): number => bloque(c)?.indexOf(`${c.entrada[1]}`) ?? -1;
  const poblacionBloque = new Map<string, number>();
  for (const c of mejores.values()) {
    if (posicionEnBloque(c) < 0) continue;
    poblacionBloque.set(c.clave, Math.max(poblacionBloque.get(c.clave) ?? 0, poblacion(c)));
  }
  const poblacionEfectiva = (c: Candidato): number => (posicionEnBloque(c) >= 0 ? poblacionBloque.get(c.clave)! : poblacion(c));
  const ordenEnBloque = (c: Candidato): number => { const i = posicionEnBloque(c); return i < 0 ? 1_000 : i; };

  const ordenados = [...mejores.values()].sort((a, b) =>
    afinidad(b) - afinidad(a) ||
    nivelEfectivo(a) - nivelEfectivo(b) ||
    PRIORIDAD_TIPO[a.entrada[0]] - PRIORIDAD_TIPO[b.entrada[0]] ||
    poblacionEfectiva(b) - poblacionEfectiva(a) ||
    ordenEnBloque(a) - ordenEnBloque(b) ||
    (b.entrada[3] ?? 0) - (a.entrada[3] ?? 0) ||
    a.clave.length - b.clave.length ||
    (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));

  const out: ResultadoBusqueda[] = [];
  for (const c of ordenados) {
    if (out.length >= limite) break;
    if (c.editorial) {
      const d = c.editorial;
      out.push({
        id: d.id, tipo: 'ciudad', nombre: d.nombre, codigoPais: d.pais, nombrePais: cat.pais(d.pais)?.nombre ?? d.paisNombre,
        latitud: d.centro.lat, longitud: d.centro.lon, ...(d.aeropuertos.length ? { aeropuertos: d.aeropuertos } : {}),
        coincidencia: c.exacta ? 'exacta' : 'prefijo', via: 'nombre', region: d.region,
      });
      continue;
    }
    const identidad = identidadDe(cat, c.entrada);
    if (!identidad) continue;
    const p = identidad.pais ? cat.pais(identidad.pais) : undefined;
    const region = identidad.tipo === 'ciudad' ? regionEditorial(identidad.id)?.nombre : undefined;
    out.push({
      id: identidad.id, tipo: identidad.tipo, nombre: identidad.nombre, codigoPais: identidad.pais, nombrePais: p?.nombre ?? null,
      ...(typeof identidad.lat === 'number' ? { latitud: identidad.lat } : {}),
      ...(typeof identidad.lon === 'number' ? { longitud: identidad.lon } : {}),
      ...(identidad.aeropuertos?.length ? { aeropuertos: identidad.aeropuertos } : {}),
      coincidencia: c.exacta ? 'exacta' : 'prefijo',
      via: c.propio ? 'nombre' : 'alias',
      ...(c.propio ? {} : { alias: c.clave }),
      ...(region ? { region } : {}),
    });
  }
  return out;
}

/**
 * Consulta con comas: «Salento, Italia», «Salento, Quindío», «Cartagena, España», «Salento, Quindío, Col» (mientras se escribe).
 * - El primer tramo es el nombre del lugar; los siguientes son calificadores.
 * - Un calificador que es (o empieza como) un país acota la búsqueda a ese país; el resto se tratan como región.
 * - Si lo que se está escribiendo es a la vez prefijo de un país y de la región de una ciudad editorial («Salento, Cam»: Camboya o
 *   Campania), se ofrecen ambas lecturas (idsRegionAlternativa); solo el país escrito completo o su ISO acota sin ambigüedad.
 * - Un calificador que no se reconoce no excluye nada: solo puede priorizar (región editorial) y nunca deja sin resultados.
 */
function partirConsulta(cat: Catalogo, texto: string): { clave: string; paises?: Set<string>; idsRegionAlternativa?: Set<string>; paisesSugeridos?: Set<string>; regiones: string[] } | null {
  const trozos = String(texto ?? '').split(',').map((t) => normalizar(t)).filter(Boolean);
  if (trozos.length === 0) return null;
  const clave = trozos[0]!;
  if (trozos.length === 1) return { clave, regiones: [] };
  if (!consultaValida(clave)) return null;
  const calificadores = trozos.slice(1);
  let paises: Set<string> | undefined;
  // Prefijo ambiguo: lo escrito empieza como un país («cam» → Camboya) y como la región de una ciudad editorial («cam» → Campania).
  // Se ofrecen las dos lecturas: el país acota como siempre y, además, entran las ciudades cuya región empieza así (con su región
  // y país visibles); la región escrita sigue priorizando. Un país escrito entero («Colombia») o su ISO («co») nunca es ambiguo.
  let idsRegionAlternativa: Set<string> | undefined;
  const ultimo = calificadores[calificadores.length - 1]!;
  const exactos = cat.entradas(ultimo).filter((e) => e[0] === 'p').map((e) => e[2]);
  const iso = ultimo.length === 2 && cat.pais(ultimo.toUpperCase()) ? ultimo.toUpperCase() : undefined;
  if (exactos.length) paises = new Set(exactos);
  else if (iso) paises = new Set([iso]);
  else if (Array.from(ultimo).length >= 3) {
    // País que se está escribiendo («ita» → Italia): solo coincidencias de nombre de país por prefijo.
    const isos = cat.buscarPrefijo(ultimo).flatMap(([, entradas]) => entradas.filter((e) => e[0] === 'p').map((e) => e[2]));
    if (isos.length) {
      paises = new Set(isos);
      const ids = todasRegionesEditoriales()
        .filter(([, r]) => normalizar(r.ciudad).startsWith(clave) && r.claves.some((k) => k.startsWith(ultimo)))
        .map(([id]) => id);
      if (ids.length) idsRegionAlternativa = new Set(ids);
    }
  }
  const regiones = paises && !idsRegionAlternativa ? calificadores.slice(0, -1) : calificadores;
  let paisesSugeridos: Set<string> | undefined;
  if (!paises) {
    // Calificador que es una ciudad conocida de un solo país: sugiere ese país (no lo impone).
    const isos = new Set<string>();
    for (const q of regiones) {
      const delPais = new Set(cat.entradas(q).filter((e) => e[0] === 'c').map((e) => e[2]));
      if (delPais.size === 1) for (const i of delPais) isos.add(i);
    }
    if (isos.size) paisesSugeridos = isos;
  }
  return { clave, ...(paises ? { paises } : {}), ...(idsRegionAlternativa ? { idsRegionAlternativa } : {}), ...(paisesSugeridos ? { paisesSugeridos } : {}), regiones };
}
