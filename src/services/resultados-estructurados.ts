/**
 * Resultados estructurados de las herramientas (vuelos, hoteles, actividades) para la web.
 *
 * Antes la web reconstruía las tarjetas leyendo con expresiones regulares el markdown que escribía el modelo: si el modelo
 * cambiaba el formato, los resultados reales desaparecían (o se contaban mal). Ahora el SERVIDOR devuelve los datos tal como
 * los entregó la herramienta (normalizados a un esquema estable y versionado) y la web construye las tarjetas directamente
 * de esos datos. El texto del Travel Manager queda solo como explicación y conversación.
 *
 * Cómo se recogen: cada herramienta, al terminar, llama a registrarBloque(); un AsyncLocalStorage creado por la petición de
 * /api/chat (conColectorResultados) los acumula, también cuando la herramienta se ejecuta dentro de un agente anidado.
 * Fuera de una petición, registrarBloque() no hace nada.
 *
 * Reglas del esquema (contrato con la web, versión 1):
 *  - Nunca se inventa un dato: lo que el proveedor no da es null (no 0, no '').
 *  - Cada importe lleva su moneda ISO 4217 (o null = «Moneda no confirmada»). No hay moneda por defecto ni conversión.
 *  - `estado` distingue resultados (ok), parciales, sin resultados y errores del proveedor / de parámetros / internos.
 *  - `total` es el número real de opciones del bloque.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { monedaIso } from './moneda.js';

export const VERSION_RESULTADOS = 1;

export type EstadoBloque = 'ok' | 'parcial' | 'sin_resultados' | 'error_proveedor' | 'error_parametros' | 'error_interno';

export interface ProveedorInfo { id: string; nombre: string }

export interface BloqueBase<T extends 'vuelos' | 'hoteles' | 'actividades', C, O> {
  tipo: T;
  proveedor: ProveedorInfo;
  estado: EstadoBloque;
  /** Fallo del proveedor/parámetros/interno (null si no hubo). Un fallo NO es «sin resultados». */
  error: string | null;
  avisos: string[];
  /** false si el resultado puede estar incompleto (estado parcial). */
  completo: boolean;
  /** Número real de opciones. */
  total: number;
  consulta: C;
  opciones: O[];
  /** Datos técnicos del fallo o de la búsqueda (HTTP, Retry-After, ejecución del actor…). Sin secretos. */
  diagnostico: Record<string, unknown> | null;
}

/* ---------- Vuelos ---------- */

export interface Importe { importe: number | null; moneda: string | null }
export interface AeropuertoRef { texto: string; iata: string | null }
export interface SegmentoVuelo {
  salida: { aeropuerto: string; codigo: string | null; hora: string | null };
  llegada: { aeropuerto: string; codigo: string | null; hora: string | null };
  duracionMinutos: number | null;
  aerolinea: string | null;
  numeroVuelo: string | null;
}
export interface TramoVuelo { fecha: string | null; duracionMinutos: number | null; escalas: number | null; segmentos: SegmentoVuelo[] }
export interface VueloOpcion {
  id: string;
  aerolineas: string[];
  tipo: string;
  esIdaVuelta: boolean;
  esDirecto: boolean | null;
  precio: Importe & { porPersona: number | null };
  ida: TramoVuelo | null;
  vuelta: TramoVuelo | null;
  enlace: string | null;
  /** true si el enlace es una búsqueda en Google Flights y no una oferta concreta. */
  enlaceEsBusqueda: boolean;
}
export type BloqueVuelos = BloqueBase<'vuelos', {
  origen: AeropuertoRef; destino: AeropuertoRef; destinoRegreso: string | null; fechaIda: string; fechaVuelta: string | null; pasajeros: number;
}, VueloOpcion>;

/* ---------- Hoteles ---------- */

