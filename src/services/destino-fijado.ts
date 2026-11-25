/**
 * Destino elegido por el usuario, fijado para toda la ejecución del agente (M2).
 *
 * El recorrido real es: formulario → /api/chat (destinoSeleccionado) → mensaje al Travel Manager (LLM) → herramienta
 * `hotel_agent` (otro agente, otro LLM, recibe solo texto) → `buscar_hoteles` (el LLM escribe el argumento `destino`) →
 * buscarHotelesConEstado → proveedor. Con solo una etiqueta en el prompt, cualquiera de esos saltos puede reescribir «Salento,
 * Apulia, Italia» como «Salento» (que se resuelve a Quindío) o como «Salento, Colombia».
 *
 * Aquí el destino se valida en el servidor (normalizarDestinoSeleccionado) y se guarda en un contexto asíncrono
 * (AsyncLocalStorage) que viaja con la petición por todos los awaits, incluidas las ejecuciones anidadas de agentes-herramienta.
 * La capa de hoteles lo consulta justo antes de llamar al proveedor y, si el destino que escribió el modelo es el mismo lugar
 * por nombre, usa el elegido. Solo se fija si el identificador tiene identidad editorial (homónimos curados: Salento,
 * Cartagena…): los destinos normales del catálogo no se tocan.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { regionEditorial } from '../geo/regiones-editoriales.js';
import { etiquetaDestino, normalizarDestinoSeleccionado } from './destino-seleccionado.js';
import { nombreBaseCiudad, normalizarTexto, variantesCiudad } from './ciudades.js';

export interface DestinoFijado {
  /** «Salento, Apulia, Italia». */
  etiqueta: string;
  id: string;
  /** ISO-2 en minúsculas. */
  paisCodigo: string;
}

const almacen = new AsyncLocalStorage<DestinoFijado>();

/** Destino validado y con identidad editorial, o null (destino escrito a mano, destino normal del catálogo o datos no válidos). */
export function destinoFijadoDesde(bruto: unknown): DestinoFijado | null {
  const d = normalizarDestinoSeleccionado(bruto);
  if (!d?.id || !d.codigoPais || !regionEditorial(d.id)) return null;
  return { etiqueta: etiquetaDestino(d), id: d.id, paisCodigo: d.codigoPais.toLowerCase() };
}

/** Ejecuta `fn` con el destino elegido fijado (si lo hay y es válido). Sin destino fijable, ejecuta `fn` tal cual. */
export function conDestinoFijado<T>(bruto: unknown, fn: () => T): T {
  const fijado = destinoFijadoDesde(bruto);
  return fijado ? almacen.run(fijado, fn) : fn();
}

export function destinoFijadoActual(): DestinoFijado | undefined {
  return almacen.getStore();
}

export interface DestinoReconciliado { destino: string; paisCodigo?: string; sustituido: boolean }

/**
 * Destino que debe usarse en la herramienta. Si no hay destino fijado, o el modelo escribió otro lugar (otro nombre), se
 * devuelve tal cual. Si escribió el nombre del lugar fijado —con o sin región o país, incluso uno contradictorio como
 * «Salento, Colombia» cuando se eligió Apulia—, manda lo que eligió el usuario.
 */
export function reconciliarDestino(destinoModelo: string): DestinoReconciliado {
  const fijado = almacen.getStore();
  if (!fijado) return { destino: destinoModelo, sustituido: false };
  const base = normalizarTexto(nombreBaseCiudad(destinoModelo));
  if (!base || !variantesCiudad(fijado.etiqueta).includes(base)) return { destino: destinoModelo, sustituido: false };
  return { destino: fijado.etiqueta, paisCodigo: fijado.paisCodigo, sustituido: destinoModelo.trim() !== fijado.etiqueta };
}
