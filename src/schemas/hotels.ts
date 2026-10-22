import { z } from 'zod';

/**
 * Esquema de salida del agente de alojamiento (SearchAPI / Booking.com).
 * Vive en su propio módulo para poder validarlo en pruebas sin cargar el SDK.
 *
 * `error` es nullable (no optional): el agente debe poder comunicar que la
 * búsqueda falló sin confundirlo con una lista vacía de hoteles.
 */
export const hotelSchema = z.object({
  nombre: z.string(),
  estrellas: z.number(),
  valoracion: z.number(),
  /** Escala de `valoracion`: 5 o 10 (Booking puntúa sobre 10). */
  valoracionEscala: z.number(),
  numeroResenas: z.number(),
  precioTotal: z.number(),
  precioPorNoche: z.number(),
  precioDisponible: z.boolean(),
  /** true si el total o el precio por noche se calculó a partir del otro y las noches. */
  precioCalculado: z.boolean(),
  fuentePrecio: z.string(),
  moneda: z.string(),
  habitacion: z.string(),
  disponibilidad: z.string(),
  habitacionesDisponibles: z.number(),
  cancelacionGratuita: z.boolean(),
  cancelacionHasta: z.string(),
  url: z.string(),
  imagen: z.string(),
  zona: z.string(),
  distanciaCentro: z.string(),
});

export const diagnosticoHotelesSchema = z.object({
  destinoResuelto: z.string(),
  propiedadesProveedor: z.number(),
  devueltos: z.number(),
  conPrecio: z.number(),
  sinPrecio: z.number(),
  conEnlace: z.number(),
});

export const estadoHotelesSchema = z.enum(['ok', 'sin_resultados', 'error_proveedor', 'error_interno']);

export const hotelOutputSchema = z.object({
  destino: z.string(),
  fechaEntrada: z.string(),
  fechaSalida: z.string(),
  adultos: z.number(),
  estado: estadoHotelesSchema,
  error: z.string().nullable(),
  codigoError: z.string().nullable(),
  httpStatus: z.number().nullable(),
  retryAfter: z.string().nullable(),
  detalleProveedor: z.string().nullable(),
  etapaError: z.string().nullable(),
  diagnostico: diagnosticoHotelesSchema,
  hoteles: z.array(hotelSchema),
});
