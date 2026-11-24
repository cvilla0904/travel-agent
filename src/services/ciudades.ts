import { Catalogo, fuenteEnDisco } from '../geo/catalogo.js';
import { resolverDestino, paisDesdeTexto } from '../geo/resolver.js';
import type { Ciudad } from '../geo/tipos.js';

let catalogoGeo: Catalogo | undefined;
function obtenerCatalogoGeo(): Catalogo {
  return (catalogoGeo ??= new Catalogo(fuenteEnDisco()));
}
/** Solo para pruebas: inyecta un catálogo (o undefined para volver al de disco) y vacía la memoria de resultados. */
export function establecerCatalogoGeo(cat: Catalogo | undefined): void {
  catalogoGeo = cat;
  memoriaCatalogo.clear();
}

// Memoria de resoluciones por texto (incluidas las no concluyentes). Los errores de catálogo no se memorizan:
// si el catálogo se genera después, se empieza a usar sin reiniciar.
const memoriaCatalogo = new Map<string, Ciudad | null>();
const MEMORIA_MAX = 500;

function ciudadCatalogada(texto: string): Ciudad | null {
  const clave = String(texto ?? '').trim().toLowerCase();
  if (!clave) return null;
  if (memoriaCatalogo.has(clave)) return memoriaCatalogo.get(clave) ?? null;
  try {
    const cat = obtenerCatalogoGeo();
    const partes = String(texto ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const pais = partes.length > 1 ? paisDesdeTexto(cat, partes[partes.length - 1]!) : undefined;
    const resultado = resolverDestino(cat, nombreBaseCiudad(texto), pais ? { pais } : {});
    const ciudad = resultado.estado === 'reconocido' && resultado.identidad.tipo === 'ciudad' && resultado.identidad.pais
      ? cat.ciudad(resultado.identidad.id, resultado.identidad.pais) ?? null
      : null;
    if (memoriaCatalogo.size >= MEMORIA_MAX) memoriaCatalogo.delete(memoriaCatalogo.keys().next().value as string);
    memoriaCatalogo.set(clave, ciudad);
    return ciudad;
  } catch {
    // Catálogo no generado o ilegible: se conserva el diccionario curado como respaldo.
    return null;
  }
}

/**
 * Nombres equivalentes de una misma ciudad (español / inglés / local).
 * Módulo sin dependencias, compartido por las integraciones de proveedores
 * que identifican las ciudades en inglés (p. ej. Booking.com).
 */

export function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * `consulta` es el nombre habitual en inglés que se envía al proveedor.
 * `nombres` ya van normalizados (sin acentos, en minúsculas).
 */
export const CIUDADES_EQUIVALENTES: Array<{ consulta: string; nombres: string[] }> = [
  { consulta: 'Amsterdam', nombres: ['amsterdam'] },
  { consulta: 'Florence', nombres: ['florencia', 'florence', 'firenze'] },
  { consulta: 'Venice', nombres: ['venecia', 'venice', 'venezia'] },
  { consulta: 'Seoul', nombres: ['seul', 'seoul'] },
  { consulta: 'Beijing', nombres: ['pekin', 'beijing'] },
  { consulta: 'Cairo', nombres: ['el cairo', 'cairo'] },
  { consulta: 'Brugge', nombres: ['brujas', 'bruges', 'brugge'] },
  { consulta: 'Ghent', nombres: ['gante', 'ghent', 'gent'] },
  { consulta: 'Rome', nombres: ['roma', 'rome'] },
  { consulta: 'Naples', nombres: ['napoles', 'naples', 'napoli'] },
  { consulta: 'Milan', nombres: ['milan', 'milano'] },
  { consulta: 'Turin', nombres: ['turin', 'torino'] },
  { consulta: 'London', nombres: ['londres', 'london'] },
  { consulta: 'Munich', nombres: ['munich', 'munchen'] },
  { consulta: 'Vienna', nombres: ['viena', 'vienna', 'wien'] },
  { consulta: 'Prague', nombres: ['praga', 'prague', 'praha'] },
  { consulta: 'Lisbon', nombres: ['lisboa', 'lisbon'] },
  { consulta: 'Porto', nombres: ['oporto', 'porto'] },
  { consulta: 'Seville', nombres: ['sevilla', 'seville'] },
  { consulta: 'Istanbul', nombres: ['estambul', 'istanbul'] },
  { consulta: 'Brussels', nombres: ['bruselas', 'brussels', 'bruxelles'] },
  { consulta: 'Athens', nombres: ['atenas', 'athens'] },
  { consulta: 'Copenhagen', nombres: ['copenhague', 'copenhagen'] },
  { consulta: 'Edinburgh', nombres: ['edimburgo', 'edinburgh'] },
  { consulta: 'Cologne', nombres: ['colonia', 'cologne', 'koln'] },
  { consulta: 'Nuremberg', nombres: ['nuremberg', 'nurnberg'] },
  { consulta: 'Geneva', nombres: ['ginebra', 'geneva', 'geneve'] },
  { consulta: 'Zurich', nombres: ['zurich'] },
  { consulta: 'Krakow', nombres: ['cracovia', 'krakow', 'cracow'] },
  { consulta: 'Warsaw', nombres: ['varsovia', 'warsaw'] },
  { consulta: 'Moscow', nombres: ['moscu', 'moscow'] },
  { consulta: 'Saint Petersburg', nombres: ['san petersburgo', 'saint petersburg', 'st petersburg', 'st. petersburg'] },
  { consulta: 'New York', nombres: ['nueva york', 'new york', 'new york city'] },
  { consulta: 'Mexico City', nombres: ['ciudad de mexico', 'mexico city'] },
  { consulta: 'Cartagena de Indias', nombres: ['cartagena', 'cartagena de indias'] },
  { consulta: 'Bogota', nombres: ['bogota', 'bogota d.c.'] },
  { consulta: 'Medellin', nombres: ['medellin'] },
  { consulta: 'Paris', nombres: ['paris'] },
  { consulta: 'Barcelona', nombres: ['barcelona'] },
  { consulta: 'Madrid', nombres: ['madrid'] },
];

/**
 * Nombre en español y centro aproximado de cada ciudad de la tabla anterior (clave = `consulta`).
 * Sirve para dos cosas: pedir al proveedor también el nombre local y comprobar por coordenadas
 * que una actividad está realmente en el destino. Son coordenadas del centro urbano, no un
 * catálogo geográfico: el motor geográfico (src/geo) las sustituirá cuando se integre.
 */
const CENTROS_CIUDAD: Record<string, { es: string; lat: number; lng: number }> = {
  Amsterdam: { es: 'Ámsterdam', lat: 52.3676, lng: 4.9041 },
  Florence: { es: 'Florencia', lat: 43.7696, lng: 11.2558 },
  Venice: { es: 'Venecia', lat: 45.4408, lng: 12.3155 },
  Rome: { es: 'Roma', lat: 41.9028, lng: 12.4964 },
  Naples: { es: 'Nápoles', lat: 40.8518, lng: 14.2681 },
  Milan: { es: 'Milán', lat: 45.4642, lng: 9.19 },
  Turin: { es: 'Turín', lat: 45.0703, lng: 7.6869 },
  London: { es: 'Londres', lat: 51.5074, lng: -0.1278 },
  Munich: { es: 'Múnich', lat: 48.1351, lng: 11.582 },
  Vienna: { es: 'Viena', lat: 48.2082, lng: 16.3738 },
  Prague: { es: 'Praga', lat: 50.0755, lng: 14.4378 },
  Lisbon: { es: 'Lisboa', lat: 38.7223, lng: -9.1393 },
  Porto: { es: 'Oporto', lat: 41.1579, lng: -8.6291 },
  Seville: { es: 'Sevilla', lat: 37.3891, lng: -5.9845 },
  Istanbul: { es: 'Estambul', lat: 41.0082, lng: 28.9784 },
  Brussels: { es: 'Bruselas', lat: 50.8503, lng: 4.3517 },
  Athens: { es: 'Atenas', lat: 37.9838, lng: 23.7275 },
  Copenhagen: { es: 'Copenhague', lat: 55.6761, lng: 12.5683 },
  Edinburgh: { es: 'Edimburgo', lat: 55.9533, lng: -3.1883 },
  Cologne: { es: 'Colonia', lat: 50.9375, lng: 6.9603 },
  Nuremberg: { es: 'Núremberg', lat: 49.4521, lng: 11.0767 },
  Geneva: { es: 'Ginebra', lat: 46.2044, lng: 6.1432 },
  Zurich: { es: 'Zúrich', lat: 47.3769, lng: 8.5417 },
  Krakow: { es: 'Cracovia', lat: 50.0647, lng: 19.945 },
  Warsaw: { es: 'Varsovia', lat: 52.2297, lng: 21.0122 },
  Moscow: { es: 'Moscú', lat: 55.7558, lng: 37.6173 },
  'Saint Petersburg': { es: 'San Petersburgo', lat: 59.9311, lng: 30.3609 },
  'New York': { es: 'Nueva York', lat: 40.7128, lng: -74.006 },
  'Mexico City': { es: 'Ciudad de México', lat: 19.4326, lng: -99.1332 },
  'Cartagena de Indias': { es: 'Cartagena de Indias', lat: 10.391, lng: -75.4794 },
  Bogota: { es: 'Bogotá', lat: 4.711, lng: -74.0721 },
  Medellin: { es: 'Medellín', lat: 6.2442, lng: -75.5812 },
  Paris: { es: 'París', lat: 48.8566, lng: 2.3522 },
  Barcelona: { es: 'Barcelona', lat: 41.3874, lng: 2.1686 },
  Madrid: { es: 'Madrid', lat: 40.4168, lng: -3.7038 },
};

/** Nombre en español, nombre en inglés y centro de la ciudad, o null si no está en la tabla. */
export function datosCiudad(ciudad: string): { es: string; en: string; lat: number; lng: number } | null {
  // La tabla curada manda (nombres en español revisados a mano); el catálogo cubre el resto de ciudades.
  const clave = normalizarTexto(nombreBaseCiudad(ciudad));
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave));
  const centro = grupo ? CENTROS_CIUDAD[grupo.consulta] : undefined;
  if (grupo && centro) return { es: centro.es, en: grupo.consulta, lat: centro.lat, lng: centro.lng };
  const catalogada = ciudadCatalogada(ciudad);
  return catalogada ? { es: catalogada.nombre, en: catalogada.nombreAscii || catalogada.nombre, lat: catalogada.lat, lng: catalogada.lon } : null;
}

