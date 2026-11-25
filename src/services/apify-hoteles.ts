/**
 * Proveedor de hoteles basado en Google Hotels a través del actor de Apify
 * `eiv/google-hotels-scraper`. Sigue el patrón de apify-flights.ts: ejecutar el
 * actor, comprobar el estado, leer el dataset y validar antes de entregar al agente.
 *
 * No se activa por sí solo: lo elige el selector (hoteles.ts) con
 * HOTELES_PROVEEDOR=apify. SearchAPI (searchapi.ts) no se toca.
 *
 * Coste: una ejecución por ciudad (las fechas pueden diferir entre ciudades).
 * Con 10 hoteles y precios de webs de reserva el coste medido fue ≈ 0,038 USD.
 * Se limita por ejecución con maxTotalChargeUsd (límite de la plataforma Apify).
 */
import {
  HotelesProveedorError,
  calcularNoches,
  limpiarSecretos,
  type DiagnosticoHoteles,
  type ParametrosHoteles,
  type ResultadoHotelesConEstado,
} from './searchapi.js';
import { codigoPaisDesdeDestino, datosCiudad, variantesCiudad } from './ciudades.js';
import { MAX_HOTELES, normalizarFilasApify, type DiagnosticoApify, type HotelApify } from './hoteles-apify-normalizar.js';

export const ACTOR_HOTELES_ID = 'eiv/google-hotels-scraper';
export const PROVEEDOR_APIFY_HOTELES = 'Apify / Google Hotels';
const MONEDA = 'EUR';
const WAIT_SECS_POR_DEFECTO = 90;
const TOPE_COSTE_USD_POR_DEFECTO = 0.1;
/** Techo absoluto por ejecución: ni la variable de entorno puede superarlo. */
export const TOPE_COSTE_USD_MAXIMO = 0.25;
const TOPE_COSTE_USD_MINIMO = 0.01;
/** Presupuesto por itinerario (todas las ciudades de una petición) si no se configura otro. */
export const PRESUPUESTO_ITINERARIO_USD_POR_DEFECTO = 1;
const ESTADOS_FINALES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

export type ClienteApifyHoteles = {
  actor(id: string): { call(input: any, opts?: any): Promise<any> };
  dataset(id: string): { listItems(opts?: any): Promise<{ items: unknown[] }> };
  /** Necesario para abortar ejecuciones que siguen en marcha tras waitSecs. */
  run?(id: string): { abort(opts?: any): Promise<any> };
};

/**
 * Presupuesto máximo de gasto de Apify para un itinerario. Antes de lanzar el actor se reserva
 * el peor caso (el tope por ejecución); al terminar se sustituye por el coste real si se conoce.
 * Si no queda margen, no se llama a Apify.
 */
export interface PresupuestoApify {
  readonly limiteUsd: number;
  gastadoOReservadoUsd(): number;
  reservar(usd: number): boolean;
  liquidar(reservadoUsd: number, realUsd: number | null): void;
}

export function crearPresupuestoApify(limiteUsd: number = PRESUPUESTO_ITINERARIO_USD_POR_DEFECTO): PresupuestoApify {
  const limite = Number.isFinite(limiteUsd) && limiteUsd > 0 ? limiteUsd : PRESUPUESTO_ITINERARIO_USD_POR_DEFECTO;
  let usado = 0;
  return {
    limiteUsd: limite,
    gastadoOReservadoUsd: () => usado,
    reservar(usd) {
      if (usado + usd > limite + 1e-9) return false;
      usado += usd;
      return true;
    },
    liquidar(reservado, real) {
      // Nunca se libera más de lo reservado ni se descuenta por debajo de lo realmente gastado.
      usado = Math.max(0, usado - reservado + (real !== null && Number.isFinite(real) && real >= 0 ? real : reservado));
    },
  };
}

export function topeCosteDesdeEntorno(valor: string | undefined): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return TOPE_COSTE_USD_POR_DEFECTO;
  return Math.min(TOPE_COSTE_USD_MAXIMO, Math.max(TOPE_COSTE_USD_MINIMO, n));
}

export interface DependenciasApifyHoteles {
  crearCliente?: (token: string) => Promise<ClienteApifyHoteles> | ClienteApifyHoteles;
  token?: string | undefined;
  registrar?: (evento: string, datos: Record<string, unknown>) => void;
  /** Para pruebas: variables de entorno inyectadas. */
  env?: Record<string, string | undefined>;
  /** Presupuesto compartido por todas las búsquedas de un itinerario. */
  presupuesto?: PresupuestoApify;
}

