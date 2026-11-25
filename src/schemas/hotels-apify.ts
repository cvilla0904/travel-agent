import { z } from 'zod';
import { diagnosticoHotelesSchema, estadoHotelesSchema } from './hotels.js';

/**
 * Esquema de salida del agente de alojamiento cuando el proveedor es
 * Apify / Google Hotels. Es independiente de hotels.ts (SearchAPI), que no se toca.
 *
 * Los datos que el proveedor no da (estrellas, valoración, reseñas) son null,
 * no 0: así no se confunden con una puntuación real.
 */
export const ofertaHotelSchema = z.object({
  proveedor: z.string(),
  oficial: z.boolean(),
  url: z.string(),
  precioPorNocheSinImpuestos: z.number(),
  precioTotalSinImpuestos: z.number(),
  impuestos: z.number().nullable(),
  precioTotalConImpuestos: z.number().nullable(),
  fuenteImpuestos: z.enum(['google_hoteles', 'enlace_proveedor']).nullable(),
});

export const hotelApifySchema = z.object({
  nombre: z.string(),
  tipoAlojamiento: z.string(),
  categoriaOriginal: z.string(),
  estrellas: z.number().nullable(),
  valoracion: z.number().nullable(),
  valoracionEscala: z.number().nullable(),
  numeroResenas: z.number().nullable(),
  precioDisponible: z.boolean(),
  precioTotal: z.number(),
  precioPorNoche: z.number(),
  precioSinImpuestos: z.number().nullable(),
  impuestosYTasas: z.number().nullable(),
  impuestosIncluidos: z.boolean(),
  precioCalculado: z.boolean(),
  moneda: z.string(),
  fuentePrecio: z.string(),
  url: z.string(),
  ofertaIndividual: z.boolean(),
  ofertas: z.array(ofertaHotelSchema),
  urlGoogleHoteles: z.string(),
  web: z.string(),
  direccion: z.string(),
  distanciaCentroKm: z.number().nullable(),
  latitud: z.number().nullable(),
  longitud: z.number().nullable(),
  rangoHabitualPorNoche: z.object({ min: z.number(), max: z.number() }).nullable(),
});

export const hotelApifyOutputSchema = z.object({
  destino: z.string(),
  fechaEntrada: z.string(),
  fechaSalida: z.string(),
  adultos: z.number(),
  proveedor: z.string(),
  estado: estadoHotelesSchema,
  error: z.string().nullable(),
  codigoError: z.string().nullable(),
  httpStatus: z.number().nullable(),
  retryAfter: z.string().nullable(),
  detalleProveedor: z.string().nullable(),
  etapaError: z.string().nullable(),
  diagnostico: diagnosticoHotelesSchema,
  hoteles: z.array(hotelApifySchema),
});
