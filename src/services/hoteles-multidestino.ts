/**
 * Búsqueda de hoteles de cada tramo de un itinerario multidestino. Cada tramo usa SUS PROPIAS
 * fechas (entrada/salida de esa ciudad). Extraído de index.ts para poder probarlo sin el SDK.
 */
import { buscarHotelesConEstado, type DependenciasHoteles } from './hoteles.js';
import { codigoPaisDesdeNombre, grupoCurado, nombreBaseCiudad } from './ciudades.js';

export function obtenerCodigoPais(pais: string): string | undefined {
  const clave = pais
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const codigos: Record<string, string> = {
    colombia: 'co',
    espana: 'es',
    españa: 'es',
    italia: 'it',
    francia: 'fr',
    portugal: 'pt',
    alemania: 'de',
    austria: 'at',
    'reino unido': 'gb',
    japon: 'jp',
    mexico: 'mx',
    méxico: 'mx',
    'estados unidos': 'us',
  };

  return codigos[clave];
}

/**
 * Destino que se envía al proveedor para un tramo: «Ciudad[, Región], País».
 * - Conserva la región de las ciudades curadas que la tienen («Salento» de Colombia → «Salento, Quindío, Colombia»).
 * - La ciudad curada solo se aplica si el país del itinerario es el suyo: «Cartagena» en un itinerario por España es
 *   «Cartagena, España», nunca Cartagena de Indias.
 * - Si el nombre ya llega calificado («Salento, Quindío», «Salento, Quindío, Colombia») no se duplica nada.
 */
export function normalizarCiudadBusquedaMultidestino(ciudad: string, pais?: string): string {
  const valor = ciudad.trim();
  const partes = valor.split(',').map((p) => p.trim()).filter(Boolean);
  const paisEscrito = partes.length > 1 ? codigoPaisDesdeNombre(partes[partes.length - 1]) : undefined;
  const nombrePais = pais?.trim() || '';

  // Texto con país para decidir si la entrada curada es la de ese país.
  const conPais = paisEscrito || !nombrePais ? valor : `${valor}, ${nombrePais}`;
  const grupo = grupoCurado(conPais);

  if (grupo) {
    const base = grupo.consulta === 'Cartagena de Indias' ? grupo.consulta : nombreBaseCiudad(valor);
    const region = grupo.region ?? '';
    const paisFinal = paisEscrito ? partes[partes.length - 1]! : nombrePais || grupo.paisNombre || '';
    const intermedias = partes.slice(1, paisEscrito ? -1 : undefined);
    const regionFinal = intermedias.length ? intermedias.join(', ') : region;
    return [base, regionFinal, paisFinal].filter(Boolean).join(', ');
  }
  if (paisEscrito || !nombrePais) return valor;
  return `${valor}, ${nombrePais}`;
}

export interface TramoHoteles { ciudad: string; fechaEntrada: string; fechaSalida: string }

export function buscarHotelesTramo(
  tramo: TramoHoteles,
  contexto: { pais: string; adultos: number },
  deps: DependenciasHoteles = {},
) {
  return buscarHotelesConEstado(
    {
      destino: normalizarCiudadBusquedaMultidestino(tramo.ciudad, contexto.pais),
      fechaEntrada: tramo.fechaEntrada,
      fechaSalida: tramo.fechaSalida,
      adultos: contexto.adultos,
      paisCodigo: obtenerCodigoPais(contexto.pais) ?? codigoPaisDesdeNombre(contexto.pais),
    },
    deps,
  );
}