export interface ResultadoHotelesApify extends Omit<ResultadoHotelesConEstado, 'hoteles'> {
  hoteles: HotelApify[];
  diagnosticoApify: DiagnosticoApify | null;
}

const registradorPorDefecto = (evento: string, datos: Record<string, unknown>) => {
  console.info(`[APIFY_HOTELS] ${evento}`, JSON.stringify(datos));
};

function numeroEnv(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/**
 * Consulta para Google Hotels: "hotels in Salento, Colombia". Se usa el texto del destino tal
 * como llega (el país evita homónimos). Las ejecuciones reales verificadas usaron este
 * formato ("hotels in Bogotá, Colombia"); con el país en español no hay ejecución real.
 */
export function construirConsulta(destino: string): string {
  const partes = String(destino ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  return partes.length === 0 ? '' : `hotels in ${partes.join(', ')}`;
}

export function construirEntradaActor(params: ParametrosHoteles, consulta: string) {
  return {
    searchQueries: [consulta],
    checkInDate: params.fechaEntrada,
    checkOutDate: params.fechaSalida,
    adults: params.adultos,
    currency: MONEDA,
    country: 'es',
    language: 'es',
    includeBookingPrices: true,
    maxResultsPerSearch: MAX_HOTELES,
    maxItems: MAX_HOTELES,
  };
}

function validarParametros(params: ParametrosHoteles): void {
  const fecha = /^\d{4}-\d{2}-\d{2}$/;
  if (!String(params.destino ?? '').trim()) throw new HotelesProveedorError('parametros', 'Falta el destino del alojamiento.');
  if (!fecha.test(params.fechaEntrada) || !fecha.test(params.fechaSalida) || Number.isNaN(Date.parse(params.fechaEntrada)) || Number.isNaN(Date.parse(params.fechaSalida))) {
    throw new HotelesProveedorError('parametros', 'Las fechas deben tener el formato YYYY-MM-DD.');
  }
  if (Date.parse(params.fechaSalida) <= Date.parse(params.fechaEntrada)) {
    throw new HotelesProveedorError('parametros', 'La fecha de salida debe ser posterior a la de entrada.');
  }
  if (!Number.isInteger(params.adultos) || params.adultos < 1) {
    throw new HotelesProveedorError('parametros', 'El número de adultos debe ser un entero mayor o igual que 1.');
  }
}

function clasificarErrorApify(error: any, token?: string): HotelesProveedorError {
  const estado = Number(error?.statusCode ?? error?.status ?? NaN);
  const detalle = limpiarSecretos(String(error?.message ?? 'Error de Apify'), token);
  const info = { httpStatus: Number.isFinite(estado) ? estado : null, detalleProveedor: detalle.slice(0, 300), etapa: 'apify_actor' };
  if (estado === 401 || estado === 403) return new HotelesProveedorError('autenticacion', 'Apify rechazó las credenciales (401/403).', info);
  if (estado === 402 || /usage limit|hard limit|limit.*exceed|exceed.*(limit|budget)|insufficient|not enough|credit|budget/i.test(detalle)) {
    return new HotelesProveedorError('limite_uso', 'Apify indica que no hay crédito o se alcanzó un límite de gasto.', info);
  }
  if (estado === 429) return new HotelesProveedorError('limite_peticiones', 'Apify indica demasiadas peticiones simultáneas.', info);
  return new HotelesProveedorError('api', 'No se pudo completar la búsqueda de hoteles con Apify.', info);
}

export async function buscarHotelesApify(
  params: ParametrosHoteles,
  deps: DependenciasApifyHoteles = {},
): Promise<ResultadoHotelesApify> {
  const env = deps.env ?? process.env;
  const registrar = deps.registrar ?? registradorPorDefecto;
  validarParametros(params);

  const tokenOpcional = deps.token ?? env.APIFY_API_TOKEN;
  if (!tokenOpcional) throw new HotelesProveedorError('configuracion', 'APIFY_API_TOKEN no está configurada.', { etapa: 'configuracion' });

  const token: string = tokenOpcional;
  const consulta = construirConsulta(params.destino);
  const entrada = construirEntradaActor(params, consulta);
  const waitSecs = numeroEnv(env.APIFY_HOTELS_WAIT_SECS, WAIT_SECS_POR_DEFECTO);
  const maxTotalChargeUsd = topeCosteDesdeEntorno(env.APIFY_HOTELS_MAX_CHARGE_USD);
  const build = env.APIFY_HOTELS_BUILD?.trim() || undefined;
  const opcionesLlamada: Record<string, unknown> = { waitSecs, maxTotalChargeUsd };
  if (build) opcionesLlamada.build = build;

  // Control de gasto previo a la ejecución: se reserva el peor caso del itinerario.
  if (deps.presupuesto && !deps.presupuesto.reservar(maxTotalChargeUsd)) {
    registrar('presupuesto_agotado', { destino: params.destino, limiteUsd: deps.presupuesto.limiteUsd, reservadoUsd: deps.presupuesto.gastadoOReservadoUsd(), pedidoUsd: maxTotalChargeUsd });
    throw new HotelesProveedorError('limite_uso', 'Se alcanzó el presupuesto de Apify para este itinerario; no se lanza otra búsqueda de hoteles.', { etapa: 'presupuesto' });
  }
  let costeReal: number | null = null;
  try {
    return await ejecutarYNormalizar();
  } finally {
    deps.presupuesto?.liquidar(maxTotalChargeUsd, costeReal);
  }

  async function ejecutarYNormalizar(): Promise<ResultadoHotelesApify> {
  const cliente: ClienteApifyHoteles = deps.crearCliente
    ? await deps.crearCliente(token)
    : (new (await import('apify-client')).ApifyClient({ token }) as unknown as ClienteApifyHoteles);

  registrar('ejecucion_iniciada', { actor: ACTOR_HOTELES_ID, consulta, waitSecs, maxTotalChargeUsd, build: build ?? null });

  let run: any;
  try {
    run = await cliente.actor(ACTOR_HOTELES_ID).call(entrada, opcionesLlamada);
  } catch (error) {
    throw clasificarErrorApify(error, token);
  }
  costeReal = typeof run?.usageTotalUsd === 'number' ? run.usageTotalUsd : null;
  if (run?.status && !ESTADOS_FINALES.has(String(run.status))) {
    // call() solo espera waitSecs: si sigue en marcha seguiría cobrando. Se aborta.
    try {
      if (run.id && cliente.run) await cliente.run(run.id).abort();
      registrar('ejecucion_abortada', { runId: run.id ?? null, status: run.status });
    } catch (error) {
      registrar('aborto_fallido', { runId: run?.id ?? null, mensaje: limpiarSecretos(String((error as any)?.message ?? error), token) });
    }
  }
  registrar('ejecucion_terminada', {
    runId: run?.id ?? null,
    status: run?.status ?? null,
    datasetId: run?.defaultDatasetId ?? null,
    usageTotalUsd: run?.usageTotalUsd ?? null,
  });
  if (run?.status !== 'SUCCEEDED') {
    throw new HotelesProveedorError('api', `Apify no completó la búsqueda de hoteles (estado: ${String(run?.status ?? 'UNKNOWN')}).`, {
      etapa: 'apify_actor',
      detalleProveedor: `estado=${String(run?.status ?? 'UNKNOWN')}`,
    });
  }
  if (!run.defaultDatasetId) {
    throw new HotelesProveedorError('respuesta_invalida', 'Apify no devolvió un dataset de hoteles.', { etapa: 'apify_dataset' });
  }

  const { items } = await cliente.dataset(run.defaultDatasetId).listItems({ limit: 100 });
  if (!Array.isArray(items)) throw new HotelesProveedorError('respuesta_invalida', 'El dataset de hoteles no tiene el formato esperado.', { etapa: 'apify_dataset' });

  const filas = items.filter((f): f is Record<string, any> => typeof f === 'object' && f !== null);
  const hayHoteles = filas.some((f) => f.recordType === undefined || f.recordType === 'hotel');
  if (!hayHoteles) {
    // Filas de error del actor (no se cobran). Los nombres de campo del error no están
    // verificados con una ejecución real: se busca en los habituales.
    const codigos = filas.map((f) => String(f.errorCode ?? f.code ?? f.error ?? '')).filter(Boolean);
    const soloNoEncontrado = codigos.length > 0 && codigos.every((c) => /NOT_FOUND/i.test(c));
    if (codigos.length > 0 && !soloNoEncontrado) {
      throw new HotelesProveedorError('api', 'El actor no pudo leer Google Hotels para esta búsqueda.', {
        etapa: 'apify_dataset',
        detalleProveedor: codigos.slice(0, 3).join(', ').slice(0, 200),
      });
    }
  }

  const datos = datosCiudad(params.destino);
  const paisCodigo = params.paisCodigo ?? codigoPaisDesdeDestino(params.destino);
  const nombresCiudad = [...new Set([...variantesCiudad(params.destino), ...(datos ? [datos.es, datos.en] : [])])];
  const noches = calcularNoches(params.fechaEntrada, params.fechaSalida);
  const { hoteles, diagnostico: diagnosticoApify } = normalizarFilasApify(filas, {
    noches,
    paisCodigo,
    centro: datos ? { lat: datos.lat, lng: datos.lng, ...(datos.radioKm ? { radioKm: datos.radioKm } : {}) } : null,
    nombresCiudad,
  });

  if (diagnosticoApify.filasHotel > 0 && hoteles.length === 0) {
    // Google devolvió alojamientos, pero ninguno pertenece a la ciudad/país pedidos.
    throw new HotelesProveedorError('destino_no_verificado', `Los alojamientos devueltos no corresponden a ${params.destino}; no se muestran para no confundir al usuario.`, {
      etapa: 'validacion_ubicacion',
      detalleProveedor: `descartados=${diagnosticoApify.descartadasPaisOUbicacion}`,
    });
  }

  const conPrecio = hoteles.filter((h) => h.precioDisponible).length;
  const diagnostico: DiagnosticoHoteles = {
    destinoResuelto: consulta,
    propiedadesProveedor: diagnosticoApify.filasHotel,
    devueltos: hoteles.length,
    conPrecio,
    sinPrecio: hoteles.length - conPrecio,
    conEnlace: hoteles.filter((h) => h.url).length,
  };
  registrar('busqueda_completada', { destino: params.destino, ...diagnostico, ...diagnosticoApify });

  return {
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    proveedor: PROVEEDOR_APIFY_HOTELES,
    estado: hoteles.length > 0 ? 'ok' : 'sin_resultados',
    error: null,
    codigoError: null,
    httpStatus: null,
    retryAfter: null,
    detalleProveedor: null,
    etapaError: null,
    diagnostico,
    diagnosticoApify,
    hoteles,
  };
  }
}

const MENSAJE_ERROR_INTERNO = 'Error interno al buscar alojamientos. No se pudo completar la búsqueda.';

/** Igual que buscarHotelesApify, pero nunca lanza: devuelve un estado explícito. */
export async function buscarHotelesApifyConEstado(
  params: ParametrosHoteles,
  deps: DependenciasApifyHoteles = {},
): Promise<ResultadoHotelesApify> {
  const registrar = deps.registrar ?? registradorPorDefecto;
  const vacio = (estado: 'error_proveedor' | 'error_interno', error: string): ResultadoHotelesApify => ({
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    proveedor: PROVEEDOR_APIFY_HOTELES,
    estado,
    error,
    codigoError: null,
    httpStatus: null,
    retryAfter: null,
    detalleProveedor: null,
    etapaError: null,
    diagnostico: { destinoResuelto: '', propiedadesProveedor: 0, devueltos: 0, conPrecio: 0, sinPrecio: 0, conEnlace: 0 },
    diagnosticoApify: null,
    hoteles: [],
  });
  try {
    return await buscarHotelesApify(params, deps);
  } catch (error) {
    if (error instanceof HotelesProveedorError) {
      registrar('error_proveedor', {
        proveedor: 'apify', fase: error.etapa, codigo: error.codigo, httpStatus: error.httpStatus, retryAfter: error.retryAfter, etapa: error.etapa,
        detalleProveedor: error.detalleProveedor, mensaje: error.message, destino: params.destino,
      });
      return {
        ...vacio('error_proveedor', error.message),
        codigoError: error.codigo,
        httpStatus: error.httpStatus,
        retryAfter: error.retryAfter,
        detalleProveedor: error.detalleProveedor,
        etapaError: error.etapa,
      };
    }
    registrar('error_interno', { mensaje: error instanceof Error ? limpiarSecretos(error.message, deps.token ?? (deps.env ?? process.env).APIFY_API_TOKEN) : String(error), destino: params.destino });
    return { ...vacio('error_interno', MENSAJE_ERROR_INTERNO), codigoError: 'error_interno' };
  }
}
