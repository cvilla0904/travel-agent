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
    - NO pidas ciudad de origen, número de viajeros ni presupuesto: no hacen falta para buscar actividades.
    - Para buscar actividades hacen falta el destino y las fechas del viaje (la disponibilidad y los días de realización dependen de ellas). Si el usuario todavía no ha indicado las fechas, pregúntaselas antes de buscar; si ya las ha dado, no las vuelvas a pedir.
    - NO busques vuelos ni alojamiento, aunque el usuario los mencione: dile que esta búsqueda es solo de actividades y que puede cambiar de pestaña para buscarlos.
    - Si el usuario indicó categorías (cultura, gastronomía, naturaleza, aventura) pásalas en tipos; si eligió «cualquier tipo» o no indicó ninguna, no preguntes: pasa las cuatro categorías para obtener propuestas variadas.
    - Solo si falta el destino, pregunta únicamente por el destino.
    - Presenta lo que devuelva la herramienta sin inventar actividades, precios ni valoraciones.`,
  hotels: `
    MODO DE BÚSQUEDA: SOLO HOTELES (elegido por el usuario en la web).
    Estas reglas prevalecen sobre cualquier otra instrucción de este agente.
    - Tu única herramienta es hotel_agent. Úsala con el destino seleccionado.
    - NO pidas ciudad de origen ni datos de vuelos. Pide únicamente lo imprescindible para buscar alojamiento que aún no conozcas: fecha de entrada, fecha de salida y número de adultos. Si el mensaje indica «Fechas de alojamiento elegidas en el formulario», ya las tienes y son definitivas: no las pidas otra vez.
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

/* ---- Fechas de «Solo hoteles» ---- */

export interface FechasHotel { entrada: string; salida: string }
export type ValidacionFechasHotel =
  | { ok: true; fechas: FechasHotel | null }
  | { ok: false; status: 400; error: string };

function fechaIsoReal(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const a = Number(valor.slice(0, 4)), m = Number(valor.slice(5, 7)), d = Number(valor.slice(8, 10));
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * Valida el campo `fechas` ({entrada, salida}, «YYYY-MM-DD») que la web envía en «Solo hoteles». Ausente es válido (null);
 * si viene, las dos deben ser fechas reales y la salida posterior a la entrada. En los demás modos se ignora.
 */
export function validarFechasHotel(modo: ModoBusqueda, bruto: unknown): ValidacionFechasHotel {
  if (modo !== 'hotels' || bruto === undefined || bruto === null) return { ok: true, fechas: null };
  const f = bruto as { entrada?: unknown; salida?: unknown };
  if (typeof bruto !== 'object' || !fechaIsoReal(f.entrada) || !fechaIsoReal(f.salida)) {
    return { ok: false, status: 400, error: 'Fechas de alojamiento no válidas. Usa fecha de entrada y de salida con formato AAAA-MM-DD.' };
  }
  if (f.salida <= f.entrada) {
    return { ok: false, status: 400, error: 'La fecha de salida debe ser posterior a la fecha de entrada.' };
  }
  return { ok: true, fechas: { entrada: f.entrada, salida: f.salida } };
}

/** Añade al mensaje del agente las fechas ya validadas, para que no las vuelva a pedir. */
export function mensajeConFechasHotel(mensaje: string, fechas: FechasHotel | null): string {
  if (!fechas) return mensaje;
  return `${mensaje}\n\n[Fechas de alojamiento elegidas en el formulario: entrada ${fechas.entrada}, salida ${fechas.salida}. Úsalas tal cual como fechaEntrada y fechaSalida; no las vuelvas a pedir.]`;
}

/* ---- Actividades elegidas en el formulario ---- */

export const CATEGORIAS_ACTIVIDADES = ['cultura', 'gastronomía', 'naturaleza', 'aventura'] as const;
export interface ActividadesFormulario { solicitadas: boolean; tipos: string[]; cualquiera: boolean }
export type ValidacionActividades =
  | { ok: true; actividades: ActividadesFormulario | null }
  | { ok: false; status: 400; error: string };

/**
 * Valida el campo `actividades` ({solicitadas, tipos, cualquiera}). Ausente es válido (null: la web no lo envió, p. ej. en vuelos/hoteles
 * o clientes antiguos). Las categorías deben ser de la lista; «cualquier tipo» no se mezcla con categorías concretas.
 */
export function validarActividades(bruto: unknown): ValidacionActividades {
  if (bruto === undefined || bruto === null) return { ok: true, actividades: null };
  const malo = (error: string): ValidacionActividades => ({ ok: false, status: 400, error });
  if (typeof bruto !== 'object' || Array.isArray(bruto)) return malo('Actividades no válidas.');
  const a = bruto as { solicitadas?: unknown; tipos?: unknown; cualquiera?: unknown };
  if (typeof a.solicitadas !== 'boolean' || typeof a.cualquiera !== 'boolean' || !Array.isArray(a.tipos)) return malo('Actividades no válidas.');
  const tipos = a.tipos;
  if (!tipos.every((t) => typeof t === 'string' && (CATEGORIAS_ACTIVIDADES as readonly string[]).includes(t))) {
    return malo(`Categoría de actividades no válida. Valores admitidos: ${CATEGORIAS_ACTIVIDADES.join(', ')}.`);
  }
  const unicos = [...new Set(tipos as string[])];
  if (a.cualquiera && unicos.length) return malo('«Cualquier tipo» no se combina con categorías concretas.');
  if (!a.solicitadas && (a.cualquiera || unicos.length)) return malo('Actividades incoherentes: hay categorías pero no se solicitan.');
  return { ok: true, actividades: { solicitadas: a.solicitadas, tipos: unicos, cualquiera: a.cualquiera } };
}

/** Añade al mensaje del agente lo que el usuario pidió (o no) sobre actividades. Sin dato de la web no se añade nada. */
export function mensajeConActividades(mensaje: string, act: ActividadesFormulario | null): string {
  if (!act) return mensaje;
  if (!act.solicitadas) {
    return `${mensaje}\n\n[Actividades: el usuario NO ha pedido actividades en el formulario. No llames a activities_agent ni propongas actividades, salvo que las pida expresamente en este mensaje.]`;
  }
  if (act.cualquiera || !act.tipos.length) {
    return `${mensaje}\n\n[Actividades solicitadas en el formulario: cualquier tipo. Llama a activities_agent con tipos = ${JSON.stringify([...CATEGORIAS_ACTIVIDADES])} para obtener propuestas variadas; no limites la búsqueda a una sola categoría.]`;
  }
  return `${mensaje}\n\n[Actividades solicitadas en el formulario: ${act.tipos.join(', ')}. Llama a activities_agent con tipos = ${JSON.stringify(act.tipos)}.]`;
}
