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
