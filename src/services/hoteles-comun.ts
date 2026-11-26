/**
 * Tipos y utilidades comunes de la búsqueda de hoteles (proveedor único: Apify / Google Hotels, ver apify-hoteles.ts).
 *
 * Reglas:
 *  - Un error del proveedor NUNCA se convierte en una lista vacía: se lanza HotelesProveedorError
 *    y `buscarHotelesConEstado` lo comunica con estado 'error_proveedor'.
 *  - No se asume ningún dato: lo que el proveedor no da queda a 0 / '' y se presenta como "no disponible".
 */

export type CodigoErrorHoteles =
  | 'configuracion'
  | 'parametros'
  | 'autenticacion'
  | 'limite_uso'
  | 'limite_peticiones'
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

export function calcularNoches(fechaEntrada: string, fechaSalida: string): number {
  const dias = (Date.parse(`${fechaSalida}T00:00:00Z`) - Date.parse(`${fechaEntrada}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(dias) && dias >= 1 ? Math.round(dias) : 1;
}


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
