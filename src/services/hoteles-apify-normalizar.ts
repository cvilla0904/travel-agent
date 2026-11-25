/**
 * Normalización de las filas del actor `eiv/google-hotels-scraper` (Google Hotels)
 * al modelo de hoteles de Mogavel. Es lógica pura y sin red: se prueba con los
 * datasets reales guardados como fixtures (test/fixtures/hoteles-apify-*.json).
 *
 * Reglas (acordadas con el usuario):
 *  - Precio y enlace salen SIEMPRE de la misma oferta.
 *  - Se excluyen las ofertas de Super.com y las `memberDeal` (precio para miembros).
 *  - Filtro por mediana: se descarta la oferta que se aleja más de ×1,5 de la
 *    mediana del hotel (por arriba o por abajo). Requiere al menos 3 ofertas.
 *  - Hotel con una sola oferta: se muestra como oferta individual, sin comparación.
 *  - El total mostrado incluye impuestos SOLO cuando el dato está justificado
 *    (Google Hotels, o el propio enlace de Booking/Agoda). Si no, el total se
 *    marca como "sin impuestos"; nunca se estiman impuestos.
 *  - Sin valoración/estrellas: se devuelve null, no 0.
 */
import { aNumero } from './searchapi.js';

export const UMBRAL_MEDIANA_POR_DEFECTO = 1.5;
/** Mínimo de ofertas para que la mediana tenga sentido. */
export const MIN_OFERTAS_PARA_MEDIANA = 3;
/** Proveedores excluidos inicialmente (nombre o dominio). */
export const PROVEEDORES_EXCLUIDOS_POR_DEFECTO: readonly string[] = ['super.com'];
export const MAX_OFERTAS_MOSTRADAS = 4;
export const MAX_HOTELES = 10;
/** Tolerancia para dar por coherentes dos importes (redondeos del proveedor). */
const TOLERANCIA_EUR = 6;
const TOLERANCIA_RELATIVA = 0.02;
/** Hasta esta distancia al centro un hotel se acepta sin más comprobaciones. */
export const RADIO_SEGURO_KM = 8;
/** Entre RADIO_SEGURO_KM y este radio solo se acepta si la dirección nombra la ciudad. */
export const RADIO_MAXIMO_KM = 30;

export type TipoAlojamiento =
  | 'hotel'
  | 'hostal'
  | 'resort'
  | 'apartamento vacacional'
  | 'alojamiento con desayuno (B&B)'
  | 'casa de huéspedes'
  | 'motel'
  | 'posada'
  | 'alojamiento';

export type FuenteImpuestos = 'google_hoteles' | 'enlace_proveedor';

export interface OfertaHotel {
  proveedor: string;
  oficial: boolean;
  url: string;
  /** Precio por noche de la oferta, SIN impuestos (tal cual lo publica el actor). */
  precioPorNocheSinImpuestos: number;
  /** Total de la estancia de la oferta, SIN impuestos. */
  precioTotalSinImpuestos: number;
  impuestos: number | null;
  /** Total con impuestos, solo si el dato está respaldado (ver fuenteImpuestos). */
  precioTotalConImpuestos: number | null;
  fuenteImpuestos: FuenteImpuestos | null;
}

export interface HotelApify {
  nombre: string;
  tipoAlojamiento: TipoAlojamiento;
  categoriaOriginal: string;
  estrellas: number | null;
  valoracion: number | null;
  valoracionEscala: number | null;
  numeroResenas: number | null;
  precioDisponible: boolean;
  /** Total de la estancia. Incluye impuestos si impuestosIncluidos es true. */
  precioTotal: number;
  /** precioTotal / noches (derivado). */
  precioPorNoche: number;
  precioSinImpuestos: number | null;
  impuestosYTasas: number | null;
  impuestosIncluidos: boolean;
  precioCalculado: boolean;
  moneda: string;
  /** Proveedor de la oferta cuyo precio se muestra (y cuyo enlace es `url`). */
  fuentePrecio: string;
  /** Enlace de la MISMA oferta que fuentePrecio. Vacío si no hay oferta válida. */
  url: string;
  ofertaIndividual: boolean;
  ofertas: OfertaHotel[];
  /** Ficha de Google Hotels; solo como alternativa cuando no hay oferta válida. */
  urlGoogleHoteles: string;
  web: string;
  direccion: string;
  distanciaCentroKm: number | null;
  latitud: number | null;
  longitud: number | null;
  /** Referencia de Google (rango "habitual"), solo informativa. */
  rangoHabitualPorNoche: { min: number; max: number } | null;
}

