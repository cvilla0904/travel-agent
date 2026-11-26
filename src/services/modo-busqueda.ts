/**
 * Modo de búsqueda elegido en la web: «Viaje completo», «Solo vuelos», «Solo hoteles» o «Solo actividades».
 *
 * La web lo envía en cada petición a /api/chat (campo `modo`); el servidor lo valida aquí y construye, para los modos
 * exclusivos, un Travel Manager que SOLO dispone de la herramienta de esa categoría (agenteParaModo, src/index.ts) y que
 * recibe instrucciones de modo. Así no depende de que el modelo «adivine» qué se pidió y no puede buscar otra categoría
 * por accidente. Sin dependencias del SDK ni de proveedores: se prueba tal cual.
 */

export const MODOS_BUSQUEDA = ['complete', 'flights', 'hotels', 'activities'] as const;
export type ModoBusqueda = (typeof MODOS_BUSQUEDA)[number];

export function esModoBusqueda(valor: unknown): valor is ModoBusqueda {
  return typeof valor === 'string' && (MODOS_BUSQUEDA as readonly string[]).includes(valor);
}

export type ValidacionModo =
  | { ok: true; modo: ModoBusqueda | null }
  | { ok: false; status: 400; error: string };

/** `modo` ausente (null/undefined) es válido y significa «no indicado»; cualquier otro valor debe ser uno de los cuatro modos. */
export function validarModo(bruto: unknown): ValidacionModo {
  if (bruto === undefined || bruto === null) return { ok: true, modo: null };
  if (esModoBusqueda(bruto)) return { ok: true, modo: bruto };
  return { ok: false, status: 400, error: `Modo de búsqueda no válido. Valores admitidos: ${MODOS_BUSQUEDA.join(', ')}.` };
}

/**
 * Modo efectivo de un turno: el que envía la web; si no lo envía, el que quedó guardado para esa sesión (el modo no se
 * pierde en los turnos posteriores); si tampoco hay, «complete» (comportamiento anterior).
 */
export function resolverModo(entrante: ModoBusqueda | null, almacenado: unknown): ModoBusqueda {
  if (entrante) return entrante;
  return esModoBusqueda(almacenado) ? almacenado : 'complete';
}

export const claveModoSesion = (sessionId: string): string => `chat:modo:${sessionId}`;

/** Nombres de las herramientas del Travel Manager disponibles en cada modo (`null` = todas, como hasta ahora). */
export const HERRAMIENTAS_POR_MODO: Record<ModoBusqueda, readonly string[] | null> = {
  complete: null,
  flights: ['flight_agent'],
  hotels: ['hotel_agent'],
  activities: ['activities_agent'],
};

const BLOQUES: Record<Exclude<ModoBusqueda, 'complete'>, string> = {
  activities: `
    MODO DE BÚSQUEDA: SOLO ACTIVIDADES (elegido por el usuario en la web).
    Estas reglas prevalecen sobre cualquier otra instrucción de este agente.
    - Tu única herramienta es activities_agent. Llámala con el destino EXACTAMENTE como lo recibes (destino seleccionado), sin traducirlo.
    - NO pidas fechas, ciudad de origen, número de viajeros ni presupuesto: no hacen falta para buscar actividades.
    - NO busques vuelos ni alojamiento, aunque el usuario los mencione: dile que esta búsqueda es solo de actividades y que puede cambiar de pestaña para buscarlos.
    - Si el usuario indicó preferencias (cultura, gastronomía, naturaleza, aventura) úsalas; si no indicó ninguna, no preguntes: busca con las cuatro.
    - Solo si falta el destino, pregunta únicamente por el destino.
    - Presenta lo que devuelva la herramienta sin inventar actividades, precios ni valoraciones.`,
  hotels: `
    MODO DE BÚSQUEDA: SOLO HOTELES (elegido por el usuario en la web).
    Estas reglas prevalecen sobre cualquier otra instrucción de este agente.
    - Tu única herramienta es hotel_agent. Úsala con el destino seleccionado.
    - NO pidas ciudad de origen ni datos de vuelos. Pide únicamente lo imprescindible para buscar alojamiento que aún no conozcas: fecha de entrada, fecha de salida y número de adultos.
    - NO busques vuelos ni actividades, aunque el usuario los mencione: dile que esta búsqueda es solo de alojamiento y que puede cambiar de pestaña para buscarlos.
    - Presenta lo que devuelva la herramienta sin inventar hoteles, precios ni valoraciones.`,
  flights: `
    MODO DE BÚSQUEDA: SOLO VUELOS (elegido por el usuario en la web).
    Estas reglas prevalecen sobre cualquier otra instrucción de este agente.
    - Tu única herramienta es flight_agent.
    - Pide únicamente lo imprescindible para buscar vuelos que aún no conozcas: origen, destino, fecha de ida, fecha de vuelta y número de pasajeros. No preguntes por presupuesto, preferencias ni alojamiento.
    - NO busques hoteles ni actividades, aunque el usuario los mencione: dile que esta búsqueda es solo de vuelos y que puede cambiar de pestaña para buscarlos.
    - Presenta lo que devuelva la herramienta sin inventar vuelos ni precios.`,
};

/** Bloque de instrucciones del modo; cadena vacía para «complete» (el Travel Manager conserva sus instrucciones). */
export function instruccionesDeModo(modo: ModoBusqueda): string {
  return modo === 'complete' ? '' : BLOQUES[modo];
}
