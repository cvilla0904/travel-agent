/**
 * Vuelos (Apify / Google Flights): normalización y orquestación de la búsqueda.
 *
 * Vive fuera de src/index.ts para poder probarse sin cargar el SDK de agentes.
 * Las funciones de normalización se movieron aquí SIN cambios de lógica
 * (salvo el idioma del enlace de búsqueda de Google Flights).
 *
 * Cambios de comportamiento frente a la versión anterior de buscar_vuelos:
 *  - la ida y la vuelta se consultan EN PARALELO e independientes;
 *  - si falla una dirección se devuelven las opciones válidas de la otra,
 *    marcadas como "solo ida" / "solo vuelta", con un aviso explícito;
 *  - un fallo del proveedor no se lanza: se devuelve un estado (como hoteles),
 *    de modo que nunca se confunda con "no hay vuelos";
 *  - no se combinan tramos sin precio (antes el total quedaba subestimado).
 */
import { buscarVuelosApify, ErrorVuelos, type BuscarVuelosApifyParams } from './apify-flights.js';

export function parsearDuracionMinutos(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const texto = value.trim().toLowerCase();
  const horas = texto.match(/(\d+)\s*h/);
  const minutos = texto.match(/(\d+)\s*m/);
  if (horas || minutos) return Number(horas?.[1] ?? 0) * 60 + Number(minutos?.[1] ?? 0);
  const numerico = Number(texto);
  return Number.isFinite(numerico) ? numerico : 0;
}

export function extraerSegmentosApify(leg: any, fallbackOrigen = '', fallbackDestino = '') {
  const segmentos = Array.isArray(leg?.segments) ? leg.segments
    : Array.isArray(leg?.flights) ? leg.flights
    : Array.isArray(leg) ? leg
    : leg && (leg.departure_airport || leg.departureAirport) && (leg.departs || leg.departure_time || leg.departureTime) ? [{
        departure_airport: {
          name: typeof leg.departure_airport === 'object' ? leg.departure_airport.name : (leg.departure_airport ?? leg.departureAirport ?? fallbackOrigen),
          id: typeof leg.departure_airport === 'object' ? leg.departure_airport.id : (leg.departure_airport ?? leg.departureAirport ?? ''),
          time: leg.departs ?? leg.departure_time ?? leg.departureTime,
        },
        arrival_airport: {
          name: typeof leg.arrival_airport === 'object' ? leg.arrival_airport.name : (leg.arrival_airport ?? leg.arrivalAirport ?? fallbackDestino),
          id: typeof leg.arrival_airport === 'object' ? leg.arrival_airport.id : (leg.arrival_airport ?? leg.arrivalAirport ?? ''),
          time: leg.arrives ?? leg.arrival_time ?? leg.arrivalTime,
        },
        duration: leg.duration,
        airline: Array.isArray(leg.airlines) ? leg.airlines.join(' + ') : (leg.airlines ?? leg.airline ?? ''),
        flight_number: Array.isArray(leg.flight_numbers) ? leg.flight_numbers.join(', ') : (leg.flight_numbers ?? leg.flight_number ?? ''),
      }]
    : [];
  return segmentos.map((segmento: any) => {
    const salida = segmento.departureAirport ?? segmento.departure_airport ?? segmento.departure ?? {};
    const llegada = segmento.arrivalAirport ?? segmento.arrival_airport ?? segmento.arrival ?? {};
    const hora = (value: any) => {
      const raw = typeof value === 'string' ? value : value?.time ?? value?.datetime ?? '';
      const match = typeof raw === 'string' ? raw.match(/(?:^|\s)(\d{1,2}:\d{2})(?::\d{2})?$/) : null;
      return match ? match[1] : raw;
    };
    const codigo = (value: any) => typeof value === 'string' ? (/^[A-Z]{3}$/i.test(value) ? value.toUpperCase() : '') : value?.code ?? value?.iata ?? value?.id ?? '';
    const nombre = (value: any, fallback: string) => typeof value === 'string' ? value : value?.name ?? value?.city ?? fallback;
    const duracion = parsearDuracionMinutos(segmento.durationMinutes ?? segmento.duration_minutes ?? segmento.duration ?? 0);
    return {
      aeropuertoSalida: nombre(salida, fallbackOrigen),
      codigoSalida: codigo(salida),
      horaSalida: hora(salida),
      aeropuertoLlegada: nombre(llegada, fallbackDestino),
      codigoLlegada: codigo(llegada),
      horaLlegada: hora(llegada),
      duracionMinutos: duracion,
      aerolinea: String(segmento.airlines ?? segmento.airline ?? segmento.airlineName ?? segmento.carrier ?? ''),
      numeroVuelo: String(segmento.flight_numbers ?? segmento.flightNumber ?? segmento.flight_number ?? ''),
    };
  });
}