export interface OfertaHotelDatos { proveedor: string; porNoche: number | null; total: number | null; enlace: string | null }
export interface HotelOpcion {
  id: string;
  nombre: string;
  tipoAlojamiento: string | null;
  estrellas: number | null;
  valoracion: number | null;
  valoracionEscala: number | null;
  numeroResenas: number | null;
  precio: {
    total: number | null; porNoche: number | null; moneda: string | null;
    disponible: boolean; calculado: boolean; impuestosIncluidos: boolean | null; fuente: string | null;
  };
  habitacion: string | null;
  disponibilidad: string | null;
  cancelacionGratuita: boolean | null;
  cancelacionHasta: string | null;
  zona: string | null;
  distanciaCentro: string | null;
  imagen: string | null;
  enlace: string | null;
  /** true si el enlace es la ficha del proveedor de búsqueda y no una oferta concreta. */
  enlaceEsAlternativo: boolean;
  ofertas: OfertaHotelDatos[];
}
export type BloqueHoteles = BloqueBase<'hoteles', { destino: string; fechaEntrada: string; fechaSalida: string; adultos: number }, HotelOpcion>;

/* ---------- Actividades ---------- */

export interface ActividadOpcion {
  id: string;
  nombre: string;
  tipo: string | null;
  plataforma: string | null;
  /** Precio «desde» orientativo del proveedor. importe null = sin precio (no es 0 ni gratis). */
  precio: Importe & { esGratis: boolean; texto: string | null };
  valoracion: number | null;
  numeroResenas: number | null;
  duracion: string | null;
  cancelacionGratuita: boolean | null;
  ciudadProveedor: string | null;
  enlace: string | null;
}
export type BloqueActividades = BloqueBase<'actividades', { destino: string; tipos: string[] }, ActividadOpcion>;

export type Bloque = BloqueVuelos | BloqueHoteles | BloqueActividades;

export interface ResultadosChat {
  version: typeof VERSION_RESULTADOS;
  vuelos: BloqueVuelos[];
  hoteles: BloqueHoteles[];
  actividades: BloqueActividades[];
}

/* =========================================================
   COLECTOR POR PETICIÓN
   ========================================================= */

const almacen = new AsyncLocalStorage<Bloque[]>();

export type EjecucionConColector<T> =
  | { ok: true; valor: T; resultados: ResultadosChat }
  | { ok: false; error: unknown; resultados: ResultadosChat };

/**
 * Ejecuta `fn` recogiendo los bloques que registren las herramientas. Si `fn` falla DESPUÉS de haber obtenido resultados reales
 * de los proveedores, esos resultados no se pierden: se devuelven junto con el error.
 */
export async function conColectorResultados<T>(fn: () => Promise<T>): Promise<EjecucionConColector<T>> {
  const bloques: Bloque[] = [];
  try {
    const valor = await almacen.run(bloques, fn);
    return { ok: true, valor, resultados: agruparBloques(bloques) };
  } catch (error) {
    return { ok: false, error, resultados: agruparBloques(bloques) };
  }
}

export function registrarBloque(bloque: Bloque): void {
  almacen.getStore()?.push(bloque);
}

export function agruparBloques(bloques: Bloque[]): ResultadosChat {
  return {
    version: VERSION_RESULTADOS,
    vuelos: bloques.filter((b): b is BloqueVuelos => b.tipo === 'vuelos'),
    hoteles: bloques.filter((b): b is BloqueHoteles => b.tipo === 'hoteles'),
    actividades: bloques.filter((b): b is BloqueActividades => b.tipo === 'actividades'),
  };
}

export function sinResultados(r: ResultadosChat): boolean {
  return !r.vuelos.length && !r.hoteles.length && !r.actividades.length;
}

/* =========================================================
   UTILIDADES
   ========================================================= */

