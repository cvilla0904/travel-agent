/**
 * Moneda de los precios de los proveedores.
 *
 * Regla de producto: se muestra EXACTAMENTE la moneda que declara el proveedor. Nunca se asume EUR (ni ninguna otra) cuando
 * el proveedor no la indica, y no se convierte entre monedas sin un tipo de cambio verificable (no lo hay): una moneda
 * desconocida se muestra como «Moneda no confirmada» y un importe ausente como «Precio no disponible».
 * Módulo sin dependencias: lo usan los normalizadores de vuelos, hoteles y actividades.
 */

/** Códigos ISO 4217 aceptados (monedas en circulación). Un código de tres letras que no esté aquí no se acepta como moneda. */
const CODIGOS_ISO = new Set((
  'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC ' +
  'CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD ' +
  'JOD JPY KES KGS KHR KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN ' +
  'NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL ' +
  'THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWL'
).split(' '));

/** Código ISO válido (en mayúsculas) o null. */
export function monedaIso(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const codigo = valor.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(codigo) && CODIGOS_ISO.has(codigo) ? codigo : null;
}

/**
 * Moneda inequívoca a partir de un texto de precio («19,90 €», «US$ 25», «CHF 40», «25 USD»). Los símbolos ambiguos
 * («$» a secas puede ser USD, MXN, ARS, CAD…; «¥» JPY o CNY; «kr» varias) NO se interpretan: devuelven null.
 */
export function monedaDesdeTexto(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  if (/€/.test(texto)) return 'EUR';
  if (/£/.test(texto)) return 'GBP';
  if (/\bUS\s?\$|US\$/i.test(texto)) return 'USD';
  if (/\bCA\s?\$|\bC\$/i.test(texto)) return 'CAD';
  if (/\bAU\s?\$|\bA\$/i.test(texto)) return 'AUD';
  const codigos = new Set<string>();
  for (const m of texto.toUpperCase().matchAll(/\b[A-Z]{3}\b/g)) { const c = monedaIso(m[0]); if (c) codigos.add(c); }
  return codigos.size === 1 ? [...codigos][0]! : null;
}

export const SIN_PRECIO = 'Precio no disponible';
export const SIN_MONEDA = 'Moneda no confirmada';

/**
 * Importe formateado con su moneda real. Sin importe: «Precio no disponible». Con importe y sin moneda: el número sin
 * símbolo seguido de «(Moneda no confirmada)» (nunca un símbolo inventado).
 */
export function formatearImporte(importe: number | null | undefined, moneda: string | null | undefined, locale = 'es-ES'): string {
  if (typeof importe !== 'number' || !Number.isFinite(importe)) return SIN_PRECIO;
  const codigo = monedaIso(moneda);
  if (!codigo) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(importe)} (${SIN_MONEDA})`;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: codigo, maximumFractionDigits: Number.isInteger(importe) ? 0 : 2 }).format(importe);
}

/** Moneda común de varios importes: la de todos si coinciden; '' si alguno no la declara o si difieren (no se suman). */
export function monedaComun(monedas: Array<string | null | undefined>): string {
  const codigos = monedas.map(monedaIso);
  if (!codigos.length || codigos.some((c) => !c)) return '';
  return new Set(codigos).size === 1 ? codigos[0]! : '';
}
