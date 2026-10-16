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
const CIUDADES_EQUIVALENTES: Array<{ consulta: string; nombres: string[] }> = [
  { consulta: 'Amsterdam', nombres: ['amsterdam'] },
  { consulta: 'Florence', nombres: ['florencia', 'florence', 'firenze'] },
  { consulta: 'Venice', nombres: ['venecia', 'venice', 'venezia'] },
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
];

/** "Florencia, Italia" -> "Florencia". */
export function nombreBaseCiudad(ciudad: string): string {
  return String(ciudad ?? '').split(',')[0]!.trim();
}

/** Nombre que se envía al proveedor (inglés habitual si se conoce). */
export function consultaProveedorParaCiudad(ciudad: string): string {
  const base = nombreBaseCiudad(ciudad);
  const clave = normalizarTexto(base);
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave));
  return grupo ? grupo.consulta : base;
}

/** Todos los nombres normalizados aceptables para esa ciudad. */
export function variantesCiudad(ciudad: string): string[] {
  const clave = normalizarTexto(nombreBaseCiudad(ciudad));
  if (!clave) return [];
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.nombres.includes(clave));
  return grupo ? [...grupo.nombres] : [clave];
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