/** "Florencia, Italia" -> "Florencia". */
export function nombreBaseCiudad(ciudad: string): string {
  return String(ciudad ?? '').split(',')[0]!.trim();
}

/** Nombre que se envía al proveedor (inglés habitual si se conoce). */
export function consultaProveedorParaCiudad(ciudad: string): string {
  const base = nombreBaseCiudad(ciudad);
  const clave = normalizarTexto(base);
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave));
  if (grupo) return grupo.consulta;
  const catalogada = ciudadCatalogada(ciudad);
  return catalogada ? catalogada.nombreAscii || catalogada.nombre : base;
}

/** Todos los nombres normalizados aceptables para esa ciudad. */
export function variantesCiudad(ciudad: string): string[] {
  const clave = normalizarTexto(nombreBaseCiudad(ciudad));
  if (!clave) return [];
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave));
  const catalogada = ciudadCatalogada(ciudad);
  // Unión de ambas fuentes: ninguna variante curada se pierde por tener el catálogo disponible.
  const todas = [...(grupo?.nombres ?? []), ...(catalogada ? [catalogada.nombre, catalogada.nombreAscii, ...catalogada.nombres].map(normalizarTexto) : [])].filter(Boolean);
  return todas.length ? [...new Set(todas)] : [clave];
}