export interface DiagnosticoApify {
  filasActor: number;
  filasHotel: number;
  descartadasPaisOUbicacion: number;
  duplicadas: number;
  ubicacionVerificada: boolean;
  ofertasTotales: number;
  ofertasExcluidasProveedor: number;
  ofertasMemberDeal: number;
  ofertasInvalidas: number;
  ofertasAtipicas: number;
  hotelesSinOfertaValida: number;
  hotelesConOfertaIndividual: number;
  hotelesConImpuestosIncluidos: number;
}

export interface OpcionesNormalizacion {
  noches: number;
  moneda?: string;
  /** Código ISO-2 (cualquier caja) del país esperado. */
  paisCodigo?: string | undefined;
  /** Centro de la ciudad y nombre(s) aceptables para validar la ubicación. */
  /** `radioKm`: radio seguro propio cuando el destino es una zona (p. ej. el Salento de Lecce); por defecto RADIO_SEGURO_KM. */
  centro?: { lat: number; lng: number; radioKm?: number } | null;
  nombresCiudad?: string[];
  umbralMediana?: number;
  proveedoresExcluidos?: readonly string[];
  limite?: number;
}

/* ----------------------------- utilidades ----------------------------- */

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function claveTexto(valor: string): string {
  return valor.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** Texto en palabras (minúsculas, sin acentos ni signos), rodeado de espacios: «Vereda Cocora, Salento» -> « vereda cocora salento ». */
function enPalabras(valor: string): string {
  const t = valor.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return t ? ` ${t} ` : '';
}

/**
 * ¿La dirección nombra la ciudad como PALABRA(S) completas? Evita las coincidencias accidentales de los alias cortos
 * («bud» dentro de «Budapest», «mad» en «Madison», «bog» en «Bogor»). Las variantes largas o con espacios («el cairo») siguen valiendo.
 */
export function direccionNombraCiudad(direccion: string, nombre: string): boolean {
  const d = enPalabras(direccion);
  const n = enPalabras(nombre);
  return !!d && !!n && d.includes(n);
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function positivo(valor: unknown): number | null {
  const n = aNumero(valor);
  return n !== null && n > 0 ? n : null;
}

export function mediana(valores: number[]): number {
  const orden = [...valores].sort((a, b) => a - b);
  const m = Math.floor(orden.length / 2);
  return orden.length % 2 ? orden[m]! : (orden[m - 1]! + orden[m]!) / 2;
}

export function distanciaKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

function urlValida(valor: unknown): string {
  const u = texto(valor);
  if (!/^https?:\/\//i.test(u)) return '';
  try {
    return new URL(u).href ? u : '';
  } catch {
    return '';
  }
}

function hostDe(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/* ------------------------- tipo de alojamiento ------------------------ */

export function clasificarAlojamiento(categoria: unknown): TipoAlojamiento {
  const c = texto(categoria).toLowerCase();
  if (!c) return 'alojamiento';
  if (/hostel/.test(c)) return 'hostal';
  if (/resort/.test(c)) return 'resort';
  if (/vacation rental|apartment|apartamento|holiday home|villa/.test(c)) return 'apartamento vacacional';
  if (/bed and breakfast|bed & breakfast|b&b/.test(c)) return 'alojamiento con desayuno (B&B)';
  if (/guest ?house|casa de hu/.test(c)) return 'casa de huéspedes';
  if (/motel/.test(c)) return 'motel';
  if (/\binn\b|posada/.test(c)) return 'posada';
  if (/hotel/.test(c)) return 'hotel';
  return 'alojamiento';
}

/* ------------------------------ ubicación ----------------------------- */

export interface ResultadoUbicacion {
  ok: boolean;
  motivo: 'ok' | 'pais' | 'lejos' | 'sin_coordenadas';
  distanciaKm: number | null;
}

export function validarUbicacion(
  fila: Record<string, unknown>,
  opciones: Pick<OpcionesNormalizacion, 'paisCodigo' | 'centro' | 'nombresCiudad'>,
): ResultadoUbicacion {
  const pais = texto(fila.countryCode).toUpperCase();
  const esperado = texto(opciones.paisCodigo).toUpperCase();
  if (esperado && pais && pais !== esperado) return { ok: false, motivo: 'pais', distanciaKm: null };

  const lat = aNumero(fila.latitude);
  const lon = aNumero(fila.longitude);
  const centro = opciones.centro;
  if (!centro) return { ok: true, motivo: 'ok', distanciaKm: null };
  if (lat === null || lon === null) return { ok: false, motivo: 'sin_coordenadas', distanciaKm: null };

  const d = redondear(distanciaKm(lat, lon, centro.lat, centro.lng));
  const seguro = centro.radioKm ?? RADIO_SEGURO_KM;
  const maximo = seguro + (RADIO_MAXIMO_KM - RADIO_SEGURO_KM);
  if (d <= seguro) return { ok: true, motivo: 'ok', distanciaKm: d };
  if (d <= maximo) {
    const direccion = texto(fila.address);
    const nombra = (opciones.nombresCiudad ?? []).some((n) => direccionNombraCiudad(direccion, n));
    if (nombra) return { ok: true, motivo: 'ok', distanciaKm: d };
  }
  return { ok: false, motivo: 'lejos', distanciaKm: d };
}

/* -------------------------------- ofertas ------------------------------ */

function incoherente(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(TOLERANCIA_EUR, Math.abs(b) * TOLERANCIA_RELATIVA);
}

/** Margen mayor, para DESCARTAR una oferta cuyo importe contradice claramente a otra fuente (suelen ser tasas de limpieza). */
const TOLERANCIA_CONTRADICCION = 0.05;
function contradice(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(TOLERANCIA_EUR, Math.abs(b) * TOLERANCIA_CONTRADICCION);
}

/**
 * Precio que el propio enlace de Booking.com o Agoda lleva incrustado (total con impuestos
 * e impuestos). null si el proveedor no es uno de esos dos, faltan los datos o la moneda
 * del enlace no es la esperada.
 */
export function leerPrecioEnlace(url: string, moneda: string): { total: number; impuestos: number } | null {
  const host = hostDe(url);
  const esBooking = host.endsWith('booking.com');
  const esAgoda = host.endsWith('agoda.com');
  if (!esBooking && !esAgoda) return null;
  let q: URLSearchParams;
  try {
    q = new URL(url).searchParams;
  } catch {
    return null;
  }
  const minus = new Map<string, string>();
  q.forEach((v, k) => minus.set(k.toLowerCase(), v));
  const total = positivo(esBooking ? minus.get('ext_price_total') : minus.get('pricetotal'));
  const impuestos = aNumero(esBooking ? minus.get('ext_price_tax') : minus.get('pricetax'));
  const monedaUrl = (esBooking ? minus.get('selected_currency') : minus.get('currency'))?.toUpperCase();
  if (total === null || impuestos === null || impuestos < 0) return null;
  if (monedaUrl && monedaUrl !== moneda.toUpperCase()) return null;
  return { total: redondear(total), impuestos: redondear(impuestos) };
}

/**
 * Total con impuestos respaldado por el enlace. Solo se acepta si cuadra con el total sin
 * impuestos de la oferta (total_enlace − impuestos_enlace ≈ totalStayPrice).
 */
export function impuestosDesdeEnlace(
  _proveedor: string,
  url: string,
  totalSinImpuestos: number,
  moneda: string,
): { total: number; impuestos: number } | null {
  const enlace = leerPrecioEnlace(url, moneda);
  if (!enlace || incoherente(enlace.total - enlace.impuestos, totalSinImpuestos)) return null;
  return enlace;
}

export interface ResultadoOfertas {
  ofertas: OfertaHotel[];
  excluidasProveedor: number;
  memberDeal: number;
  invalidas: number;
  atipicas: number;
  /** Ofertas que sobrevivieron a las exclusiones y a la mediana, antes de recortar a las mostradas. */
  validas: number;
}

function proveedorExcluido(proveedor: string, url: string, excluidos: readonly string[]): boolean {
  const host = hostDe(url);
  const claveProveedor = claveTexto(proveedor);
  return excluidos.some((e) => {
    const dominio = e.toLowerCase();
    return claveTexto(e) === claveProveedor || host === dominio || host.endsWith(`.${dominio}`);
  });
}

export function procesarOfertas(
  fila: Record<string, any>,
  noches: number,
  moneda: string,
  opciones: Pick<OpcionesNormalizacion, 'umbralMediana' | 'proveedoresExcluidos'> = {},
): ResultadoOfertas {
  const umbral = opciones.umbralMediana ?? UMBRAL_MEDIANA_POR_DEFECTO;
  const excluidos = opciones.proveedoresExcluidos ?? PROVEEDORES_EXCLUIDOS_POR_DEFECTO;
  const crudas: unknown[] = Array.isArray(fila.bookingOptions) ? fila.bookingOptions : [];

  let excluidasProveedor = 0;
  let memberDeal = 0;
  let invalidas = 0;
  const candidatas: OfertaHotel[] = [];

  const totalGoogle = positivo(fila.totalPrice);
  const antesImpuestosGoogle = positivo(fila.totalPriceBeforeTaxes);
  const impuestosGoogle = aNumero(fila.taxesAndFees);
  const minimoGoogle = positivo(fila.lowestPrice);
  const proveedorMinimoGoogle = texto(fila.lowestPriceProvider);

  for (const cruda of crudas) {
    if (typeof cruda !== 'object' || cruda === null) { invalidas++; continue; }
    const o = cruda as Record<string, unknown>;
    const proveedor = texto(o.provider);
    const url = urlValida(o.bookingUrl);
    const porNoche = positivo(o.nightlyPrice);
    const total = positivo(o.totalStayPrice);
    if (!proveedor || !url || porNoche === null || total === null) { invalidas++; continue; }
    if (proveedorExcluido(proveedor, url, excluidos)) { excluidasProveedor++; continue; }
    if (o.memberDeal) { memberDeal++; continue; }
    // El total debe cuadrar con el precio por noche × noches: si no, el importe no es justificable.
    if (incoherente(porNoche * noches, total)) { invalidas++; continue; }
    // El enlace de Booking/Agoda lleva su propio precio: si contradice el de la oferta, no se muestra.
    const precioEnlace = leerPrecioEnlace(url, moneda);
    if (precioEnlace && contradice(precioEnlace.total - precioEnlace.impuestos, total)) { invalidas++; continue; }

    let impuestos: number | null = null;
    let conImpuestos: number | null = null;
    let fuente: FuenteImpuestos | null = null;

    const esMinimoGoogle =
      minimoGoogle !== null &&
      claveTexto(proveedor) === claveTexto(proveedorMinimoGoogle) &&
      Math.abs(porNoche - minimoGoogle) < 0.5;
    // La oferta que Google marca como la más barata debe cuadrar con el desglose de Google.
    if (esMinimoGoogle && antesImpuestosGoogle !== null && contradice(antesImpuestosGoogle, total)) { invalidas++; continue; }
    if (
      esMinimoGoogle && totalGoogle !== null && impuestosGoogle !== null && impuestosGoogle >= 0 &&
      antesImpuestosGoogle !== null && !incoherente(antesImpuestosGoogle, total) &&
      !incoherente(antesImpuestosGoogle + impuestosGoogle, totalGoogle)
    ) {
      impuestos = redondear(impuestosGoogle);
      conImpuestos = redondear(totalGoogle);
      fuente = 'google_hoteles';
    } else {
      const desdeEnlace = impuestosDesdeEnlace(proveedor, url, total, moneda);
      if (desdeEnlace) {
        impuestos = desdeEnlace.impuestos;
        conImpuestos = desdeEnlace.total;
        fuente = 'enlace_proveedor';
      }
    }

    candidatas.push({
      proveedor,
      oficial: o.isOfficialSite === true,
      url,
      precioPorNocheSinImpuestos: redondear(porNoche),
      precioTotalSinImpuestos: redondear(total),
      impuestos,
      precioTotalConImpuestos: conImpuestos,
      fuenteImpuestos: fuente,
    });
  }

  // Una oferta por proveedor: la más barata.
  const porProveedor = new Map<string, OfertaHotel>();
  for (const o of candidatas) {
    const clave = claveTexto(o.proveedor);
    const previa = porProveedor.get(clave);
    if (!previa || o.precioPorNocheSinImpuestos < previa.precioPorNocheSinImpuestos) porProveedor.set(clave, o);
  }
  const unicas = [...porProveedor.values()];

  // Filtro por mediana (solo con muestra suficiente).
  let atipicas = 0;
  let validas = unicas;
  if (unicas.length >= MIN_OFERTAS_PARA_MEDIANA) {
    const m = mediana(unicas.map((o) => o.precioPorNocheSinImpuestos));
    validas = unicas.filter((o) => {
      const ok = o.precioPorNocheSinImpuestos <= m * umbral && o.precioPorNocheSinImpuestos >= m / umbral;
      if (!ok) atipicas++;
      return ok;
    });
  }

  validas.sort((a, b) => a.precioPorNocheSinImpuestos - b.precioPorNocheSinImpuestos);
  // Se muestran las más baratas, pero la oferta oficial no se pierde.
  let mostradas = validas.slice(0, MAX_OFERTAS_MOSTRADAS);
  const oficial = validas.find((o) => o.oficial);
  if (oficial && !mostradas.includes(oficial)) mostradas = [...mostradas.slice(0, MAX_OFERTAS_MOSTRADAS - 1), oficial];

  return { ofertas: mostradas, excluidasProveedor, memberDeal, invalidas, atipicas, validas: validas.length };
}

/* ------------------------------- hoteles ------------------------------- */

function elegirPrincipal(ofertas: OfertaHotel[]): OfertaHotel | undefined {
  return [...ofertas].sort(
    (a, b) =>
      a.precioPorNocheSinImpuestos - b.precioPorNocheSinImpuestos ||
      Number(b.precioTotalConImpuestos !== null) - Number(a.precioTotalConImpuestos !== null) ||
      Number(b.oficial) - Number(a.oficial),
  )[0];
}

export function normalizarFila(
  fila: Record<string, any>,
  opciones: OpcionesNormalizacion,
  ubicacion: ResultadoUbicacion,
): { hotel: HotelApify; resultadoOfertas: ResultadoOfertas } {
  const moneda = (texto(fila.currency) || opciones.moneda || 'EUR').toUpperCase();
  const noches = opciones.noches > 0 ? opciones.noches : 1;
  const resultadoOfertas = procesarOfertas(fila, noches, moneda, opciones);
  const { ofertas } = resultadoOfertas;
  const principal = elegirPrincipal(ofertas);

  let precioTotal = 0;
  let precioSinImpuestos: number | null = null;
  let impuestosYTasas: number | null = null;
  let impuestosIncluidos = false;
  if (principal) {
    if (principal.precioTotalConImpuestos !== null) {
      precioTotal = principal.precioTotalConImpuestos;
      precioSinImpuestos = principal.precioTotalSinImpuestos;
      impuestosYTasas = principal.impuestos;
      impuestosIncluidos = true;
    } else {
      precioTotal = principal.precioTotalSinImpuestos;
      precioSinImpuestos = principal.precioTotalSinImpuestos;
    }
  }
  const precioDisponible = principal !== undefined && precioTotal > 0;

  const rating = positivo(fila.rating);
  const resenas = positivo(fila.reviewsCount);
  const clase = positivo(fila.hotelClass);
  const baja = positivo(fila.typicalPriceLow);
  const alta = positivo(fila.typicalPriceHigh);

  const hotel: HotelApify = {
    nombre: texto(fila.name),
    tipoAlojamiento: clasificarAlojamiento(fila.category),
    categoriaOriginal: texto(fila.category),
    estrellas: clase !== null ? Math.min(5, Math.round(clase)) : null,
    valoracion: rating,
    valoracionEscala: rating !== null ? (rating > 5 ? 10 : 5) : null,
    numeroResenas: resenas !== null ? Math.round(resenas) : null,
    precioDisponible,
    precioTotal: precioDisponible ? redondear(precioTotal) : 0,
    precioPorNoche: precioDisponible ? redondear(precioTotal / noches) : 0,
    precioSinImpuestos: precioDisponible ? precioSinImpuestos : null,
    impuestosYTasas: precioDisponible ? impuestosYTasas : null,
    impuestosIncluidos: precioDisponible && impuestosIncluidos,
    precioCalculado: precioDisponible,
    moneda,
    fuentePrecio: principal?.proveedor ?? '',
    url: principal?.url ?? '',
    ofertaIndividual: ofertas.length === 1,
    // La oferta principal va primero.
    ofertas: principal ? [principal, ...ofertas.filter((o) => o !== principal)] : [],
    urlGoogleHoteles: urlValida(fila.url),
    web: urlValida(fila.website),
    direccion: texto(fila.address),
    distanciaCentroKm: ubicacion.distanciaKm,
    latitud: aNumero(fila.latitude),
    longitud: aNumero(fila.longitude),
    rangoHabitualPorNoche: baja !== null && alta !== null && alta >= baja ? { min: baja, max: alta } : null,
  };
  return { hotel, resultadoOfertas };
}

export function normalizarFilasApify(
  filas: unknown[],
  opciones: OpcionesNormalizacion,
): { hoteles: HotelApify[]; diagnostico: DiagnosticoApify } {
  const limite = opciones.limite ?? MAX_HOTELES;
  const diagnostico: DiagnosticoApify = {
    filasActor: filas.length,
    filasHotel: 0,
    descartadasPaisOUbicacion: 0,
    duplicadas: 0,
    ubicacionVerificada: Boolean(opciones.centro),
    ofertasTotales: 0,
    ofertasExcluidasProveedor: 0,
    ofertasMemberDeal: 0,
    ofertasInvalidas: 0,
    ofertasAtipicas: 0,
    hotelesSinOfertaValida: 0,
    hotelesConOfertaIndividual: 0,
    hotelesConImpuestosIncluidos: 0,
  };
  const hoteles: HotelApify[] = [];
  const vistos = new Set<string>();

  for (const cruda of filas) {
    if (typeof cruda !== 'object' || cruda === null) continue;
    const fila = cruda as Record<string, any>;
    // Las filas de error del actor (NOT_FOUND, BLOCKED...) no son alojamientos.
    if (fila.recordType !== undefined && fila.recordType !== 'hotel') continue;
    if (!texto(fila.name)) continue;
    diagnostico.filasHotel++;

    const clave =
      texto(fila.hotelId) || texto(fila.placeId) ||
      `${claveTexto(texto(fila.name))}|${aNumero(fila.latitude)?.toFixed(4)}|${aNumero(fila.longitude)?.toFixed(4)}`;
    if (vistos.has(clave)) { diagnostico.duplicadas++; continue; }
    vistos.add(clave);

    const ubicacion = validarUbicacion(fila, opciones);
    if (!ubicacion.ok) { diagnostico.descartadasPaisOUbicacion++; continue; }

    const { hotel, resultadoOfertas: r } = normalizarFila(fila, opciones, ubicacion);
    diagnostico.ofertasTotales += Array.isArray(fila.bookingOptions) ? fila.bookingOptions.length : 0;
    diagnostico.ofertasExcluidasProveedor += r.excluidasProveedor;
    diagnostico.ofertasMemberDeal += r.memberDeal;
    diagnostico.ofertasInvalidas += r.invalidas;
    diagnostico.ofertasAtipicas += r.atipicas;
    if (!hotel.precioDisponible) diagnostico.hotelesSinOfertaValida++;
    if (hotel.ofertaIndividual) diagnostico.hotelesConOfertaIndividual++;
    if (hotel.impuestosIncluidos) diagnostico.hotelesConImpuestosIncluidos++;
    hoteles.push(hotel);
    if (hoteles.length >= limite) break;
  }
  return { hoteles, diagnostico };
}
