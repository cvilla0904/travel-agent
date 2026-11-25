/**
 * Búsqueda de actividades de un destino: proveedor → filtro de ubicación → salida de la herramienta.
 * Separada de src/index.ts para poder probarla con un proveedor simulado (sin red ni créditos).
 *
 * `estado` permite distinguir lo que el usuario debe ver:
 *  - ok:             hay actividades verificadas del destino.
 *  - parcial:        la ejecución del proveedor no había terminado; lo mostrado puede estar incompleto.
 *  - sin_resultados: el proveedor respondió y no hay actividades verificadas (ver `motivo`).
 *  - error:          la consulta falló; NO significa que no existan actividades.
 */
import type { EjecucionActor } from './apify.js';
import { filtrarActividadesDeCiudad, type DiagnosticoActividades } from './actividades-ciudad.js';
import { extraerPrecio, esGratisVerificado, extraerMoneda, parsearPrecio } from './precios-actividades.js';
import { normalizarTexto } from './ciudades.js';

export type EstadoActividades = 'ok' | 'parcial' | 'sin_resultados' | 'error';
export type MotivoSinResultados = 'proveedor_sin_resultados' | 'descartadas_por_ubicacion' | 'sin_titulo_o_url';

const TRADUCCIONES_TIPO: Record<string, string[]> = {
  naturaleza: ['nature', 'outdoor', 'nature tours'],
  cultura: ['culture', 'museums', 'guided tours'],
  'gastronomía': ['food', 'gastronomy', 'food tours'],
  aventura: ['adventure', 'outdoor activities'],
};

export type SalidaActividades = ReturnType<typeof construirSalida>;

