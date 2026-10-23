/**
 * Hoteles: SearchAPI (Booking.com).
 *
 * Flujo: booking_autocomplete (resuelve dest_id/dest_type) -> booking (búsqueda).
 *
 * Reglas:
 *  - Un error del proveedor NUNCA se convierte en una lista vacía: se lanza
 *    HotelesProveedorError y `buscarHotelesConEstado` lo comunica con estado
 *    'error_proveedor'.
 *  - No se asume ningún dato: lo que el proveedor no da queda a 0 / '' y el
 *    agente lo presenta como "no disponible". Los importes calculados a partir
 *    de otros (total <-> noche) se marcan con `precioCalculado`.
 */

import {
  codigoPaisDesdeDestino,
  codigoPaisDesdeNombre,
  consultaProveedorParaCiudad,
  nombreBaseCiudad,
  normalizarTexto,
  variantesCiudad,
} from './ciudades.js';

const URL_BASE = 'https://www.searchapi.io/api/v1/search';
const ESPERA_MAXIMA_MS = 25_000;
const MONEDA_SOLICITADA = 'EUR';

export type CodigoErrorHoteles =
  | 'configuracion'
  | 'parametros'
  | 'autenticacion'
  | 'limite_uso'
  | 'limite_peticiones'
  | 'rechazo_sin_causa'
  | 'destino_no_verificado'
  | 'respuesta_invalida'
  | 'api';

/** Datos objetivos de la respuesta del proveedor (ya sin secretos). */
export interface DetalleErrorProveedor {
  httpStatus: number | null;
  retryAfter: string | null;
  detalleProveedor: string | null;
  etapa: string | null;
}

export class HotelesProveedorError extends Error {
  readonly codigo: CodigoErrorHoteles;
  readonly httpStatus: number | null;
  readonly retryAfter: string | null;
  readonly detalleProveedor: string | null;
  readonly etapa: string | null;

  constructor(codigo: CodigoErrorHoteles, mensaje: string, detalle: Partial<DetalleErrorProveedor> = {}) {
    super(mensaje);
    this.name = 'HotelesProveedorError';
    this.codigo = codigo;
    this.httpStatus = detalle.httpStatus ?? null;
    this.retryAfter = detalle.retryAfter ?? null;
    this.detalleProveedor = detalle.detalleProveedor ?? null;
    this.etapa = detalle.etapa ?? null;
  }
}

export type EstadoHoteles = 'ok' | 'sin_resultados' | 'error_proveedor' | 'error_interno';

export interface HotelNormalizado {
  nombre: string;
  estrellas: number;
  valoracion: number;
  valoracionEscala: number;
  numeroResenas: number;
  precioTotal: number;
  precioPorNoche: number;
  precioDisponible: boolean;
  precioCalculado: boolean;
  fuentePrecio: string;
  moneda: string;
  habitacion: string;
  disponibilidad: string;
  habitacionesDisponibles: number;
  cancelacionGratuita: boolean;
  cancelacionHasta: string;
  url: string;
  imagen: string;
  zona: string;
  distanciaCentro: string;
}

export interface DiagnosticoHoteles {
  destinoResuelto: string;
  propiedadesProveedor: number;
  devueltos: number;
  conPrecio: number;
  sinPrecio: number;
  conEnlace: number;
}

export interface ParametrosHoteles {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
  paisCodigo?: string | undefined;
}

export interface ResultadoHoteles {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
  proveedor: string;
  diagnostico: DiagnosticoHoteles;
  hoteles: HotelNormalizado[];
}

export interface ResultadoHotelesConEstado extends ResultadoHoteles {
  estado: EstadoHoteles;
  error: string | null;
  /** Clasificación del fallo (ver CodigoErrorHoteles) o 'error_interno'; null si no hubo fallo. */
  codigoError: string | null;
  httpStatus: number | null;
  retryAfter: string | null;
  detalleProveedor: string | null;
  etapaError: string | null;
}

export interface DependenciasSearchApi {
  apiKey?: string | undefined;
  fetch?: typeof fetch;
  registrar?: (evento: string, datos: Record<string, unknown>) => void;
}