/** Países habituales (nombres normalizados, en español e inglés) -> código ISO en minúsculas. */
const CODIGOS_PAIS: Record<string, string> = {
  espana: 'es', spain: 'es',
  italia: 'it', italy: 'it',
  francia: 'fr', france: 'fr',
  portugal: 'pt',
  alemania: 'de', germany: 'de',
  austria: 'at',
  'paises bajos': 'nl', holanda: 'nl', netherlands: 'nl', 'the netherlands': 'nl',
  belgica: 'be', belgium: 'be',
  suiza: 'ch', switzerland: 'ch',
  'reino unido': 'gb', 'united kingdom': 'gb', inglaterra: 'gb', uk: 'gb',
  irlanda: 'ie', ireland: 'ie',
  grecia: 'gr', greece: 'gr',
  turquia: 'tr', turkey: 'tr',
  'republica checa': 'cz', chequia: 'cz', 'czech republic': 'cz', czechia: 'cz',
  polonia: 'pl', poland: 'pl',
  dinamarca: 'dk', denmark: 'dk',
  hungria: 'hu', hungary: 'hu',
  croacia: 'hr', croatia: 'hr',
  japon: 'jp', japan: 'jp',
  mexico: 'mx',
  colombia: 'co',
  'estados unidos': 'us', 'united states': 'us', usa: 'us', eeuu: 'us',
};

/** "Italia" / "Italy" / "IT" -> "it". undefined si no se reconoce. */
export function codigoPaisDesdeNombre(pais: unknown): string | undefined {
  try {
    const iso = paisDesdeTexto(obtenerCatalogoGeo(), String(pais ?? ''));
    if (iso) return iso.toLowerCase();
  } catch { /* usa el diccionario de respaldo hasta generar el catálogo */ }
  const clave = normalizarTexto(pais);
  if (!clave) return undefined;
  if (/^[a-z]{2}$/.test(clave)) return clave;
  return CODIGOS_PAIS[clave];
}

/** "Florencia, Italia" -> código del país escrito tras la última coma, si se reconoce. */
export function codigoPaisDesdeDestino(destino: string): string | undefined {
  const partes = String(destino ?? '').split(',');
  if (partes.length < 2) return undefined;
  return codigoPaisDesdeNombre(partes[partes.length - 1]);
}
