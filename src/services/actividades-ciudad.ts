/**
 * Filtro geográfico de actividades. Nunca mostramos una actividad de otra ciudad.
 *
 * Las equivalencias de nombres (Bruselas/Brussels/Bruxelles, Viena/Vienna/Wien, Praga/Prague/Praha…)
 * salen de `variantesCiudad()` (ciudades.ts), la misma fuente que usa Booking; aquí no hay tabla propia.
 */
import { normalizarTexto, variantesCiudad, consultaProveedorParaCiudad, datosCiudad } from './ciudades.js';
import { extraerPrecio, esGratisVerificado, extraerMoneda } from './precios-actividades.js';

/** Quita los decorados que algunos proveedores añaden a la ciudad ("Things to do Vienna"). */
function limpiarCiudadProveedor(ciudad: string): string {
  return ciudad
    .replace(/^(atracciones|attractions|things to do)\s+/, '')
    .replace(/\s+(attractions|things to do)$/, '')
    .trim();
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Radio (km) alrededor del centro de la ciudad en el que una actividad se considera «en el destino». */
export const RADIO_DESTINO_KM = 30;
/** Si la etiqueta de ciudad coincide pero las coordenadas caen más lejos que esto, se descarta por incoherente. */
export const RADIO_INCOHERENCIA_KM = 60;

export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Coordenadas utilizables del registro del proveedor, o null (ausentes, no numéricas, fuera de rango o 0,0). */
export function coordenadasActividad(actividad: any): { lat: number; lng: number } | null {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const lat = num(actividad?.latitude);
  const lng = num(actividad?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export type VerificacionUbicacion =
  | 'ciudad' // la etiqueta del proveedor coincide con el destino (y las coordenadas, si las hay, no la contradicen)
  | 'coordenadas' // la etiqueta no coincide, pero las coordenadas caen dentro del radio del destino
  | 'titulo'; // sin ciudad ni coordenadas: el título menciona el destino como palabra completa

export type MotivoDescarte =
  | 'ciudad_distinta_sin_coordenadas' // etiqueta de otra ciudad y no hay coordenadas para comprobarlo
  | 'ciudad_distinta_y_coordenadas_lejos' // etiqueta de otra ciudad y las coordenadas confirman que está lejos
  | 'coordenadas_contradicen_etiqueta' // la etiqueta coincide pero las coordenadas están muy lejos
  | 'sin_ciudad_ni_mencion'; // ni ciudad, ni coordenadas, ni mención en el título

export type EvaluacionUbicacion = {
  ok: boolean;
  verificacion?: VerificacionUbicacion;
  motivo?: MotivoDescarte;
  /** Etiqueta de ciudad tal y como la devolvió el proveedor (trazabilidad). */
  ciudadProveedor: string | null;
  distanciaKm?: number | undefined;
};

/**
 * Decide si una actividad pertenece al destino. No se acepta nunca por tener solo título y URL:
 *  1. Con coordenadas y centro conocido del destino, mandan las coordenadas (radio RADIO_DESTINO_KM).
 *  2. Con ciudad estructurada, debe coincidir con alguna variante del destino (tras quitar «Atracciones …»).
 *  3. Sin ciudad ni coordenadas, el título debe mencionar el destino como palabra completa.
 * Una etiqueta de otra ciudad NUNCA se reescribe: si se acepta por coordenadas se conserva la original.
 */
export function evaluarUbicacionActividad(actividad: any, ciudad: string): EvaluacionUbicacion {
  const nombresValidos = variantesCiudad(ciudad);
  const ciudadProveedor = actividad?.city == null || String(actividad.city).trim() === '' ? null : String(actividad.city);
  if (nombresValidos.length === 0) return { ok: false, motivo: 'sin_ciudad_ni_mencion', ciudadProveedor };

  const etiqueta = limpiarCiudadProveedor(normalizarTexto(actividad?.city));
  const coincideEtiqueta = etiqueta !== '' && nombresValidos.some((nombre) =>
    etiqueta === nombre || etiqueta.startsWith(nombre + ',') || etiqueta.startsWith(nombre + ' -') || etiqueta.startsWith(nombre + ' ('),
  );

  const coords = coordenadasActividad(actividad);
  const centro = datosCiudad(ciudad);
  const distancia = coords && centro ? distanciaKm(coords, centro) : undefined;
  const redondeada = distancia === undefined ? undefined : Math.round(distancia * 10) / 10;

  if (etiqueta) {
    if (coincideEtiqueta) {
      if (distancia !== undefined && distancia > RADIO_INCOHERENCIA_KM) {
        return { ok: false, motivo: 'coordenadas_contradicen_etiqueta', ciudadProveedor, distanciaKm: redondeada };
      }
      return { ok: true, verificacion: 'ciudad', ciudadProveedor, distanciaKm: redondeada };
    }
    if (distancia !== undefined) {
      return distancia <= RADIO_DESTINO_KM
        ? { ok: true, verificacion: 'coordenadas', ciudadProveedor, distanciaKm: redondeada }
        : { ok: false, motivo: 'ciudad_distinta_y_coordenadas_lejos', ciudadProveedor, distanciaKm: redondeada };
    }
    return { ok: false, motivo: 'ciudad_distinta_sin_coordenadas', ciudadProveedor };
  }

  // Sin etiqueta de ciudad: coordenadas si se pueden comparar; si no, mención explícita en el título
  // (las excursiones a otros destinos suelen colgar de páginas de Roma; «roma» no debe casar con «aromas»).
  if (distancia !== undefined) {
    return distancia <= RADIO_DESTINO_KM
      ? { ok: true, verificacion: 'coordenadas', ciudadProveedor, distanciaKm: redondeada }
      : { ok: false, motivo: 'ciudad_distinta_y_coordenadas_lejos', ciudadProveedor, distanciaKm: redondeada };
  }
  const titulo = normalizarTexto(actividad?.title);
  const menciona = nombresValidos.some((nombre) => new RegExp(`(?:^|[^a-z0-9])${escaparRegex(nombre)}(?:$|[^a-z0-9])`).test(titulo));
  return menciona
    ? { ok: true, verificacion: 'titulo', ciudadProveedor }
    : { ok: false, motivo: 'sin_ciudad_ni_mencion', ciudadProveedor };
}

export function actividadEsDeCiudad(actividad: any, ciudad: string): boolean {
  return evaluarUbicacionActividad(actividad, ciudad).ok;
}

export type DiagnosticoActividades = {
  resultadosProveedor: number;
  sinTituloOUrl: number;
  descartadasPorCiudad: number;
  resultadosValidos: number;
  /** Etiquetas de ciudad de las descartadas (máx. 5, sin repetir) para poder ver QUÉ se ha filtrado. */
  ciudadesDescartadas: string[];
  /** Cuántas se aceptaron por coordenadas pese a una etiqueta de ciudad distinta. */
  aceptadasPorCoordenadas: number;
  /** Descartes agrupados por motivo concreto. */
  descartesPorMotivo: Partial<Record<MotivoDescarte, number>>;
};

/**
 * Aplica título + URL HTTP(S) + ubicación y cuenta cada motivo de descarte, para distinguir
 * «el proveedor no devolvió nada» de «lo devolvió y lo hemos filtrado». Las válidas llevan
 * `_ubicacion` con la verificación y la etiqueta original del proveedor.
 */
export function filtrarActividadesDeCiudad(resultados: any[], ciudad: string): { validas: any[]; diagnostico: DiagnosticoActividades } {
  const lista = Array.isArray(resultados) ? resultados : [];
  const tieneTituloYUrl = (a: any) => {
    const url = typeof a?.url === 'string' ? a.url.trim() : '';
    return typeof a?.title === 'string' && a.title.trim().length > 0 && (url.startsWith('https://') || url.startsWith('http://'));
  };
  const conDatos = lista.filter(tieneTituloYUrl);
  const validas: any[] = [];
  const ciudadesDescartadas = new Set<string>();
  const descartesPorMotivo: Partial<Record<MotivoDescarte, number>> = {};
  let aceptadasPorCoordenadas = 0;
  for (const a of conDatos) {
    const ev = evaluarUbicacionActividad(a, ciudad);
    if (ev.ok) {
      if (ev.verificacion === 'coordenadas') aceptadasPorCoordenadas++;
      validas.push({ ...a, _ubicacion: { verificacion: ev.verificacion, ciudadProveedor: ev.ciudadProveedor, distanciaKm: ev.distanciaKm ?? null } });
    } else {
      if (ciudadesDescartadas.size < 5) ciudadesDescartadas.add(String(a?.city ?? '(sin ciudad)'));
      if (ev.motivo) descartesPorMotivo[ev.motivo] = (descartesPorMotivo[ev.motivo] ?? 0) + 1;
    }
  }
  return {
    validas,
    diagnostico: {
      resultadosProveedor: lista.length,
      sinTituloOUrl: lista.length - conDatos.length,
      descartadasPorCiudad: conDatos.length - validas.length,
      resultadosValidos: validas.length,
      ciudadesDescartadas: [...ciudadesDescartadas],
      aceptadasPorCoordenadas,
      descartesPorMotivo,
    },
  };
}

/**
 * Actividad de una ciudad en una ruta multidestino. Conserva las de precio pendiente (precio = null),
 * igual que la búsqueda de un solo destino: ausencia de precio no es 0 ni gratis.
 */
export function actividadParaMultidestino(actividad: any, tiposPorDefecto: string[]) {
  return {
    nombre: actividad.title,
    tipo: Array.isArray(actividad.categories) && actividad.categories.length ? actividad.categories.join(', ') : tiposPorDefecto.join(', '),
    precio: extraerPrecio(actividad),
    esGratis: esGratisVerificado(actividad),
    precioTexto: typeof actividad.priceText === 'string' ? actividad.priceText : typeof actividad.priceLabel === 'string' ? actividad.priceLabel : null,
    moneda: extraerMoneda(actividad),
    valoracion: Number(actividad.rating ?? 0) || 0,
    numeroResenas: Number(actividad.reviewCount ?? 0) || 0,
    duracion: actividad.durationText ?? '',
    url: actividad.url ?? '',
    plataforma: actividad.platform ?? '',
  };
}

/* ---------- Consultas al actor de actividades ---------- */

// Consultamos el nombre local y el habitual en inglés. El actor puede responder
// de forma diferente según el idioma de la búsqueda, aunque el destino sea el mismo.
const ALIASES_DESTINO: Record<string, string[]> = {
  roma: ['Rome', 'Roma'],
  rome: ['Rome', 'Roma'],
  florencia: ['Florence', 'Florencia'],
  florence: ['Florence', 'Florencia'],
  venecia: ['Venice', 'Venecia'],
  venice: ['Venice', 'Venecia'],
  londres: ['London', 'Londres'],
  london: ['London', 'Londres'],
  munich: ['Munich', 'Múnich'],
  múnich: ['Munich', 'Múnich'],
  paris: ['Paris', 'París'],
  parís: ['Paris', 'París'],
  amsterdam: ['Amsterdam'],
  barcelona: ['Barcelona'],
  madrid: ['Madrid'],
};

export function consultasActividadesParaDestino(destino: string): string[] {
  const limpio = destino.trim();
  const clave = limpio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const alias = ALIASES_DESTINO[clave];
  if (alias) return [...new Set([limpio, ...alias])];
  // Ciudades conocidas: se piden SIEMPRE el nombre dado, el español y el inglés, sea cual sea el idioma de entrada.
  // Civitatis en español publica /es/bruselas/ (no /es/brussels/): si solo se envía «Brussels» el actor cae
  // en la portada y devuelve actividades de otra ciudad (caso real de Bruselas, 2026-11-19).
  const datos = datosCiudad(limpio);
  if (datos) {
    const vistos = new Set<string>();
    return [limpio, datos.es, datos.en].filter((n) => {
      const k = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return !vistos.has(k) && !!vistos.add(k);
    });
  }
  const ingles = consultaProveedorParaCiudad(limpio);
  return ingles && ingles !== limpio ? [limpio, ingles] : [limpio];
}

/**
 * Análisis de un dataset del actor para UNA ciudad: de dónde sale cada descarte. Pura (sin red);
 * la usa el script de diagnóstico y las pruebas.
 */
export function analizarDataset(items: any[], destino: string) {
  const lista = Array.isArray(items) ? items : [];
  const ciudades: Record<string, number> = {};
  for (const a of lista) { const c = String(a?.city ?? '(sin ciudad)'); ciudades[c] = (ciudades[c] ?? 0) + 1; }
  const { validas, diagnostico } = filtrarActividadesDeCiudad(lista, destino);
  const precioNumerico = validas.filter((a) => extraerPrecio(a) !== null).length;
  return {
    destino,
    consultas: consultasActividadesParaDestino(destino),
    ...diagnostico,
    ciudadesEnDataset: ciudades,
    validasConPrecio: precioNumerico,
    validasSinPrecio: validas.length - precioNumerico,
    ejemplosValidos: validas.slice(0, 3).map((a) => ({ titulo: a.title, ciudad: a.city ?? null, verificacion: a._ubicacion?.verificacion ?? null })),
    ejemplosDescartados: lista.filter((a) => !validas.includes(a)).slice(0, 3).map((a) => ({ titulo: a?.title ?? null, ciudad: a?.city ?? null })),
  };
}
