/**
 * Selector del proveedor de hoteles.
 *
 *   HOTELES_PROVEEDOR=searchapi  (por defecto) → SearchAPI / Booking.com (searchapi.ts, sin cambios)
 *   HOTELES_PROVEEDOR=apify                    → Google Hotels vía Apify (apify-hoteles.ts)
 *
 * Reglas:
 *  - Sin variable, o con un valor desconocido, se usa SearchAPI: el comportamiento
 *    anterior se conserva intacto. Un valor desconocido se avisa en el log.
 *  - No hay conmutación automática entre proveedores: si el elegido falla, se devuelve
 *    su error (no se consume la cuota del otro sin que nadie lo haya decidido).
 *  - Para volver a SearchAPI basta quitar la variable o poner HOTELES_PROVEEDOR=searchapi.
 */
import { buscarHotelesConEstado as buscarHotelesSearchApiConEstado } from './searchapi.js';
import type { DependenciasSearchApi, ParametrosHoteles, ResultadoHotelesConEstado } from './searchapi.js';
import { buscarHotelesApifyConEstado } from './apify-hoteles.js';
import { reconciliarDestino } from './destino-fijado.js';
import { bloqueHoteles, registrarBloque } from './resultados-estructurados.js';
import type { DependenciasApifyHoteles, ResultadoHotelesApify } from './apify-hoteles.js';

export type ProveedorHoteles = 'searchapi' | 'apify';
export type ResultadoHotelesSeleccionado = ResultadoHotelesConEstado | ResultadoHotelesApify;

export function proveedorHoteles(
  env: Record<string, string | undefined> = process.env,
  avisar: (mensaje: string) => void = (m) => console.warn(m),
): ProveedorHoteles {
  const valor = (env.HOTELES_PROVEEDOR ?? '').trim().toLowerCase();
  if (valor === '' || valor === 'searchapi') return 'searchapi';
  if (valor === 'apify') return 'apify';
  avisar(`[HOTELES] HOTELES_PROVEEDOR="${valor}" no es válido (searchapi | apify); se usa searchapi.`);
  return 'searchapi';
}

export interface DependenciasHoteles {
  /** Para pruebas: fuerza el proveedor sin leer el entorno. */
  proveedor?: ProveedorHoteles;
  searchapi?: DependenciasSearchApi;
  apify?: DependenciasApifyHoteles;
}

export async function buscarHotelesConEstado(
  params: ParametrosHoteles,
  deps: DependenciasHoteles = {},
): Promise<ResultadoHotelesSeleccionado> {
  const proveedor = deps.proveedor ?? proveedorHoteles();
  // Si el usuario eligió un destino con identidad editorial (p. ej. «Salento, Apulia, Italia»), el que escribió el modelo no puede
  // reemplazarlo por un homónimo (destino-fijado.ts). Sin destino fijado, no cambia nada.
  const { destino, paisCodigo, sustituido } = reconciliarDestino(params.destino);
  if (sustituido) params = { ...params, destino, paisCodigo };
  const resultado = proveedor === 'apify'
    ? await buscarHotelesApifyConEstado(params, deps.apify)
    : await buscarHotelesSearchApiConEstado(params, deps.searchapi);
  // Los dos proveedores se entregan a la web con el MISMO formato estructurado (resultados-estructurados.ts).
  registrarBloque(bloqueHoteles(resultado, proveedor));
  return resultado;
}
