/**
 * Filtro geográfico de actividades. Nunca mostramos una actividad de otra ciudad.
 *
 * Las equivalencias de nombres (Bruselas/Brussels/Bruxelles, Viena/Vienna/Wien, Praga/Prague/Praha…)
 * salen de `variantesCiudad()` (ciudades.ts), la misma fuente que usa Booking; aquí no hay tabla propia.
 */
import { normalizarTexto, variantesCiudad, consultaProveedorParaCiudad } from './ciudades.js';
import { extraerPrecio, esGratisVerificado } from './precios-actividades.js';

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

export function actividadEsDeCiudad(actividad: any, ciudad: string): boolean {
  const nombresValidos = variantesCiudad(ciudad);
  if (nombresValidos.length === 0) return false;
  const ciudadActividad = normalizarTexto(actividad?.city);

  if (ciudadActividad) {
    // La ciudad estructurada es la señal geográfica más fiable.
    const ciudadLimpia = limpiarCiudadProveedor(ciudadActividad);
    return nombresValidos.some((nombre) =>
      ciudadLimpia === nombre ||
      ciudadLimpia.startsWith(nombre + ',') ||
      ciudadLimpia.startsWith(nombre + ' -') ||
      ciudadLimpia.startsWith(nombre + ' ('),
    );
  }

  // Sin ciudad estructurada no basta con que la URL cuelgue de una categoría de ciudad: las excursiones
  // a otros destinos suelen publicarse dentro de páginas de Roma. Exigimos mención explícita en el título,
  // como palabra completa (para que «roma» no coincida con «aromas»).
  const titulo = normalizarTexto(actividad?.title);
  return nombresValidos.some((nombre) => new RegExp(`(?:^|[^a-z0-9])${escaparRegex(nombre)}(?:$|[^a-z0-9])`).test(titulo));
}

export type DiagnosticoActividades = {
  resultadosProveedor: number;
  sinTituloOUrl: number;
  descartadasPorCiudad: number;
  resultadosValidos: number;
  /** Etiquetas de ciudad de las descartadas (máx. 5, sin repetir) para poder ver QUÉ se ha filtrado. */
  ciudadesDescartadas: string[];
};

/**
 * Aplica título + URL HTTP(S) + ciudad y cuenta cada motivo de descarte, para distinguir
 * «el proveedor no devolvió nada» de «lo devolvió y lo hemos filtrado».
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
  for (const a of conDatos) {
    if (actividadEsDeCiudad(a, ciudad)) validas.push(a);
    else if (ciudadesDescartadas.size < 5) ciudadesDescartadas.add(String(a?.city ?? '(sin ciudad)'));
  }
  return {
    validas,
    diagnostico: {
      resultadosProveedor: lista.length,
      sinTituloOUrl: lista.length - conDatos.length,
      descartadasPorCiudad: conDatos.length - validas.length,
      resultadosValidos: validas.length,
      ciudadesDescartadas: [...ciudadesDescartadas],
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
    moneda: typeof actividad.priceCurrency === 'string' && actividad.priceCurrency.trim() ? actividad.priceCurrency.trim().toUpperCase() : 'EUR',
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
  // Ciudades sin alias propio (p. ej. Bruselas/Viena): se añade también el nombre inglés habitual de
  // ciudades.ts, que es como etiqueta la ciudad el actor. Si no se conoce, se consulta solo el nombre dado.
  const ingles = consultaProveedorParaCiudad(limpio);
  return ingles && ingles !== limpio ? [limpio, ingles] : [limpio];
}


