/**
 * Plataformas de actividades (módulo sin dependencias: lo usan la herramienta, el actor y la presentación).
 * Proveedor ACTIVO de actividades: solo Civitatis, a través del actor de Apify (apify.ts).
 */
/** Plataformas que el actor sabe consultar y que Mogavel tiene integradas (el resto de la integración es neutra respecto a la plataforma). */
export const PLATAFORMAS_DISPONIBLES = ['civitatis'] as const;
export type PlataformaActividades = (typeof PLATAFORMAS_DISPONIBLES)[number];

/** Plataformas que se envían al actor (única fuente de verdad). Solo Civitatis: Tiqets está eliminado del proyecto. */
export const PLATAFORMAS_ACTIVAS: readonly PlataformaActividades[] = ['civitatis'];

const NOMBRE_PLATAFORMA: Record<PlataformaActividades, string> = { civitatis: 'Civitatis' };

/** Texto legible de las plataformas activas para herramientas y prompts («Civitatis»). */
export function etiquetaPlataformas(plataformas: readonly string[] = PLATAFORMAS_ACTIVAS): string {
  const nombres = validarPlataformas(plataformas).map((p) => NOMBRE_PLATAFORMA[p]);
  return nombres.length <= 1 ? (nombres[0] ?? '') : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Valida la lista de plataformas antes de enviarla al actor. Nunca se envía una lista vacía (el actor podría usar todas
 * sus plataformas por defecto) ni una plataforma desconocida. Elimina duplicados conservando el orden.
 */
export function validarPlataformas(plataformas: readonly string[]): PlataformaActividades[] {
  if (!Array.isArray(plataformas) || plataformas.length === 0) {
    throw new Error('Plataformas de actividades no válidas: la lista no puede estar vacía.');
  }
  const desconocidas = plataformas.filter((p) => !(PLATAFORMAS_DISPONIBLES as readonly string[]).includes(p));
  if (desconocidas.length > 0) {
    throw new Error(`Plataformas de actividades no válidas: ${desconocidas.join(', ')}. Disponibles: ${PLATAFORMAS_DISPONIBLES.join(', ')}.`);
  }
  return [...new Set(plataformas)] as PlataformaActividades[];
}

/** true si la plataforma de un resultado es una de las activas (o el actor no la indica). Los de otras plataformas no se muestran. */
export function plataformaPermitida(plataforma: unknown, activas: readonly string[] = PLATAFORMAS_ACTIVAS): boolean {
  if (typeof plataforma !== 'string' || !plataforma.trim()) return true;
  return activas.includes(plataforma.trim().toLowerCase());
}
