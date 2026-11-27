/**
 * Hoteles: proveedor único, Google Hotels vía Apify (apify-hoteles.ts).
 *
 * No existe selector de proveedor ni conmutación: si Apify falla se devuelve su error
 * (estado 'error_proveedor'); nunca se llama a otro servicio ni se inventan resultados.
 */
import { buscarHotelesApifyConEstado } from './apify-hoteles.js';
import { reconciliarDestino } from './destino-fijado.js';
import { bloqueHoteles, registrarBloque } from './resultados-estructurados.js';
import type { DependenciasApifyHoteles, ResultadoHotelesApify } from './apify-hoteles.js';
import type { ParametrosHoteles } from './hoteles-comun.js';

export type ResultadoHotelesSeleccionado = ResultadoHotelesApify;

export interface DependenciasHoteles {
  apify?: DependenciasApifyHoteles;
}

let dependenciasPorDefecto: DependenciasHoteles = {};

/** Solo para pruebas: dependencias (cliente de Apify simulado) que se usan cuando el llamador no pasa ninguna. */
export function fijarDependenciasHoteles(deps: DependenciasHoteles | undefined): void {
  dependenciasPorDefecto = deps ?? {};
}

export async function buscarHotelesConEstado(
  params: ParametrosHoteles,
  deps: DependenciasHoteles = dependenciasPorDefecto,
): Promise<ResultadoHotelesSeleccionado> {
  // Si el usuario eligió un destino con identidad editorial (p. ej. «Salento, Apulia, Italia»), el que escribió el modelo no puede
  // reemplazarlo por un homónimo (destino-fijado.ts). Sin destino fijado, no cambia nada.
  const { destino, paisCodigo, sustituido } = reconciliarDestino(params.destino);
  if (sustituido) params = { ...params, destino, paisCodigo };
  const resultado = await buscarHotelesApifyConEstado(params, deps.apify);
  registrarBloque(bloqueHoteles(resultado));
  return resultado;
}