const huella = (...partes: unknown[]) => createHash('sha1').update(partes.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 10);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const positivo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const numeroOnull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const url = (v: unknown): string | null => { const t = texto(v); return t && /^https?:\/\//i.test(t) ? t : null; };

/** Garantiza ids únicos dentro de un bloque (dos opciones idénticas se distinguen con un sufijo). */
function conIdsUnicos<T extends { id: string }>(lista: T[]): T[] {
  const vistos = new Map<string, number>();
  return lista.map((o) => {
    const n = (vistos.get(o.id) ?? 0) + 1;
    vistos.set(o.id, n);
    return n > 1 ? { ...o, id: `${o.id}-${n}` } : o;
  });
}

/* =========================================================
   VUELOS
   ========================================================= */

const ESTADOS_VUELOS = new Set<EstadoBloque>(['ok', 'parcial', 'sin_resultados', 'error_proveedor', 'error_parametros']);

export function bloqueVuelos(r: any): BloqueVuelos {
  const estado: EstadoBloque = ESTADOS_VUELOS.has(r?.estado) ? r.estado : 'error_interno';
  const esIata = (v: unknown) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
  const tramo = (t: any): TramoVuelo | null => {
    if (!t || !Array.isArray(t.segmentos) || !t.segmentos.length) return null;
    const segmentos: SegmentoVuelo[] = t.segmentos.map((s: any) => ({
      salida: { aeropuerto: String(s.aeropuertoSalida ?? ''), codigo: esIata(s.codigoSalida) ? s.codigoSalida : null, hora: texto(s.horaSalida) },
      llegada: { aeropuerto: String(s.aeropuertoLlegada ?? ''), codigo: esIata(s.codigoLlegada) ? s.codigoLlegada : null, hora: texto(s.horaLlegada) },
      duracionMinutos: positivo(s.duracionMinutos),
      aerolinea: texto(s.aerolinea),
      numeroVuelo: texto(s.numeroVuelo),
    }));
    return { fecha: texto(t.fecha), duracionMinutos: positivo(t.duracionMinutos), escalas: null, segmentos };
  };
  const opciones: VueloOpcion[] = conIdsUnicos((Array.isArray(r?.vuelos) ? r.vuelos : []).map((v: any): VueloOpcion => {
    const ida = tramo(v.ida);
    const vuelta = v.esIdaVuelta === false && !v.vuelta?.segmentos?.length ? null : tramo(v.vuelta);
    if (ida && Number.isFinite(v.escalasIda)) ida.escalas = v.escalasIda;
    if (vuelta && Number.isFinite(v.escalasVuelta)) vuelta.escalas = v.escalasVuelta;
    const enlace = url(v.enlace);
    const importe = positivo(v.precioTotal);
    const aerolineas = String(v.aerolinea ?? '').split(/\s*\+\s*/).map((a) => a.trim()).filter(Boolean);
    return {
      id: `vu-${huella(aerolineas.join('+'), v.tipo, ida?.fecha, vuelta?.fecha, ida?.segmentos[0]?.salida.hora, ida?.segmentos[0]?.numeroVuelo, importe, enlace)}`,
      aerolineas,
      tipo: String(v.tipo ?? ''),
      esIdaVuelta: Boolean(v.esIdaVuelta),
      esDirecto: typeof v.esDirecto === 'boolean' ? v.esDirecto : null,
      precio: { importe, moneda: importe === null ? null : monedaIso(v.moneda), porPersona: positivo(v.precioPorPersona) },
      ida,
      vuelta,
      enlace,
      enlaceEsBusqueda: /google\.com\/travel\/flights/i.test(enlace ?? ''),
    };
  }));
  return {
    tipo: 'vuelos',
    proveedor: { id: 'apify-google-flights', nombre: 'Google Flights (Apify)' },
    estado,
    error: estado === 'ok' || estado === 'sin_resultados' ? null : texto(r?.error),
    avisos: Array.isArray(r?.avisos) ? r.avisos.map(String) : [],
    completo: estado === 'ok' || estado === 'sin_resultados',
    total: opciones.length,
    consulta: {
      origen: { texto: String(r?.origen ?? ''), iata: esIata(r?.aeropuertoOrigen) ? r.aeropuertoOrigen : null },
      destino: { texto: String(r?.destino ?? ''), iata: esIata(r?.aeropuertoDestino) ? r.aeropuertoDestino : null },
      destinoRegreso: texto(r?.destinoRegreso),
      fechaIda: String(r?.fechaIda ?? ''),
      fechaVuelta: texto(r?.fechaVuelta),
      pasajeros: Number(r?.pasajeros) || 1,
    },
    opciones,
    diagnostico: Array.isArray(r?.direccionesConError) && r.direccionesConError.length ? { direccionesConError: r.direccionesConError } : null,
  };
}

/* =========================================================
   HOTELES (SearchAPI y Apify con el mismo formato)
   ========================================================= */

export function bloqueHoteles(r: any, proveedorId: 'searchapi' | 'apify'): BloqueHoteles {
  const estadoCrudo = String(r?.estado ?? '');
  const estado: EstadoBloque = estadoCrudo === 'ok' || estadoCrudo === 'sin_resultados' || estadoCrudo === 'error_proveedor' || estadoCrudo === 'error_interno'
    ? estadoCrudo : 'error_interno';
  const opciones: HotelOpcion[] = conIdsUnicos((Array.isArray(r?.hoteles) ? r.hoteles : []).map((h: any): HotelOpcion => {
    const total = h.precioDisponible ? positivo(h.precioTotal) : null;
    const porNoche = h.precioDisponible ? positivo(h.precioPorNoche) : null;
    const hayPrecio = total !== null || porNoche !== null;
    const enlaceOferta = url(h.url);
    const enlace = enlaceOferta ?? url(h.urlGoogleHoteles);
    const valoracion = positivo(h.valoracion);
    return {
      id: `ho-${huella(h.nombre, enlace, total, porNoche)}`,
      nombre: String(h.nombre ?? ''),
      tipoAlojamiento: texto(h.tipoAlojamiento),
      estrellas: positivo(h.estrellas),
      valoracion,
      valoracionEscala: valoracion === null ? null : positivo(h.valoracionEscala),
      numeroResenas: positivo(h.numeroResenas),
      precio: {
        total, porNoche,
        moneda: hayPrecio ? monedaIso(h.moneda) : null,
        disponible: hayPrecio,
        calculado: hayPrecio && Boolean(h.precioCalculado),
        impuestosIncluidos: typeof h.impuestosIncluidos === 'boolean' ? h.impuestosIncluidos : null,
        fuente: hayPrecio ? texto(h.fuentePrecio) : null,
      },
      habitacion: texto(h.habitacion),
      disponibilidad: texto(h.disponibilidad),
      cancelacionGratuita: typeof h.cancelacionGratuita === 'boolean' ? (h.cancelacionGratuita ? true : null) : null,
      cancelacionHasta: texto(h.cancelacionHasta),
      zona: texto(h.zona) ?? texto(h.direccion),
      distanciaCentro: texto(h.distanciaCentro) ?? (positivo(h.distanciaCentroKm) !== null ? `${h.distanciaCentroKm} km` : null),
      imagen: url(h.imagen),
      enlace,
      enlaceEsAlternativo: !enlaceOferta && enlace !== null,
      ofertas: (Array.isArray(h.ofertas) ? h.ofertas : []).map((o: any): OfertaHotelDatos => ({
        proveedor: String(o.proveedor ?? ''),
        porNoche: positivo(o.precioPorNocheSinImpuestos),
        total: positivo(o.precioTotalConImpuestos) ?? positivo(o.precioTotalSinImpuestos),
        enlace: url(o.url),
      })).filter((o: OfertaHotelDatos) => o.proveedor || o.enlace),
    };
  }));
  const avisos: string[] = [];
  if (r?.diagnostico && Number(r.diagnostico.sinPrecio) > 0 && opciones.length) avisos.push(`${r.diagnostico.sinPrecio} alojamiento(s) sin precio publicado por el proveedor.`);
  const fallo = estado === 'error_proveedor' || estado === 'error_interno';
  return {
    tipo: 'hoteles',
    proveedor: proveedorId === 'apify' ? { id: 'apify-google-hotels', nombre: 'Google Hotels (Apify)' } : { id: 'searchapi-booking', nombre: 'Booking.com (SearchAPI)' },
    estado,
    error: fallo ? texto(r?.error) : null,
    avisos,
    completo: !fallo,
    total: opciones.length,
    consulta: { destino: String(r?.destino ?? ''), fechaEntrada: String(r?.fechaEntrada ?? ''), fechaSalida: String(r?.fechaSalida ?? ''), adultos: Number(r?.adultos) || 1 },
    opciones,
    diagnostico: fallo
      ? { codigoError: r?.codigoError ?? null, httpStatus: r?.httpStatus ?? null, retryAfter: r?.retryAfter ?? null, etapa: r?.etapaError ?? null, detalleProveedor: r?.detalleProveedor ?? null }
      : (r?.diagnostico ?? null),
  };
}

/* =========================================================
   ACTIVIDADES
   ========================================================= */

export function bloqueActividades(r: any): BloqueActividades {
  const mapa: Record<string, EstadoBloque> = { ok: 'ok', parcial: 'parcial', sin_resultados: 'sin_resultados', error: 'error_proveedor' };
  const estado: EstadoBloque = mapa[String(r?.estado)] ?? 'error_interno';
  const opciones: ActividadOpcion[] = conIdsUnicos((Array.isArray(r?.actividades) ? r.actividades : []).map((a: any): ActividadOpcion => {
    const importe = typeof a.precio === 'number' && Number.isFinite(a.precio) && a.precio > 0 ? a.precio : null;
    const enlace = url(a.url);
    return {
      id: `ac-${huella(a.nombre, enlace, importe)}`,
      nombre: String(a.nombre ?? ''),
      tipo: texto(a.tipo),
      plataforma: texto(a.plataforma),
      precio: {
        importe,
        moneda: importe === null ? null : monedaIso(a.moneda),
        esGratis: Boolean(a.esGratis) && importe === null,
        texto: texto(a.precioTexto),
      },
      valoracion: positivo(a.valoracion),
      numeroResenas: positivo(a.numeroResenas),
      duracion: texto(a.duracion),
      cancelacionGratuita: typeof a.cancelacionGratuita === 'boolean' ? (a.cancelacionGratuita ? true : null) : null,
      ciudadProveedor: texto(a.ciudadProveedor) ?? texto(a.ciudad),
      enlace,
    };
  }));
  const incompleto = estado === 'parcial';
  const avisos = incompleto && texto(r?.mensaje) ? [String(r.mensaje)] : [];
  return {
    tipo: 'actividades',
    proveedor: { id: 'apify-civitatis', nombre: 'Civitatis (Apify)' },
    estado,
    error: estado === 'error_proveedor' || estado === 'error_interno' ? texto(r?.mensaje) : null,
    avisos: estado === 'sin_resultados' && texto(r?.mensaje) ? [String(r.mensaje)] : avisos,
    completo: !incompleto && estado !== 'error_proveedor' && estado !== 'error_interno',
    total: opciones.length,
    consulta: { destino: String(r?.destino ?? ''), tipos: Array.isArray(r?.tipos) ? r.tipos.map(String) : [] },
    opciones,
    diagnostico: {
      ...(r?.proveedor ? { proveedor: r.proveedor } : {}),
      ...(r?.motivo ? { motivo: r.motivo } : {}),
      ...(r?.diagnosticoBusqueda ? { busqueda: r.diagnosticoBusqueda } : {}),
    },
  };
}

/** Bloque de actividades de una ciudad en una ruta multidestino (la herramienta ya filtró por ciudad). */
export function bloqueActividadesMultidestino(args: {
  ciudad: string; tipos: string[]; actividades: any[]; error: string | null; completa: boolean; motivoIncompleta?: string | undefined;
}): BloqueActividades {
  const estado = args.error ? 'error' : args.actividades.length ? (args.completa ? 'ok' : 'parcial') : args.completa ? 'sin_resultados' : 'parcial';
  const mensaje = args.error
    ? `No se pudo consultar el proveedor de actividades: ${args.error}`
    : !args.completa ? 'Resultados parciales: el proveedor no había terminado de buscar cuando se leyó el resultado.'
    : !args.actividades.length ? 'El proveedor no devolvió actividades verificadas para esta ciudad.' : null;
  return bloqueActividades({
    destino: args.ciudad, tipos: args.tipos, estado, mensaje, actividades: args.actividades,
    proveedor: { completa: args.completa, ...(args.motivoIncompleta ? { motivoIncompleta: args.motivoIncompleta } : {}) },
  });
}
