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
import { aeropuertoDeDestinoSeleccionado, type AeropuertoResuelto } from './aeropuertos-vuelos.js';

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

/**
 * Aeropuerto del destino elegido (vuelos). A diferencia del destino editorial de arriba, aplica a CUALQUIER destino elegido en
 * el autocompletado que tenga identificador (Bruselas, Sarajevo, París…): el aeropuerto sale del catálogo en el servidor y el
 * modelo no puede sustituirlo al escribir los argumentos de buscar_vuelos.
 */
export interface AeropuertoFijado {
  etiqueta: string;
  aeropuerto: AeropuertoResuelto;
  /** Nombres normalizados con los que el modelo puede nombrar ese lugar (incluidas traducciones y el municipio). */
  nombres: string[];
}
const almacenAeropuerto = new AsyncLocalStorage<AeropuertoFijado>();

export function aeropuertoFijadoDesde(bruto: unknown): AeropuertoFijado | null {
  const d = normalizarDestinoSeleccionado(bruto);
  if (!d?.id) return null;
  try {
    const aeropuerto = aeropuertoDeDestinoSeleccionado(d);
    if (!aeropuerto) return null;
    const etiqueta = etiquetaDestino(d);
    const nombres = new Set<string>([...variantesCiudad(etiqueta), normalizarTexto(d.nombre)]);
    if (aeropuerto.nombre) nombres.add(normalizarTexto(aeropuerto.nombre));
    return { etiqueta, aeropuerto, nombres: [...nombres].filter(Boolean) };
  } catch {
    // Catálogo no disponible: no se fija nada y se resuelve por el texto, como siempre.
    return null;
  }
}

/** Ejecuta `fn` con el destino elegido fijado (si lo hay y es válido). Sin destino fijable, ejecuta `fn` tal cual. */
export function conDestinoFijado<T>(bruto: unknown, fn: () => T): T {
  const fijado = destinoFijadoDesde(bruto);
  const ap = aeropuertoFijadoDesde(bruto);
  let ejecutar: () => T = fn;
  if (fijado) { const interior = ejecutar; ejecutar = () => almacen.run(fijado, interior); }
  if (ap) { const interior = ejecutar; ejecutar = () => almacenAeropuerto.run(ap, interior); }
  return ejecutar();
}

export function aeropuertoFijadoActual(): AeropuertoFijado | undefined {
  return almacenAeropuerto.getStore();
}

/**
 * Aeropuerto que debe usarse para el lugar que el modelo escribió como origen/destino de vuelos. Si hay un destino elegido y el
 * modelo lo nombra (en cualquier idioma conocido) o escribe un código IATA que no coincide con el elegido para ese mismo lugar,
 * manda el aeropuerto del catálogo. Si nombra otro lugar (p. ej. el origen «Madrid»), devuelve undefined y se resuelve por texto.
 */
export function aeropuertoFijadoPara(textoModelo: string): AeropuertoResuelto | undefined {
  const fijado = almacenAeropuerto.getStore();
  if (!fijado) return undefined;
  const base = normalizarTexto(nombreBaseCiudad(textoModelo));
  if (!base) return undefined;
  const coincide = fijado.nombres.includes(base);
  return coincide ? { ...fijado.aeropuerto, entrada: textoModelo, via: 'fijado' } : undefined;
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
