/**
 * Límites de ejecución de los actores de Apify (vuelos y actividades). Cuatro cosas distintas que no deben confundirse:
 *  - waitSecs: cuánto ESPERA nuestro código a que termine la ejecución. No detiene el actor.
 *  - timeout (segundos): tiempo máximo de la ejecución EN Apify; al cumplirse la plataforma la termina (TIMED-OUT).
 *  - maxTotalChargeUsd: límite ECONÓMICO por ejecución. Apify solo lo aplica a actores de pago por evento (PPE); al alcanzarlo la
 *    plataforma deja de cobrar y aborta la ejecución (puede seguir un instante usando recursos).
 *  - abort(): cancelación explícita de una ejecución activa (client.run(id).abort()).
 * Un límite de RESULTADOS (max_pages, maxResults…) acota lo que se pide, no lo que cuesta.
 * Fuente: documentación de apify-client (ActorCallOptions) y de Apify (pay-per-event).
 */
export const TOPE_COSTE_USD_MINIMO = 0.01;
export const TOPE_COSTE_USD_MAXIMO = 0.25;
export const TOPE_COSTE_VUELOS_USD_POR_DEFECTO = 0.1;
export const TOPE_COSTE_ACTIVIDADES_USD_POR_DEFECTO = 0.1;
/** Margen sobre la espera del cliente antes de que Apify termine la ejecución por su cuenta. */
export const MARGEN_TIMEOUT_SECS = 30;

/** Valor de la variable de entorno limitado a [mínimo, máximo]; vacío o inválido → el valor por defecto. */
export function topeCoste(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  return Math.min(TOPE_COSTE_USD_MAXIMO, Math.max(TOPE_COSTE_USD_MINIMO, n));
}

/** Opciones de límite para actor.call(): tope económico por ejecución y tiempo máximo de ejecución en Apify. */
export function opcionesLimite(esperaSecs: number, topeUsd: number): { maxTotalChargeUsd: number; timeout: number } {
  return { maxTotalChargeUsd: topeUsd, timeout: Math.ceil(esperaSecs) + MARGEN_TIMEOUT_SECS };
}
