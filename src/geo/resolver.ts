import { Catalogo } from './catalogo.js';
import { normalizar } from './normalizar.js';
import type { EntradaIndice, Identidad, ResultadoResolucion } from './tipos.js';

export function identidadDe(cat: Catalogo, e: EntradaIndice): Identidad | undefined {
  const [t, id, iso] = e;
  if (t === 'c') {
    const c = cat.ficha(id);
    return c && { tipo: 'ciudad', id: c.id, nombre: c.nombre, pais: c.pais, lat: c.lat, lon: c.lon, aeropuertos: c.aeropuertos };
  }
  if (t === 'p') {
    const p = cat.pais(iso);
    return p && { tipo: 'pais', id, nombre: p.nombre, pais: p.iso };
  }
  if (t === 'r') {
    const r = cat.region(id);
    return r && { tipo: 'region', id: r.id, nombre: r.nombre, pais: r.pais, lat: r.centro.lat, lon: r.centro.lon, aeropuertos: r.aeropuertosAcceso };
  }
  const a = cat.aeropuertoPorIata(id);
  return a && { tipo: 'aeropuerto', id: `iata:${a.iata}`, nombre: a.nombre, pais: a.pais, lat: a.lat, lon: a.lon, aeropuertos: [a.iata] };
}

/** Código de país ISO a partir de un texto («Italia», «Italy», «IT»), o undefined. */
export function paisDesdeTexto(cat: Catalogo, texto: string): string | undefined {
  const n = normalizar(texto);
  if (!n) return undefined;
  const e = cat.entradas(n).find((x) => x[0] === 'p');
  if (e) return e[2];
  const iso = texto.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(iso) && cat.pais(iso) ? iso : undefined;
}

/**
 * Resuelve un destino escrito por una persona.
 * - «Florencia, Italia»: el tramo tras la última coma, si es un país conocido, acota la búsqueda.
 * - Un código IATA en mayúsculas (BOG) se reconoce como aeropuerto.
 * - Si hay varias entidades distintas con ese nombre, se pide aclaración: nunca se elige una al azar.
 *   La única excepción es una preferencia editorial documentada en destacados.json (p. ej. Londres → Reino Unido).
 */
export function resolverDestino(cat: Catalogo, texto: string, opciones: { pais?: string } = {}): ResultadoResolucion {
  const original = String(texto ?? '').trim();
  if (!original) return { estado: 'no_encontrado' };

  let nombre = original;
  let pais = opciones.pais?.toUpperCase();
  const trozos = original.split(',').map((s) => s.trim()).filter(Boolean);
  if (trozos.length > 1) {
    const iso = paisDesdeTexto(cat, trozos[trozos.length - 1]!);
    if (iso) { pais = iso; nombre = trozos.slice(0, -1).join(', '); }
  }

  if (/^[A-Z]{3}$/.test(nombre)) {
    const a = cat.entradas(nombre.toLowerCase()).find((x) => x[0] === 'a');
    const id = a && identidadDe(cat, a);
    if (id) return { estado: 'reconocido', origen: 'catalogo', identidad: id };
  }

  const clave = normalizar(nombre);
  let entradas = cat.entradas(clave).filter((e) => e[0] !== 'a');
  if (pais) {
    // «Colombia, Colombia» o un país escrito solo: el país sigue siendo candidato si coincide.
    entradas = entradas.filter((e) => e[2] === pais);
  }
  const identidades = entradas.map((e) => identidadDe(cat, e)).filter((x): x is Identidad => !!x);
  const unicas = [...new Map(identidades.map((i) => [i.id, i])).values()];

  if (unicas.length === 0) return { estado: 'no_encontrado' };
  if (unicas.length === 1) return { estado: 'reconocido', origen: 'catalogo', identidad: unicas[0]! };

  const preferido = cat.destacados().preferidos[clave];
  if (preferido) {
    const p = unicas.filter((i) => i.pais === preferido);
    if (p.length === 1) return { estado: 'reconocido', origen: 'catalogo', identidad: p[0]! };
  }
  const ordenadas = unicas.sort((a, b) => (b.tipo === 'ciudad' ? 1 : 0) - (a.tipo === 'ciudad' ? 1 : 0));
  return { estado: 'aclaracion', candidatos: ordenadas, motivo: `«${original}» puede referirse a varios lugares.` };
}