const registradorPorDefecto = (evento: string, datos: Record<string, unknown>) => {
  console.info(`[SEARCHAPI_HOTELS_DIAG] ${evento}`, JSON.stringify(datos));
};

/* =========================================================
   NÚMEROS, MONEDA Y FECHAS
   ========================================================= */

/**
 * Extrae un número de un valor que puede ser numérico o texto
 * ("€ 1,234.50", "1.234,50", "8,6", "1,234 reseñas", "4 estrellas").
 * Devuelve null si no hay ninguna cifra. Nunca devuelve NaN.
 */
export function aNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;

  const trozo = valor.match(/\d[\d.,\s]*/)?.[0]?.trim().replace(/\s+/g, '');
  if (!trozo) return null;
  let limpio = trozo.replace(/[.,]+$/, '');

  const ultimaComa = limpio.lastIndexOf(',');
  const ultimoPunto = limpio.lastIndexOf('.');
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    // El último separador es el decimal; el otro agrupa miles.
    limpio =
      ultimaComa > ultimoPunto
        ? limpio.replace(/\./g, '').replace(',', '.')
        : limpio.replace(/,/g, '');
  } else {
    const separador = ultimaComa !== -1 ? ',' : ultimoPunto !== -1 ? '.' : '';
    if (separador) {
      const apariciones = limpio.split(separador).length - 1;
      const decimales = limpio.length - limpio.lastIndexOf(separador) - 1;
      const miles = apariciones > 1 || decimales === 3;
      limpio = miles ? limpio.split(separador).join('') : limpio.replace(separador, '.');
    }
  }

  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

function primerPrecio(...valores: unknown[]): number {
  for (const valor of valores) {
    const numero = aNumero(valor);
    if (numero !== null && numero > 0) return numero;
  }
  return 0;
}

/** Moneda inequívoca a partir de un texto de precio. "$" a secas es ambiguo. */
export function monedaDesdeTexto(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  if (/€|\bEUR\b/i.test(texto)) return 'EUR';
  if (/£|\bGBP\b/i.test(texto)) return 'GBP';
  if (/US\$|\bUSD\b/i.test(texto)) return 'USD';
  return null;
}

function monedaIso(valor: unknown): string | null {
  return typeof valor === 'string' && /^[A-Za-z]{3}$/.test(valor.trim()) ? valor.trim().toUpperCase() : null;
}

