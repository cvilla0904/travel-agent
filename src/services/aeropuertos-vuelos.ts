/**
 * Resolución del aeropuerto IATA de un origen o destino de vuelos.
 *
 * Fuente única: el catálogo de destinos (src/geo). No hay diccionarios paralelos: el aeropuerto principal de cada destino es el
 * primero de su lista (src/geo/data/seleccion-destinos.json → aeropuertosPrincipales).
 *
 * Por orden:
 *  1. Código IATA escrito («BRU», «Bruselas (BRU)»). Un código de CIUDAD («PAR», «ROM», «LON») se traduce al aeropuerto principal
 *     de esa ciudad: a los proveedores solo se les envían códigos de aeropuerto.
 *  2. Aeropuerto fijado por el servidor a partir del destino elegido en el autocompletado (destino-fijado.ts).
 *  3. Con país escrito («Cartagena, España»): el catálogo distingue homónimos.
 *  4. Catálogo geográfico: el nombre ORIGINAL, su nombre base, la traducción habitual y, si lo escrito nombra un aeropuerto
 *     («Brussels Airport»), el aeropuerto por su nombre o la ciudad sin esa palabra.
 *  5. Sin aeropuerto propio: el aeropuerto de acceso más cercano del catálogo, marcado como tal (nunca en silencio).
 * Si nada resuelve, error de parámetros claro (nunca un aeropuerto inventado).
 */
import { catalogoGeoActual, codigoPaisDesdeDestino, consultaProveedorParaCiudad, nombreBaseCiudad, normalizarTexto } from './ciudades.js';
import { buscarDestinos } from '../geo/buscar.js';
import { accesoAereoDeCiudad } from '../geo/aeropuertos.js';
import { destinoEditorial } from '../geo/destinos-editoriales.js';
import type { Catalogo } from '../geo/catalogo.js';
import type { Aeropuerto } from '../geo/tipos.js';
import type { DestinoSeleccionado } from './destino-seleccionado.js';
import { ErrorVuelos } from './errores-vuelos.js';

export type ViaAeropuerto = 'iata' | 'fijado' | 'catalogo-pais' | 'catalogo-ciudad' | 'catalogo-aeropuerto' | 'catalogo-traduccion' | 'catalogo-acceso';

export interface AeropuertoResuelto {
  iata: string;
  /** Nombre del aeropuerto cuando el catálogo lo conoce. */
  nombre?: string;
  via: ViaAeropuerto;
  /** Lo que se escribió (para trazas y mensajes). */
  entrada: string;
  /** Aviso legible si el aeropuerto no es de la propia ciudad (aeropuerto de acceso). */
  aviso?: string;
}

const PALABRAS_AEROPUERTO = /\b(?:airport|aeropuerto|aeroport|aeroporto|aeroporto|flughafen|aeroport internacional|international|internacional|intl)\b/g;

function sinAcentos(t: string): string { return normalizarTexto(t); }