export function parsearPrecioApify(value: any): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  // Los actores pueden devolver precios como "$123", "€123", "1.234,56 €"
  // o "1,234.56". Convertimos el valor sin depender del símbolo de moneda.
  let texto = value.trim().replace(/[^0-9,.-]/g, '');
  if (!texto) return 0;
  if (texto.includes(',') && texto.includes('.')) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) {
      texto = texto.replace(/\./g, '').replace(',', '.');
    } else {
      texto = texto.replace(/,/g, '');
    }
  } else if (texto.includes(',')) {
    const decimales = texto.length - texto.lastIndexOf(',') - 1;
    texto = decimales > 0 && decimales <= 2
      ? texto.replace(',', '.')
      : texto.replace(/,/g, '');
  }
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : 0;
}

export function crearEnlaceBusquedaGoogleFlights(origen: string, destino: string, fechaIda: string, fechaVuelta = ''): string {
  const ida = `Flights from ${origen} to ${destino} on ${fechaIda}`;
  const consulta = fechaVuelta ? `${ida} through ${fechaVuelta}` : ida;
  return `https://www.google.com/travel/flights?hl=es&gl=es&curr=EUR&q=${encodeURIComponent(consulta)}`;
}

export function normalizarVueloIdaVuelta(vuelo: any, ctx: {
  origen: string; destino: string; fechaIda: string; fechaVuelta: string; pasajeros: number;
}) {
  const ida = vuelo.outbound ?? vuelo.outboundLeg ?? vuelo.departure ?? vuelo.legs?.[0] ?? vuelo;
  const vuelta = vuelo.return ?? vuelo.returnLeg ?? vuelo.inbound ?? vuelo.legs?.[1] ?? null;
  const segmentosIda = extraerSegmentosApify(ida, ctx.origen, ctx.destino);
  const segmentosVuelta = extraerSegmentosApify(vuelta, ctx.destino, ctx.origen);
  const precioTotal = parsearPrecioApify(vuelo.price ?? vuelo.totalPrice ?? vuelo.total_price ?? vuelo.priceTotal ?? 0);
  const aerolineas = [...new Set([...segmentosIda, ...segmentosVuelta].map((s: any) => s.aerolinea).filter(Boolean))];
  return {
    aerolinea: String(Array.isArray(vuelo.airlines) ? vuelo.airlines.join(' + ') : (vuelo.airlines || aerolineas.join(' + ') || 'Aerolínea no indicada')),
    precioPorPersona: Number(vuelo.pricePerPassenger ?? vuelo.price_per_passenger ?? (precioTotal / ctx.pasajeros)),
    precioTotal,
    moneda: String(vuelo.currency ?? 'EUR'),
    enlace: String(vuelo.booking_url ?? vuelo.bookingUrl ?? vuelo.googleFlightsUrl ?? vuelo.google_flights_url ?? vuelo.url ?? crearEnlaceBusquedaGoogleFlights(ctx.origen, ctx.destino, ctx.fechaIda, ctx.fechaVuelta)),
    esIdaVuelta: true,
    tipo: 'Ida y vuelta',
    escalasIda: Number.isFinite(Number(vuelo.stops)) ? Math.max(0, Number(vuelo.stops)) : Math.max(0, segmentosIda.length - 1),
    escalasVuelta: vuelta && Number.isFinite(Number(vuelta.stops)) ? Math.max(0, Number(vuelta.stops)) : Math.max(0, segmentosVuelta.length - 1),
    esDirecto: (Number.isFinite(Number(vuelo.stops)) ? Number(vuelo.stops) === 0 : segmentosIda.length === 1) &&
      (!vuelta || (Number.isFinite(Number(vuelta.stops)) ? Number(vuelta.stops) === 0 : segmentosVuelta.length === 1)),
    ida: {
      fecha: ctx.fechaIda,
      segmentos: segmentosIda,
      duracionMinutos: parsearDuracionMinutos(ida?.durationMinutes ?? ida?.duration_minutes ?? ida?.duration ?? segmentosIda.reduce((t: number, s: any) => t + s.duracionMinutos, 0)),
    },
    vuelta: {
      fecha: ctx.fechaVuelta,
      segmentos: segmentosVuelta,
      duracionMinutos: parsearDuracionMinutos(vuelta?.durationMinutes ?? vuelta?.duration_minutes ?? vuelta?.duration ?? segmentosVuelta.reduce((t: number, s: any) => t + s.duracionMinutos, 0)),
    },
  };
}

