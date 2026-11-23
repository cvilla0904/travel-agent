/**
 * Estados de una búsqueda, separados en tres niveles que nunca se mezclan:
 *  A) reconocimiento del destino (motor geográfico),
 *  B) resultado de cada proveedor,
 *  C) descartes por ubicación (diagnóstico).
 */
export type EstadoReconocimiento =
  | 'reconocido' | 'reconocido_respaldo' | 'aclaracion' | 'no_encontrado' | 'error_geocodificador';

export type EstadoProveedor =
  | 'no_consultado'        // no aplica o no se ha lanzado
  | 'en_curso'             // lanzada y sin respuesta
  | 'ok'                   // respuesta correcta con resultados
  | 'parcial'              // resultados válidos pero falta una parte (p. ej. solo ida)
  | 'sin_resultados'       // el proveedor respondió bien y no hay opciones
  | 'destino_no_resuelto'  // el proveedor no reconoce el destino (distinto de «sin resultados»)
  | 'incompleto'           // la ejecución no terminó dentro del tiempo y no hay datos todavía
  | 'error_proveedor'      // fallo técnico (HTTP, tiempo de espera, ejecución fallida)
  | 'error_parametros';    // petición inválida por nuestra parte

export interface ObservacionProveedor {
  consultado: boolean;
  enCurso?: boolean;
  /** Error técnico del proveedor (mensaje breve), si lo hubo. */
  error?: string | null;
  /** El proveedor no pudo resolver el destino que se le envió. */
  destinoNoResuelto?: boolean;
  /** La ejecución sigue sin terminar y todavía no hay datos. */
  incompleta?: boolean;
  /** Resultados válidos tras el filtro geográfico. */
  resultados: number;
  /** Resultados devueltos por el proveedor antes del filtro. */
  recibidos?: number;
  /** Si falta una parte esperada de la búsqueda (p. ej. un sentido del vuelo). */
  faltaParte?: boolean;
}

export interface DiagnosticoBusqueda {
  estado: EstadoProveedor;
  recibidos: number;
  validos: number;
  /** Descartados por no corresponder a la ciudad pedida. */
  descartadosPorUbicacion: number;
  /** Texto breve para mostrar o registrar. */
  detalle: string;
}

/**
 * Clasifica una búsqueda sin mezclar casos. Orden de decisión:
 * no consultada → en curso → destino no resuelto → error técnico → incompleta → resultados válidos → sin resultados.
 * Un cero nunca se interpreta como «terminó bien» si la búsqueda está en curso, incompleta o falló.
 */
export function clasificarBusqueda(o: ObservacionProveedor): DiagnosticoBusqueda {
  const recibidos = o.recibidos ?? o.resultados;
  const descartados = Math.max(0, recibidos - o.resultados);
  const base = { recibidos, validos: o.resultados, descartadosPorUbicacion: descartados };
  if (!o.consultado) return { ...base, estado: 'no_consultado', detalle: 'No se ha consultado este proveedor.' };
  if (o.enCurso) return { ...base, estado: 'en_curso', detalle: 'Búsqueda en curso.' };
  if (o.destinoNoResuelto) return { ...base, estado: 'destino_no_resuelto', detalle: 'El proveedor no reconoce el destino enviado.' };
  if (o.error) return { ...base, estado: 'error_proveedor', detalle: `Error del proveedor: ${o.error}` };
  if (o.incompleta && o.resultados === 0) return { ...base, estado: 'incompleto', detalle: 'La búsqueda no ha terminado y todavía no hay datos.' };
  if (o.resultados > 0) {
    return o.faltaParte || o.incompleta
      ? { ...base, estado: 'parcial', detalle: 'Hay resultados, pero la búsqueda está incompleta.' }
      : { ...base, estado: 'ok', detalle: descartados ? `${o.resultados} resultados (${descartados} descartados por ubicación).` : `${o.resultados} resultados.` };
  }
  return {
    ...base, estado: 'sin_resultados',
    detalle: descartados
      ? `El proveedor devolvió ${recibidos} resultados y todos se descartaron por no corresponder a la ciudad.`
      : 'El proveedor respondió correctamente y no hay resultados.',
  };
}