function quitarPalabrasAeropuerto(texto: string): string {
  return sinAcentos(texto).replace(PALABRAS_AEROPUERTO, ' ').replace(/\b(?:de|del|di|d|of|the)\b\s*$/g, ' ').replace(/^\s*(?:de|del|di|of|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function nombraAeropuerto(texto: string): boolean {
  return /\b(?:airport|aeropuerto|aeroport|aeroporto|flughafen)\b/.test(sinAcentos(texto));
}

/** De varios aeropuertos de una ciudad, el principal es el primero (el catálogo los entrega ordenados). */
function elegirPrincipal(iatas: string[]): string | undefined {
  return iatas[0];
}

/** Aeropuerto principal de la ciudad que tiene ese código IATA de CIUDAD («PAR» → CDG), o undefined si no es un código de ciudad. */
function aeropuertoDeCodigoCiudad(cat: Catalogo, codigo: string): string | undefined {
  const c = codigo.toUpperCase();
  if (cat.aeropuertoPorIata(c)) return undefined; // es un aeropuerto: se usa tal cual
  for (const e of cat.entradas(c.toLowerCase())) {
    if (e[0] !== 'c') continue;
    const ciudad = cat.ciudad(e[1], e[2]);
    if (ciudad?.codigoCiudad === c && ciudad.aeropuertos.length) return elegirPrincipal(ciudad.aeropuertos);
  }
  return undefined;
}

function datosAeropuerto(cat: Catalogo, iata: string): { nombre?: string } {
  const a: Aeropuerto | undefined = cat.aeropuertoPorIata(iata);
  return a ? { nombre: a.nombre } : {};
}

/** Aeropuerto exacto por su nombre («Brussels Airport», «Aeropuerto Adolfo Suárez Madrid-Barajas»). */
function aeropuertoPorNombre(cat: Catalogo, texto: string, pais?: string): Aeropuerto | undefined {
  const clave = sinAcentos(texto).replace(/\s+/g, ' ').trim();
  const sinPalabra = quitarPalabrasAeropuerto(texto);
  const todos = cat.todosAeropuertos().filter((a) => !pais || a.pais.toLowerCase() === pais.toLowerCase());
  const exacto = todos.find((a) => sinAcentos(a.nombre) === clave);
  if (exacto) return exacto;
  // «Brussels Airport» ≈ nombre exacto sin la palabra «airport» y sin país: solo si hay un único aeropuerto con ese nombre.
  const parecidos = todos.filter((a) => quitarPalabrasAeropuerto(a.nombre) === sinPalabra && sinPalabra.length >= 3);
  return parecidos.length === 1 ? parecidos[0] : undefined;
}

function desdeCatalogo(cat: Catalogo, consulta: string, pais?: string): AeropuertoResuelto | undefined {
  const resultados = buscarDestinos(cat, consulta, { ...(pais ? { pais } : {}), limite: 6 });
  const claveConsulta = sinAcentos(consulta);
  for (const r of resultados) {
    if (r.tipo === 'aeropuerto' && r.id.startsWith('iata:')) {
      const iata = r.id.slice(5).toUpperCase();
      return { iata, ...datosAeropuerto(cat, iata), via: 'catalogo-aeropuerto', entrada: consulta };
    }
    if (r.tipo !== 'ciudad') continue;
    // Solo ciudades cuyo nombre coincide de verdad con lo escrito (no un prefijo de otra: «Bru» → Brugge).
    const nombres = [r.nombre, ...(r.alias ? [r.alias] : [])].map(sinAcentos);
    if (r.coincidencia !== 'exacta' && !nombres.includes(claveConsulta)) continue;
    if (r.aeropuertos?.length) {
      const iata = elegirPrincipal(r.aeropuertos)!;
      return { iata, ...datosAeropuerto(cat, iata), via: 'catalogo-ciudad', entrada: consulta };
    }
    if (r.codigoPais) {
      const ciudad = cat.ciudad(r.id, r.codigoPais);
      const acceso = ciudad ? accesoAereoDeCiudad(cat, ciudad).acceso[0] : undefined;
      if (acceso) {
        return {
          iata: acceso.iata, nombre: acceso.nombre, via: 'catalogo-acceso', entrada: consulta,
          aviso: `${r.nombre} no tiene aeropuerto propio: se usa ${acceso.nombre} (${acceso.iata}), a unos ${acceso.distanciaKm} km.`,
        };
      }
    }
  }
  return undefined;
}

/** Aeropuerto de un destino elegido en el autocompletado (id estable), o undefined si el tipo/id no determina uno. */
export function aeropuertoDeDestinoSeleccionado(d: DestinoSeleccionado, cat: Catalogo = catalogoGeoActual()): AeropuertoResuelto | undefined {
  if (!d.id || d.tipo === 'pais' || d.tipo === 'region') return undefined;
  const entrada = d.nombre;
  if (d.id.startsWith('iata:')) {
    const iata = d.id.slice(5).toUpperCase();
    return { iata, ...datosAeropuerto(cat, iata), via: 'fijado', entrada };
  }
  if (d.id.startsWith('ed:')) {
    const ed = destinoEditorial(d.id);
    const iata = ed?.aeropuertos[0];
    return iata ? { iata, ...datosAeropuerto(cat, iata), via: 'fijado', entrada, aviso: `${ed!.nombre} no tiene aeropuerto propio: se usa ${iata}.` } : undefined;
  }
  if (d.id.startsWith('gn:') && d.codigoPais) {
    const ciudad = cat.ciudad(d.id, d.codigoPais.toUpperCase());
    if (!ciudad) return undefined;
    if (ciudad.aeropuertos.length) {
      const iata = elegirPrincipal(ciudad.aeropuertos)!;
      return { iata, ...datosAeropuerto(cat, iata), via: 'fijado', entrada };
    }
    const acceso = accesoAereoDeCiudad(cat, ciudad).acceso[0];
    return acceso
      ? { iata: acceso.iata, nombre: acceso.nombre, via: 'fijado', entrada, aviso: `${ciudad.nombre} no tiene aeropuerto propio: se usa ${acceso.nombre} (${acceso.iata}), a unos ${acceso.distanciaKm} km.` }
      : undefined;
  }
  return undefined;
}

export function resolverAeropuertoVuelo(valor: string, campo: string, cat?: Catalogo): AeropuertoResuelto {
  const entrada = String(valor ?? '').trim();
  const fallo = () => new ErrorVuelos('parametros',
    `No he podido identificar el aeropuerto IATA de ${campo} ("${entrada}"). Prueba con un código IATA de tres letras, por ejemplo BIO, MAD o FCO.`);
  if (!entrada) throw fallo();

  let catalogo: Catalogo | undefined = cat;
  try { catalogo ??= catalogoGeoActual(); } catch { catalogo = undefined; }

  // 1. Código IATA, solo o entre paréntesis. Un código de ciudad se traduce a su aeropuerto principal.
  const codigoEscrito = /^[A-Za-z]{3}$/.test(entrada) ? entrada : entrada.match(/\(([A-Za-z]{3})\)\s*$/)?.[1];
  if (codigoEscrito) {
    let principal: string | undefined;
    try { principal = catalogo ? aeropuertoDeCodigoCiudad(catalogo, codigoEscrito) : undefined; } catch { principal = undefined; }
    if (principal) return { iata: principal, ...(catalogo ? datosAeropuerto(catalogo, principal) : {}), via: 'iata', entrada, aviso: `${codigoEscrito.toUpperCase()} es un código de ciudad: se usa su aeropuerto principal ${principal}.` };
    return { iata: codigoEscrito.toUpperCase(), via: 'iata', entrada };
  }

  const base = nombreBaseCiudad(entrada);
  const tienePais = entrada.includes(',');

  // 3. Con país escrito: el catálogo, que sí distingue homónimos («Cartagena, España» no es CTG de Colombia).
  if (tienePais && catalogo) {
    try {
      const codigo = codigoPaisDesdeDestino(entrada)?.toUpperCase();
      const r = codigo ? desdeCatalogo(catalogo, base, codigo) : undefined;
      if (r) return { ...r, via: 'catalogo-pais', entrada };
    } catch { /* catálogo no disponible */ }
  }

  // 4. Catálogo: nombre original, base, traducción habitual, aeropuerto por nombre o ciudad sin la palabra «aeropuerto».
  if (catalogo) {
    try {
      if (nombraAeropuerto(entrada)) {
        const a = aeropuertoPorNombre(catalogo, entrada);
        if (a) return { iata: a.iata, nombre: a.nombre, via: 'catalogo-aeropuerto', entrada };
      }
      const sinPalabra = quitarPalabrasAeropuerto(entrada);
      const candidatas = [...new Set([entrada, base, sinPalabra, quitarPalabrasAeropuerto(base), consultaProveedorParaCiudad(entrada)].filter((c) => c && c.length >= 3))];
      for (const c of candidatas) {
        const r = desdeCatalogo(catalogo, c);
        if (r) return { ...r, via: c === consultaProveedorParaCiudad(entrada) && c !== entrada && c !== base ? 'catalogo-traduccion' : r.via, entrada };
      }
    } catch { /* catálogo no disponible o ilegible */ }
  }
  throw fallo();
}