export function combinarItinerarioAbierto(idaRaw: any, vueltaRaw: any, ctx: {
  origen: string; destino: string; destinoRegreso: string; fechaIda: string; fechaVuelta: string; pasajeros: number;
}) {
  const ida = normalizarVueloIdaVuelta({ ...idaRaw, return: null }, {
    origen: ctx.origen, destino: ctx.destino, fechaIda: ctx.fechaIda, fechaVuelta: ctx.fechaIda, pasajeros: ctx.pasajeros,
  });
  const vuelta = normalizarVueloIdaVuelta({ ...vueltaRaw, return: null }, {
    origen: ctx.destinoRegreso, destino: ctx.origen, fechaIda: ctx.fechaVuelta, fechaVuelta: ctx.fechaVuelta, pasajeros: ctx.pasajeros,
  });
  const precioTotal = ida.precioTotal + vuelta.precioTotal;
  return {
    aerolinea: [ida.aerolinea, vuelta.aerolinea].filter(Boolean).join(' + '),
    precioPorPersona: Math.round(precioTotal / ctx.pasajeros),
    precioTotal,
    moneda: ida.moneda || vuelta.moneda || 'EUR',
    enlace: crearEnlaceBusquedaGoogleFlights(ctx.origen, ctx.destino, ctx.fechaIda, ctx.fechaVuelta),
    esIdaVuelta: true,
    tipo: ctx.destinoRegreso === ctx.destino ? 'Ida y vuelta' : 'Itinerario abierto / multidestino',
    escalasIda: ida.escalasIda,
    escalasVuelta: vuelta.escalasIda,
    esDirecto: ida.esDirecto && vuelta.esDirecto,
    ida: ida.ida,
    vuelta: { ...vuelta.ida, fecha: ctx.fechaVuelta },
  };
}

/* =========================================================
   ORQUESTACIÓN CON ESTADO EXPLÍCITO
   ========================================================= */

export type EstadoVuelos = 'ok' | 'parcial' | 'sin_resultados' | 'error_proveedor' | 'error_parametros';
export type DireccionVuelo = 'ida' | 'vuelta';

export interface ParametrosVuelos {
  origen: string;
  destino: string;
  fechaIda: string;
  fechaVuelta: string;
  pasajeros: number;
  aeropuertoDestino?: string | undefined;
  destinoRegreso?: string | undefined;
}