function numeroOCero(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function construirSalida(args: {
  destino: string;
  tipos: string[];
  estado: EstadoActividades;
  motivo: MotivoSinResultados | null;
  mensaje: string | null;
  proveedor: { runId: string | null; status: string | null };
  resultadosProveedor: number;
  diagnostico: DiagnosticoActividades | null;
  validas: any[];
  preferencias: string[];
}) {
  const { validas, diagnostico } = args;
  const conPreferencia = validas.map((actividad: any) => ({
    ...actividad,
    _precioNormalizado: extraerPrecio(actividad),
    _esGratisVerificado: esGratisVerificado(actividad),
    _preferencia: args.preferencias.reduce((puntos, termino) =>
      puntos + (normalizarTexto(actividad.title).includes(normalizarTexto(termino)) ? 1 : 0), 0),
  }));
  const unicos = Array.from(new Map(conPreferencia.map((a: any) => [a.url || a.title, a])).values())
    .sort((a: any, b: any) => b._preferencia - a._preferencia);
  return {
    destino: args.destino,
    estado: args.estado,
    motivo: args.motivo,
    mensaje: args.mensaje,
    proveedor: args.proveedor,
    diagnosticoBusqueda: {
      consultas: [args.destino],
      resultadosProveedor: args.resultadosProveedor,
      resultadosConTitulo: validas.length,
      resultadosConPrecioNumerico: validas.filter((a: any) => parsearPrecio(a.priceFrom) !== null).length,
      sinTituloOUrl: diagnostico?.sinTituloOUrl ?? 0,
      descartadasPorCiudad: diagnostico?.descartadasPorCiudad ?? 0,
      ciudadesDescartadas: diagnostico?.ciudadesDescartadas ?? [],
      aceptadasPorCoordenadas: diagnostico?.aceptadasPorCoordenadas ?? 0,
      descartesPorMotivo: diagnostico?.descartesPorMotivo ?? {},
    },
    actividades: unicos.slice(0, 15).map((a: any) => ({
      nombre: a.title as string,
      tipo: Array.isArray(a.categories) ? a.categories.join(', ') : args.tipos.join(', '),
      precio: a._precioNormalizado as number | null,
      esGratis: a._esGratisVerificado as boolean,
      precioTexto: typeof a.priceText === 'string' ? a.priceText : typeof a.priceLabel === 'string' ? a.priceLabel : null,
      moneda: extraerMoneda(a),
      valoracion: Number.isFinite(Number(a.rating)) ? Number(a.rating) : 0,
      numeroResenas: Number.isFinite(Number(a.reviewCount)) ? Number(a.reviewCount) : 0,
      duracion: typeof a.durationText === 'string' ? a.durationText : '',
      cancelacionGratuita: typeof a.freeCancellation === 'boolean' ? a.freeCancellation : false,
      direccion: '',
      latitud: numeroOCero(a.latitude),
      longitud: numeroOCero(a.longitude),
      url: typeof a.url === 'string' ? a.url : '',
      plataforma: typeof a.platform === 'string' ? a.platform : '',
      // Trazabilidad de la ubicación: lo que dijo el proveedor y cómo se verificó que es del destino.
      ciudadProveedor: a._ubicacion?.ciudadProveedor ?? (typeof a.city === 'string' ? a.city : ''),
      verificacionUbicacion: (a._ubicacion?.verificacion ?? 'ciudad') as string,
    })),
  };
}

export async function buscarActividadesDestino(
  params: { destino: string; tipos: string[] },
  // Import diferido: el cliente de Apify solo se carga si se usa el proveedor real (las pruebas inyectan uno simulado).
  buscar: (p: { destino: string }) => Promise<EjecucionActor> = async (p) => (await import('./apify.js')).buscarActividadesApifyDetallado(p),
) {
  const { destino, tipos } = params;
  const preferencias = tipos.flatMap((t) => TRADUCCIONES_TIPO[t] ?? []);
  console.info('[ACTIVITIES_DIAG] Tool started', JSON.stringify({ destino, tipos, preferencias }));

  let ejecucion: EjecucionActor;
  try {
    ejecucion = await buscar({ destino });
  } catch (error) {
    // Un fallo del proveedor no se convierte en «no hay actividades»: se informa como error.
    const detalle = error instanceof Error ? error.message : String(error);
    console.info('[ACTIVITIES_DIAG] Provider error', JSON.stringify({ destino, detalle }));
    return construirSalida({
      destino, tipos, estado: 'error', motivo: null,
      mensaje: `No se pudo consultar el proveedor de actividades: ${detalle}`,
      proveedor: { runId: null, status: null }, resultadosProveedor: 0, diagnostico: null, validas: [], preferencias,
    });
  }

  const { items, status, runId } = ejecucion;
  console.info('[ACTIVITIES_DIAG] Provider returned', JSON.stringify({ destino, runId, status, count: items.length, sampleFields: items[0] ? Object.keys(items[0]) : [] }));
  const { validas, diagnostico } = filtrarActividadesDeCiudad(items, destino);
  console.info('[ACTIVITIES_DIAG] City filter', JSON.stringify({ destino, ...diagnostico }));
  const incompleta = status !== 'SUCCEEDED';
  const proveedor = { runId, status };

  let estado: EstadoActividades;
  let motivo: MotivoSinResultados | null = null;
  let mensaje: string | null = null;
  if (validas.length > 0) {
    estado = incompleta ? 'parcial' : 'ok';
    if (incompleta) mensaje = 'El proveedor no había terminado de buscar: puede haber más actividades de las mostradas.';
  } else if (incompleta) {
    estado = 'parcial';
    mensaje = 'El proveedor no había terminado de buscar cuando se leyó el resultado; no se han podido verificar actividades todavía.';
  } else {
    estado = 'sin_resultados';
    if (items.length === 0) { motivo = 'proveedor_sin_resultados'; mensaje = 'El proveedor respondió sin actividades para este destino.'; }
    else if (diagnostico.descartadasPorCiudad > 0) { motivo = 'descartadas_por_ubicacion'; mensaje = `El proveedor devolvió ${items.length} resultados, pero ninguno se pudo verificar como del destino (ciudades recibidas: ${diagnostico.ciudadesDescartadas.join(', ') || 'sin ciudad'}).`; }
    else { motivo = 'sin_titulo_o_url'; mensaje = 'El proveedor devolvió resultados sin título o enlace válido.'; }
  }

  const salida = construirSalida({ destino, tipos, estado, motivo, mensaje, proveedor, resultadosProveedor: items.length, diagnostico, validas, preferencias });
  console.info('[ACTIVITIES_DIAG] Tool output', JSON.stringify({ destino, estado, motivo, returnedActivities: salida.actividades.length }));
  return salida;
}
