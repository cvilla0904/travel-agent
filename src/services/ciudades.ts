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
 * `pais` (ISO, minúsculas) es el país de la ciudad curada. Los nombres se repiten por el mundo (Cartagena, Venecia, Nápoles,
 * Sevilla, Florencia, Colonia, París…): si el destino escrito indica OTRO país, la entrada curada no se aplica y se resuelve
 * por el catálogo. Sin país en el texto, la tabla manda (preferencia editorial: «Cartagena» es Cartagena de Indias).
 * `regiones` (opcional, normalizadas): si el texto trae una región entre ciudad y país y no es ninguna de estas, tampoco se aplica.
 */
export interface GrupoCiudadCurada {
  consulta: string; nombres: string[]; pais: string;
  /** Regiones aceptadas entre ciudad y país (normalizadas). */
  regiones?: string[];
  /** Región tal como se muestra y se envía a los proveedores (p. ej. «Quindío»): se conserva en las consultas. */
  region?: string;
  /** Nombre del país (español) para completar el destino cuando no se indica: «Salento» → «Salento, Quindío, Colombia». */
  paisNombre?: string;
  /**
   * Centro propio de la entrada (tiene prioridad sobre CENTROS_CIUDAD, que se indexa por `consulta` y por tanto no distingue
   * homónimos). `radioKm` es el radio «seguro» de validación de ubicación cuando el destino es una zona y no un núcleo urbano.
   */
  centro?: { es: string; lat: number; lng: number; radioKm?: number };
}
export const CIUDADES_EQUIVALENTES: GrupoCiudadCurada[] = [
  { consulta: 'Amsterdam', nombres: ['amsterdam'], pais: 'nl' },
  { consulta: 'Florence', nombres: ['florencia', 'florence', 'firenze'], pais: 'it' },
  { consulta: 'Venice', nombres: ['venecia', 'venice', 'venezia'], pais: 'it' },
  { consulta: 'Seoul', nombres: ['seul', 'seoul'], pais: 'kr' },
  { consulta: 'Beijing', nombres: ['pekin', 'beijing'], pais: 'cn' },
  { consulta: 'Cairo', nombres: ['el cairo', 'cairo'], pais: 'eg' },
  { consulta: 'Brugge', nombres: ['brujas', 'bruges', 'brugge'], pais: 'be' },
  { consulta: 'Ghent', nombres: ['gante', 'ghent', 'gent'], pais: 'be' },
  { consulta: 'Rome', nombres: ['roma', 'rome'], pais: 'it' },
  { consulta: 'Naples', nombres: ['napoles', 'naples', 'napoli'], pais: 'it' },
  { consulta: 'Milan', nombres: ['milan', 'milano'], pais: 'it' },
  { consulta: 'Turin', nombres: ['turin', 'torino'], pais: 'it' },
  { consulta: 'London', nombres: ['londres', 'london'], pais: 'gb' },
  { consulta: 'Munich', nombres: ['munich', 'munchen'], pais: 'de' },
  { consulta: 'Vienna', nombres: ['viena', 'vienna', 'wien'], pais: 'at' },
  { consulta: 'Prague', nombres: ['praga', 'prague', 'praha'], pais: 'cz' },
  { consulta: 'Lisbon', nombres: ['lisboa', 'lisbon'], pais: 'pt' },
  { consulta: 'Porto', nombres: ['oporto', 'porto'], pais: 'pt' },
  { consulta: 'Seville', nombres: ['sevilla', 'seville'], pais: 'es' },
  { consulta: 'Istanbul', nombres: ['estambul', 'istanbul'], pais: 'tr' },
  { consulta: 'Brussels', nombres: ['bruselas', 'brussels', 'bruxelles'], pais: 'be' },
  { consulta: 'Athens', nombres: ['atenas', 'athens'], pais: 'gr' },
  { consulta: 'Copenhagen', nombres: ['copenhague', 'copenhagen'], pais: 'dk' },
  { consulta: 'Edinburgh', nombres: ['edimburgo', 'edinburgh'], pais: 'gb' },
  { consulta: 'Cologne', nombres: ['colonia', 'cologne', 'koln'], pais: 'de' },
  { consulta: 'Nuremberg', nombres: ['nuremberg', 'nurnberg'], pais: 'de' },
  { consulta: 'Geneva', nombres: ['ginebra', 'geneva', 'geneve'], pais: 'ch' },
  { consulta: 'Zurich', nombres: ['zurich'], pais: 'ch' },
  { consulta: 'Krakow', nombres: ['cracovia', 'krakow', 'cracow'], pais: 'pl' },
  { consulta: 'Warsaw', nombres: ['varsovia', 'warsaw'], pais: 'pl' },
  { consulta: 'Moscow', nombres: ['moscu', 'moscow'], pais: 'ru' },
  { consulta: 'Saint Petersburg', nombres: ['san petersburgo', 'saint petersburg', 'st petersburg', 'st. petersburg'], pais: 'ru' },
  { consulta: 'New York', nombres: ['nueva york', 'new york', 'new york city'], pais: 'us' },
  { consulta: 'Mexico City', nombres: ['ciudad de mexico', 'mexico city'], pais: 'mx' },
  { consulta: 'Cartagena de Indias', nombres: ['cartagena', 'cartagena de indias'], pais: 'co', paisNombre: 'Colombia' },
  { consulta: 'Bogota', nombres: ['bogota', 'bogota d.c.'], pais: 'co', paisNombre: 'Colombia' },
  { consulta: 'Medellin', nombres: ['medellin'], pais: 'co', paisNombre: 'Colombia' },
  { consulta: 'Paris', nombres: ['paris'], pais: 'fr' },
  { consulta: 'Barcelona', nombres: ['barcelona'], pais: 'es' },
  { consulta: 'Madrid', nombres: ['madrid'], pais: 'es' },
  { consulta: 'Budapest', nombres: ['budapest'], pais: 'hu' },
  // Nombre ambiguo con tres destinos distintos. Sin región ni país manda el de Colombia (primero de la lista). En Italia, «Salento»
  // es la península de Lecce (Apulia), no el municipio de 760 habitantes de Campania (gn:3168676), que se pide con «Salento, Campania».
  { consulta: 'Salento', nombres: ['salento'], pais: 'co', regiones: ['quindio', 'departamento del quindio'], region: 'Quindío', paisNombre: 'Colombia' },
  { consulta: 'Salento', nombres: ['salento'], pais: 'it', regiones: ['lecce', 'provincia di lecce', 'provincia de lecce', 'puglia', 'apulia', 'pulla'], region: 'Apulia', paisNombre: 'Italia',
    // Zona entre Lecce, Otranto y Gallipoli (a 12, 27 y 28 km): radio seguro de 30 km.
    centro: { es: 'Salento', lat: 40.25, lng: 18.2, radioKm: 30 } },
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
  Budapest: { es: 'Budapest', lat: 47.49835, lng: 19.04045 },
  Salento: { es: 'Salento', lat: 4.63758, lng: -75.56996 },
};