export function calcularNoches(fechaEntrada: string, fechaSalida: string): number {
  const dias = (Date.parse(`${fechaSalida}T00:00:00Z`) - Date.parse(`${fechaEntrada}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(dias) && dias >= 1 ? Math.round(dias) : 1;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/* =========================================================
   RESOLUCIÓN DEL DESTINO (booking_autocomplete)
   ========================================================= */

export interface DestinoBooking {
  destId: string;
  destType: string;
  label: string;
  countryCode: string;
}

const PRIORIDAD_TIPO_DESTINO = ['city', 'region', 'district'];

/**
 * Elige el destino de Booking que corresponde a la ciudad pedida.
 *
 * Solo se acepta una coincidencia por NOMBRE (título o primer tramo del label)
 * con la ciudad o sus equivalentes ("Florencia" == "Florence"); así no se
 * confunde con un hotel o un lugar que solo contiene el nombre. Si se conoce
 * el país, debe coincidir.
 */
export function resolverDestinoBooking(
  sugerencias: unknown[],
  destino: string,
  paisCodigo?: string,
): DestinoBooking | null {
  const variantes = variantesCiudad(destino);
  if (variantes.length === 0) return null;
  const pais = normalizarTexto(paisCodigo);

  const candidatos = sugerencias
    .map((item, indice) => ({ item: item as Record<string, unknown>, indice }))
    .filter(({ item }) => {
      if (!item || item.dest_id == null || !texto(item.dest_type)) return false;
      const titulo = normalizarTexto(item.title);
      const cabeceraLabel = normalizarTexto(String(item.label ?? '').split(',')[0]);
      const nombreCoincide = variantes.includes(titulo) || variantes.includes(cabeceraLabel);
      const paisCoincide = !pais || normalizarTexto(item.country_code) === pais;
      return nombreCoincide && paisCoincide;
    })
    .sort((a, b) => {
      const prioridad = (tipo: unknown) => {
        const i = PRIORIDAD_TIPO_DESTINO.indexOf(normalizarTexto(tipo));
        return i === -1 ? PRIORIDAD_TIPO_DESTINO.length : i;
      };
      return prioridad(a.item.dest_type) - prioridad(b.item.dest_type) || a.indice - b.indice;
    });

  const elegido = candidatos[0]?.item;
  if (!elegido) return null;
  return {
    destId: String(elegido.dest_id),
    destType: texto(elegido.dest_type),
    label: texto(elegido.label) || texto(elegido.title),
    countryCode: texto(elegido.country_code),
  };
}

/* =========================================================
   NORMALIZACIÓN DE PROPIEDADES (engine=booking)
   ========================================================= */

export function normalizarPropiedades(
  propiedades: unknown[],
  noches: number,
  monedaPeticion: string = MONEDA_SOLICITADA,
  limite = 10,
): HotelNormalizado[] {
  const crudos = propiedades
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .filter((p) => texto(p.title).length > 0);

  // Booking puntúa sobre 10. Si algún valor del lote supera 5, la escala es 10.
  const escala = crudos.some((p) => (aNumero(p.rating) ?? 0) > 5) ? 10 : 5;

  const vistos = new Set<string>();
  const hoteles: HotelNormalizado[] = [];

  for (const p of crudos) {
    const nombre = texto(p.title);
    const url = /^https?:\/\//i.test(texto(p.link)) ? texto(p.link) : '';
    const clave = url ? `url:${url.split('?')[0]}` : `nombre:${normalizarTexto(nombre)}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    let precioTotal = primerPrecio(p.extracted_price, p.price, p.total_price);
    let precioPorNoche = primerPrecio(p.extracted_nightly_price, p.nightly_price, p.price_per_night);
    let precioCalculado = false;
    if (precioTotal > 0 && precioPorNoche === 0) {
      precioPorNoche = Number((precioTotal / noches).toFixed(2));
      precioCalculado = true;
    } else if (precioPorNoche > 0 && precioTotal === 0) {
      precioTotal = Number((precioPorNoche * noches).toFixed(2));
      precioCalculado = true;
    }
    const precioDisponible = precioTotal > 0;

    const estrellas = Math.min(5, Math.max(0, Math.round(aNumero(p.hotel_class) ?? 0)));
    const monedaProveedor =
      monedaIso(p.currency) ?? monedaDesdeTexto(p.price) ?? monedaDesdeTexto(p.total_price);

    hoteles.push({
      nombre,
      estrellas,
      valoracion: Math.max(0, aNumero(p.rating) ?? 0),
      valoracionEscala: escala,
      numeroResenas: Math.max(0, Math.round(aNumero(p.reviews) ?? 0)),
      precioTotal,
      precioPorNoche,
      precioDisponible,
      precioCalculado: precioDisponible && precioCalculado,
      fuentePrecio: precioDisponible ? 'SearchAPI / Booking.com' : '',
      // La petición se hace con currency=EUR; si el proveedor declara otra
      // moneda, prevalece la del proveedor.
      moneda: monedaProveedor ?? monedaPeticion,
      habitacion: texto(p.room_type),
      disponibilidad: texto(p.availability),
      habitacionesDisponibles: Math.max(0, Math.round(aNumero(p.rooms_left) ?? 0)),
      cancelacionGratuita: p.has_free_cancellation === true,
      cancelacionHasta: texto(p.free_cancellation_until),
      url,
      imagen: texto(p.thumbnail_hd) || texto(p.thumbnail),
      zona: texto(p.neighborhood),
      distanciaCentro: texto(p.distance),
    });
    if (hoteles.length >= limite) break;
  }
  return hoteles;
}

/* =========================================================
   LLAMADAS HTTP
   ========================================================= */

// Evidencia explícita en el texto del proveedor. Mencionar "créditos" o
// "mensual" NO basta: hace falta una expresión de agotamiento ("exhausted",
// "insufficient credits", "out of credits", "no credits left"...). Un 429 sin
// evidencia suficiente, o con evidencias contradictorias, queda neutral.
const MODIFICADORES = '(?:(?:your|the|of|any|all|monthly|free|search|api|available|remaining)\\s+)*';
const PATRONES_CUOTA_AGOTADA: RegExp[] = [
  new RegExp(`\\b(?:exhausted|depleted|exceeded|used up|reached|ran out of|run out of|out of|insufficient|not enough|no more|no remaining)\\s+${MODIFICADORES}(?:quota|credits?|searches)\\b`, 'i'),
  /\b(?:quota|credits?|searches)\s+(?:(?:has|have|is|are|was|were|been)\s+)*(?:exhausted|depleted|exceeded|used up|reached)\b/i,
  /\b(?:monthly|plan)\s+(?:limit|quota)\s+(?:(?:has|have|is|was)\s+)*(?:been\s+)?(?:reached|exceeded)\b/i,
  /\b(?:no|zero|0)\s+(?:credits?|searches)\s+(?:left|remaining|available)\b/i,
  /\b(?:quota|credits?)[_-](?:exceeded|exhausted|depleted)\b|\binsufficient[_-]credits?\b/i,
];
const NEGACION_AGOTAMIENTO = /\b(?:not|never|n't)\b(?:\s+\w+){0,2}\s+(?:exhausted|depleted|exceeded|reached)\b/i;
const MENCION_CUOTA = /quota|credits?\b|monthly/i;
const EVIDENCIA_FRECUENCIA = /rate[\s_-]?limit|too many requests|requests? per (?:second|minute|hour)|per[\s-](?:second|minute|hour)|hourly (?:request |rate )?limit|throttl|slow down|concurrent/i;
const EVIDENCIA_AUTENTICACION = /api[_ ]?key|unauthori[sz]ed|invalid token|authentication/i;

export function clasificarError(estado: number | null, detalle: string): CodigoErrorHoteles {
  const cuotaAgotada =
    PATRONES_CUOTA_AGOTADA.some((patron) => patron.test(detalle)) && !NEGACION_AGOTAMIENTO.test(detalle);
  const frecuencia = EVIDENCIA_FRECUENCIA.test(detalle);
  const mencionaCuota = MENCION_CUOTA.test(detalle);
  if (estado === 401 || estado === 403) return 'autenticacion';
  if (estado === 429 || estado === 402) {
    if (cuotaAgotada && !frecuencia) return 'limite_uso';
    if (frecuencia && !mencionaCuota) return 'limite_peticiones';
    return 'rechazo_sin_causa';
  }
  if (cuotaAgotada && !frecuencia) return 'limite_uso';
  if (EVIDENCIA_AUTENTICACION.test(detalle)) return 'autenticacion';
  return 'api';
}

/** Quita claves, tokens y cabeceras de autorización de un texto del proveedor. */
export function limpiarSecretos(texto: string, clave?: string): string {
  let limpio = String(texto ?? '');
  if (clave && clave.length >= 6) limpio = limpio.split(clave).join('[REDACTED]');
  return limpio
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|authorization|secret)["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{6,}/gi, '$1[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valor de Retry-After tal cual lo envía el proveedor (segundos o fecha), sanitizado. */
function leerRetryAfter(respuesta: Response): string | null {
  const bruto = respuesta.headers?.get?.('retry-after');
  if (!bruto) return null;
  const limpio = bruto.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 64);
  return limpio || null;
}

function textoRetryAfter(retryAfter: string | null): string {
  if (!retryAfter) return '';
  return /^\d+$/.test(retryAfter) ? ` Retry-After: ${retryAfter} s.` : ` Retry-After: ${retryAfter}.`;
}

/**
 * Mensaje para el usuario/agente. Solo afirma una causa cuando la respuesta del
 * proveedor aporta evidencia (se cita su texto); si no, es neutral.
 */
export function construirMensajeError(
  codigo: CodigoErrorHoteles,
  d: { etapa: string; httpStatus: number; detalle: string; retryAfter: string | null },
): string {
  const cita = d.detalle ? ` «${d.detalle}»` : '';
  const espera = textoRetryAfter(d.retryAfter);
  switch (codigo) {
    case 'limite_uso':
      return `SearchAPI indica que la cuota o los créditos están agotados (HTTP ${d.httpStatus}, ${d.etapa}):${cita}.${espera}`;
    case 'limite_peticiones':
      return `SearchAPI indica un límite de frecuencia de peticiones (HTTP ${d.httpStatus}, ${d.etapa}):${cita}.${espera}`;
    case 'rechazo_sin_causa': {
      const rechazo = d.httpStatus === 429 ? 'ha rechazado temporalmente la petición' : 'ha rechazado la petición';
      return (
        `SearchAPI ${rechazo} con HTTP ${d.httpStatus} (${d.etapa}); no se ha podido confirmar el motivo.` +
        (d.detalle ? ` Detalle del proveedor, sin información concluyente:${cita}.` : '') +
        espera
      );
    }
    default:
      return `SearchAPI (${d.etapa}) respondió HTTP ${d.httpStatus}${d.detalle ? `: ${d.detalle}` : ''}.${espera}`;
  }
}

function mensajeDeCuerpo(cuerpo: unknown): string {
  const c = cuerpo as { error?: unknown; message?: unknown; detail?: unknown } | null;
  const bruto =
    typeof c?.error === 'string' ? c.error
    : typeof c?.message === 'string' ? c.message
    : typeof c?.detail === 'string' ? c.detail
    : '';
  return bruto.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function llamar(
  url: URL,
  etapa: string,
  clave: string,
  llamarFetch: typeof fetch,
): Promise<Record<string, unknown>> {
  let respuesta: Response;
  try {
    respuesta = await llamarFetch(url, {
      headers: { Authorization: `Bearer ${clave}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
  } catch (error) {
    const agotado = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new HotelesProveedorError(
      'api',
      agotado
        ? `SearchAPI (${etapa}) no respondió en ${ESPERA_MAXIMA_MS / 1000} s.`
        : `No se pudo contactar con SearchAPI (${etapa}).`,
      { etapa },
    );
  }

  const textoRespuesta = await respuesta.text();
  let cuerpo: unknown = null;
  try {
    cuerpo = JSON.parse(textoRespuesta);
  } catch {
    /* se trata abajo */
  }

  if (!respuesta.ok) {
    const detalle = limpiarSecretos(mensajeDeCuerpo(cuerpo) || textoRespuesta.slice(0, 200), clave).slice(0, 300);
    const retryAfter = leerRetryAfter(respuesta);
    const codigo = clasificarError(respuesta.status, detalle);
    throw new HotelesProveedorError(
      codigo,
      construirMensajeError(codigo, { etapa, httpStatus: respuesta.status, detalle, retryAfter }),
      { httpStatus: respuesta.status, retryAfter, detalleProveedor: detalle || null, etapa },
    );
  }

  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    throw new HotelesProveedorError('respuesta_invalida', `SearchAPI (${etapa}) devolvió una respuesta que no es JSON válido.`);
  }

  // Un HTTP 200 con campo "error" es un fallo, no una búsqueda sin resultados.
  const detalleError = limpiarSecretos(mensajeDeCuerpo(cuerpo), clave).slice(0, 300);
  const estadoMeta = (cuerpo as { search_metadata?: { status?: unknown } }).search_metadata?.status;
  if (detalleError || estadoMeta === 'Error') {
    const codigo = clasificarError(null, detalleError);
    const mensaje =
      codigo === 'limite_uso'
        ? construirMensajeError(codigo, { etapa, httpStatus: 200, detalle: detalleError, retryAfter: null })
        : `SearchAPI (${etapa}) devolvió un error: ${detalleError || 'estado Error sin detalle'}.`;
    throw new HotelesProveedorError(codigo, mensaje, {
      httpStatus: 200,
      detalleProveedor: detalleError || null,
      etapa,
    });
  }
  return cuerpo as Record<string, unknown>;
}

async function autocompletar(
  consulta: string,
  clave: string,
  llamarFetch: typeof fetch,
): Promise<unknown[]> {
  const url = new URL(URL_BASE);
  url.searchParams.set('engine', 'booking_autocomplete');
  url.searchParams.set('q', consulta);
  url.searchParams.set('num', '10');
  url.searchParams.set('language', 'en-us');
  const datos = await llamar(url, 'autocompletado', clave, llamarFetch);
  return Array.isArray(datos.suggestions) ? datos.suggestions : [];
}

/* =========================================================
   BÚSQUEDA
   ========================================================= */

export async function buscarHotelesSearchApi(
  params: ParametrosHoteles,
  dependencias: DependenciasSearchApi = {},
): Promise<ResultadoHoteles> {
  const clave = dependencias.apiKey ?? process.env.SEARCHAPI_API_KEY;
  const llamarFetch = dependencias.fetch ?? fetch;
  const registrar = dependencias.registrar ?? registradorPorDefecto;

  if (!clave) throw new HotelesProveedorError('configuracion', 'SEARCHAPI_API_KEY no está configurada en este entorno.');
  if (!params.destino.trim()) throw new HotelesProveedorError('parametros', 'El destino del alojamiento está vacío.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaEntrada) || !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaSalida)) {
    throw new HotelesProveedorError('parametros', 'Las fechas de alojamiento deben tener formato YYYY-MM-DD.');
  }
  if (params.fechaSalida <= params.fechaEntrada) {
    throw new HotelesProveedorError('parametros', 'La fecha de salida debe ser posterior a la fecha de entrada.');
  }

  const adultos = Math.max(1, Math.min(30, Math.floor(params.adultos || 1)));
  // País: el parámetro explícito manda; si no, el que acompaña al destino
  // ("Florencia, Italia"). Se exige al resolver el destino para no confundir
  // ciudades homónimas (Florence, Alabama).
  const pais = normalizarTexto(codigoPaisDesdeNombre(params.paisCodigo) ?? codigoPaisDesdeDestino(params.destino));

  // Paso 1: resolver el destino. Se prueba primero el nombre en inglés
  // (Booking responde en en-us) y, si no hay coincidencia, el original.
  const consultas = [...new Set([consultaProveedorParaCiudad(params.destino), nombreBaseCiudad(params.destino)])].filter(Boolean);
  let destino: DestinoBooking | null = null;
  const etiquetasVistas: string[] = [];
  for (const consulta of consultas) {
    const sugerencias = await autocompletar(consulta, clave, llamarFetch);
    destino = resolverDestinoBooking(sugerencias, params.destino, pais || undefined);
    if (destino) break;
    for (const s of sugerencias.slice(0, 3)) {
      const etiqueta = texto((s as Record<string, unknown>)?.label) || texto((s as Record<string, unknown>)?.title);
      if (etiqueta && etiquetasVistas.length < 3) etiquetasVistas.push(etiqueta);
    }
  }
  if (!destino) {
    throw new HotelesProveedorError(
      'destino_no_verificado',
      `Booking no devolvió un destino verificable para "${params.destino}"` +
        (pais ? ` en el país "${pais}"` : '') +
        (etiquetasVistas.length ? ` (sugerencias recibidas: ${etiquetasVistas.join(' | ')}).` : '.'),
    );
  }
  registrar('destino_resuelto', {
    consulta: params.destino,
    destId: destino.destId,
    destType: destino.destType,
    label: destino.label,
    pais: destino.countryCode || null,
  });

  // Paso 2: búsqueda con el destino resuelto.
  const url = new URL(URL_BASE);
  url.searchParams.set('engine', 'booking');
  url.searchParams.set('q', consultaProveedorParaCiudad(params.destino));
  url.searchParams.set('dest_id', destino.destId);
  url.searchParams.set('dest_type', destino.destType);
  url.searchParams.set('check_in_date', params.fechaEntrada);
  url.searchParams.set('check_out_date', params.fechaSalida);
  url.searchParams.set('adults', String(adultos));
  url.searchParams.set('rooms', '1');
  url.searchParams.set('currency', MONEDA_SOLICITADA);
  url.searchParams.set('language', 'en-us');

  const datos = await llamar(url, 'búsqueda', clave, llamarFetch);

  const paisDestino = normalizarTexto(
    (datos.search_information as { destination?: { country_code?: unknown } } | undefined)?.destination?.country_code,
  );
  if (pais && paisDestino && paisDestino !== pais) {
    throw new HotelesProveedorError(
      'destino_no_verificado',
      `SearchAPI devolvió el país "${paisDestino}" en vez de "${pais}" para "${params.destino}".`,
    );
  }

  const propiedades = Array.isArray(datos.properties) ? datos.properties : [];
  const noches = calcularNoches(params.fechaEntrada, params.fechaSalida);
  const hoteles = normalizarPropiedades(propiedades, noches);

  const diagnostico: DiagnosticoHoteles = {
    destinoResuelto: destino.label,
    propiedadesProveedor: propiedades.length,
    devueltos: hoteles.length,
    conPrecio: hoteles.filter((h) => h.precioDisponible).length,
    sinPrecio: hoteles.filter((h) => !h.precioDisponible).length,
    conEnlace: hoteles.filter((h) => h.url).length,
  };
  registrar('busqueda_completada', {
    ...diagnostico,
    noches,
    clavesRespuesta: Object.keys(datos),
    clavesPropiedad: propiedades[0] && typeof propiedades[0] === 'object' ? Object.keys(propiedades[0] as object) : [],
  });

  return {
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos,
    proveedor: 'SearchAPI / Booking.com',
    diagnostico,
    hoteles,
  };
}

const MENSAJE_ERROR_INTERNO =
  'Error interno al procesar los alojamientos. No significa que el destino no tenga alojamientos.';

/**
 * Igual que buscarHotelesSearchApi, pero nunca lanza: devuelve un estado
 * explícito. Lo usan la herramienta del agente y la ruta multidestino.
 */
export async function buscarHotelesConEstado(
  params: ParametrosHoteles,
  dependencias: DependenciasSearchApi = {},
): Promise<ResultadoHotelesConEstado> {
  const registrar = dependencias.registrar ?? registradorPorDefecto;
  const vacio = (estado: EstadoHoteles, error: string): ResultadoHotelesConEstado => ({
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    proveedor: 'SearchAPI / Booking.com',
    estado,
    error,
    codigoError: null,
    httpStatus: null,
    retryAfter: null,
    detalleProveedor: null,
    etapaError: null,
    diagnostico: { destinoResuelto: '', propiedadesProveedor: 0, devueltos: 0, conPrecio: 0, sinPrecio: 0, conEnlace: 0 },
    hoteles: [],
  });

  try {
    const resultado = await buscarHotelesSearchApi(params, dependencias);
    return {
      ...resultado,
      estado: resultado.hoteles.length > 0 ? 'ok' : 'sin_resultados',
      error: null,
      codigoError: null,
      httpStatus: null,
      retryAfter: null,
      detalleProveedor: null,
      etapaError: null,
    };
  } catch (error) {
    if (error instanceof HotelesProveedorError) {
      registrar('error_proveedor', {
        codigo: error.codigo,
        httpStatus: error.httpStatus,
        retryAfter: error.retryAfter,
        etapa: error.etapa,
        detalleProveedor: error.detalleProveedor,
        mensaje: error.message,
        destino: params.destino,
      });
      return {
        ...vacio('error_proveedor', error.message),
        codigoError: error.codigo,
        httpStatus: error.httpStatus,
        retryAfter: error.retryAfter,
        detalleProveedor: error.detalleProveedor,
        etapaError: error.etapa,
      };
    }
    registrar('error_interno', {
      mensaje: error instanceof Error ? error.message : String(error),
      destino: params.destino,
    });
    return { ...vacio('error_interno', MENSAJE_ERROR_INTERNO), codigoError: 'error_interno' };
  }
}