export interface ResultadoVuelos {
  origen: string;
  destino: string;
  destinoRegreso?: string;
  aeropuertoDestino: string;
  aeropuertoOrigen: string;
  fechaIda: string;
  fechaVuelta: string;
  pasajeros: number;
  estado: EstadoVuelos;
  /** Mensaje del fallo principal; null si no hubo fallo. */
  error: string | null;
  /** Direcciones cuya consulta FALLÓ (no confundir con "sin resultados"). */
  direccionesConError: DireccionVuelo[];
  /** Avisos legibles (p. ej. "no se pudo consultar la vuelta"). */
  avisos: string[];
  vuelos: any[];
}

export interface DependenciasVuelos {
  buscar?: (params: BuscarVuelosApifyParams) => Promise<Record<string, any>[]>;
}

const MAX_TRAMOS_POR_DIRECCION = 5;
const MAX_VUELOS = 10;

export function precioDeRegistro(registro: any): number {
  return parsearPrecioApify(registro?.price ?? registro?.totalPrice ?? registro?.total_price ?? registro?.priceTotal ?? 0);
}

function conPrecio(registros: any[]): any[] {
  return registros.filter((registro) => precioDeRegistro(registro) > 0);
}

function redactar(mensaje: string): string {
  return mensaje
    .replace(/apify_api_[A-Za-z0-9]+/g, '[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/(token["']?\s*[:=]\s*["']?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]');
}

function mensajeDe(razon: unknown): string {
  return redactar(razon instanceof Error ? razon.message : String(razon));
}

function esErrorDeParametros(razon: unknown): boolean {
  return razon instanceof ErrorVuelos && (razon.codigo === 'parametros' || razon.codigo === 'configuracion');
}

export async function buscarVuelosConEstado(
  p: ParametrosVuelos,
  dependencias: DependenciasVuelos = {},
): Promise<ResultadoVuelos> {
  const buscar = dependencias.buscar ?? buscarVuelosApify;
  const destinoBusqueda = p.aeropuertoDestino?.trim() || p.destino;
  const hayVuelta = Boolean(p.fechaVuelta);
  const abierto = Boolean(p.destinoRegreso);
  const origenVuelta = p.destinoRegreso || destinoBusqueda;

  const base = {
    origen: p.origen,
    destino: p.destino,
    ...(p.destinoRegreso ? { destinoRegreso: p.destinoRegreso } : {}),
    aeropuertoDestino: p.aeropuertoDestino?.trim().toUpperCase() || p.destino,
    aeropuertoOrigen: p.origen,
    fechaIda: p.fechaIda,
    fechaVuelta: p.fechaVuelta,
    pasajeros: p.pasajeros,
  };

  // Las dos direcciones son independientes: se lanzan a la vez y un fallo de una no cancela la otra.
  const [rIda, rVuelta] = await Promise.allSettled([
    buscar({ origen: p.origen, destino: destinoBusqueda, fechaIda: p.fechaIda, pasajeros: p.pasajeros }),
    hayVuelta
      ? buscar({ origen: origenVuelta, destino: p.origen, fechaIda: p.fechaVuelta, pasajeros: p.pasajeros })
      : Promise.resolve([] as Record<string, any>[]),
  ]);

  const fallos: Array<{ direccion: DireccionVuelo; razon: unknown }> = [];
  if (rIda.status === 'rejected') fallos.push({ direccion: 'ida', razon: rIda.reason });
  if (hayVuelta && rVuelta.status === 'rejected') fallos.push({ direccion: 'vuelta', razon: rVuelta.reason });

  const idaCruda = rIda.status === 'fulfilled' ? rIda.value : [];
  const vueltaCruda = rVuelta.status === 'fulfilled' ? rVuelta.value : [];
  const idaValida = conPrecio(idaCruda);
  const vueltaValida = conPrecio(vueltaCruda);

  const avisos: string[] = [];
  for (const f of fallos) avisos.push(`No se pudo consultar la ${f.direccion}: ${mensajeDe(f.razon)}`);
  const direccionesConError = fallos.map((f) => f.direccion);

  const ctxIda = { origen: p.origen, destino: destinoBusqueda, fechaIda: p.fechaIda, fechaVuelta: '', pasajeros: p.pasajeros };
  const soloIda = () => idaValida.slice(0, MAX_VUELOS).map((registro: any) => ({
    ...normalizarVueloIdaVuelta(registro, ctxIda), esIdaVuelta: false, tipo: 'Solo ida',
  }));
  const soloVuelta = () => vueltaValida.slice(0, MAX_VUELOS).map((registro: any) => {
    const n = normalizarVueloIdaVuelta(registro, {
      origen: origenVuelta, destino: p.origen, fechaIda: p.fechaVuelta, fechaVuelta: '', pasajeros: p.pasajeros,
    });
    return { ...n, esIdaVuelta: false, tipo: 'Solo vuelta', ida: { fecha: '', segmentos: [], duracionMinutos: 0 }, vuelta: { ...n.ida, fecha: p.fechaVuelta } };
  });
  const ordenar = (lista: any[]) => lista
    .filter((v) => Number.isFinite(v.precioTotal) && v.precioTotal > 0)
    .sort((a, b) => a.precioTotal - b.precioTotal)
    .slice(0, MAX_VUELOS);

  const resultado = (estado: EstadoVuelos, vuelos: any[], error: string | null): ResultadoVuelos => ({
    ...base, estado, error, direccionesConError, avisos, vuelos,
  });

  // Solo ida solicitada (sin fecha de vuelta).
  if (!hayVuelta) {
    if (fallos.length) return resultado(esErrorDeParametros(fallos[0]!.razon) ? 'error_parametros' : 'error_proveedor', [], avisos[0] ?? null);
    const lista = ordenar(soloIda());
    return resultado(lista.length ? 'ok' : 'sin_resultados', lista, null);
  }

  // Ambas direcciones consultadas con éxito.
  if (!fallos.length) {
    if (idaValida.length && vueltaValida.length) {
      const combinados = idaValida.slice(0, MAX_TRAMOS_POR_DIRECCION).flatMap((ida: any) =>
        vueltaValida.slice(0, MAX_TRAMOS_POR_DIRECCION).map((vuelta: any) => combinarItinerarioAbierto(ida, vuelta, abierto
          ? { origen: p.origen, destino: p.destino, destinoRegreso: p.destinoRegreso!, fechaIda: p.fechaIda, fechaVuelta: p.fechaVuelta, pasajeros: p.pasajeros }
          : { origen: p.origen, destino: destinoBusqueda, destinoRegreso: destinoBusqueda, fechaIda: p.fechaIda, fechaVuelta: p.fechaVuelta, pasajeros: p.pasajeros },
        )));
      const lista = ordenar(combinados);
      if (lista.length) return resultado('ok', lista, null);
    }
    // Una dirección respondió pero sin ningún vuelo con precio: se conservan las opciones válidas de la otra.
    if (idaValida.length || vueltaValida.length) {
      const sinResultados = idaValida.length ? 'vuelta' : 'ida';
      avisos.push(`El proveedor no devolvió vuelos con precio para la ${sinResultados}; se muestran solo los de la otra dirección.`);
      return resultado('parcial', ordenar(idaValida.length ? soloIda() : soloVuelta()), null);
    }
    return resultado('sin_resultados', [], null);
  }

  // Alguna dirección ha FALLADO.
  const disponibles = ordenar([...(rIda.status === 'fulfilled' ? soloIda() : []), ...(rVuelta.status === 'fulfilled' ? soloVuelta() : [])]);
  if (disponibles.length) return resultado('parcial', disponibles, avisos[0] ?? null);
  const todoParametros = fallos.every((f) => esErrorDeParametros(f.razon));
  return resultado(todoParametros ? 'error_parametros' : 'error_proveedor', [], avisos.join(' | '));
}