/**
 * Entrada de la tabla para ese destino, o undefined si el texto indica otro país (o, si la entrada lo exige, otra región).
 * Mecanismo único para todas las ciudades curadas: ninguna se aplica a un homónimo de otro país.
 */
export function grupoCurado(ciudad: string): GrupoCiudadCurada | undefined {
  const clave = normalizarTexto(nombreBaseCiudad(ciudad));
  const homonimos = CIUDADES_EQUIVALENTES.filter((g) => g.nombres.includes(clave));
  if (!homonimos.length) return undefined;
  const partes = String(ciudad ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const pais = codigoPaisDesdeDestino(ciudad);
  // Texto intermedio entre la ciudad y el país (si lo hay): «Salento, Quindío, Colombia» -> «quindio».
  const intermedias = partes.slice(1, pais ? -1 : undefined).map(normalizarTexto).filter(Boolean);
  const nombraRegion = (g: GrupoCiudadCurada) => !!g.regiones?.some((r) => intermedias.includes(r));
  // El país escrito acota; después, la región: una entrada que declara regiones solo vale si la escrita es una de ellas.
  const posibles = homonimos.filter((g) => (!pais || g.pais === pais) && (!intermedias.length || !g.regiones?.length || nombraRegion(g)));
  // Con región escrita, la entrada que la declara gana a las que no declaran ninguna; sin ella, el orden editorial de la tabla.
  return posibles.find(nombraRegion) ?? posibles[0];
}

/**
 * Región curada (para mostrar y consultar) del destino, solo si la ciudad curada la tiene y el destino pertenece a ella:
 * regionCurada('Salento, Colombia') -> 'Quindío'; regionCurada('Salento, Italia') -> undefined.
 */
export function regionCurada(ciudad: string): string | undefined {
  return grupoCurado(ciudad)?.region;
}

/** Nombre en español, nombre en inglés y centro de la ciudad, o null si no está en la tabla. */
export function datosCiudad(ciudad: string): { es: string; en: string; lat: number; lng: number; radioKm?: number } | null {
  // La tabla curada manda (nombres en español revisados a mano); el catálogo cubre el resto de ciudades.
  const grupo = grupoCurado(ciudad);
  const centro = grupo ? grupo.centro ?? CENTROS_CIUDAD[grupo.consulta] : undefined;
  if (grupo && centro) {
    const radioKm = grupo.centro?.radioKm;
    return { es: centro.es, en: grupo.consulta, lat: centro.lat, lng: centro.lng, ...(radioKm ? { radioKm } : {}) };
  }
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
  const grupo = grupoCurado(ciudad);
  if (grupo) return grupo.consulta;
  const catalogada = ciudadCatalogada(ciudad);
  if (catalogada) return catalogada.nombreAscii || catalogada.nombre;
  // El texto nombra otro país y el catálogo no resuelve ese homónimo: se conserva el nombre inglés habitual de la tabla
  // (comportamiento anterior; p. ej. «Florencia, Estados Unidos» → «Florence»). El país lo validan los proveedores.
  const clave = normalizarTexto(base);
  return CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave))?.consulta ?? base;
}

/** Todos los nombres normalizados aceptables para esa ciudad. */
export function variantesCiudad(ciudad: string): string[] {
  const clave = normalizarTexto(nombreBaseCiudad(ciudad));
  if (!clave) return [];
  const catalogada = ciudadCatalogada(ciudad);
  // Con otro país en el texto y sin resolución del catálogo se conservan los nombres de la tabla (comportamiento anterior):
  // los proveedores validan el país por su cuenta y buscan por esos nombres. Si el catálogo sí lo resuelve, manda el catálogo.
  const grupo = grupoCurado(ciudad) ?? (catalogada ? undefined : CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave)));
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
