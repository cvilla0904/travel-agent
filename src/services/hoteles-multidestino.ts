/**
 * Búsqueda de hoteles de cada tramo de un itinerario multidestino. Cada tramo usa SUS PROPIAS
 * fechas (entrada/salida de esa ciudad). Extraído de index.ts para poder probarlo sin el SDK.
 */
import { buscarHotelesConEstado, type DependenciasHoteles } from './hoteles.js';

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

export function normalizarCiudadBusquedaMultidestino(ciudad: string, pais?: string): string {
  const valor = ciudad.trim();

  const equivalencias: Record<string, string> = {
    'cartagena': 'Cartagena de Indias, Colombia',
    'cartagena de indias': 'Cartagena de Indias, Colombia',
    'bogota': 'Bogotá, Colombia',
    'bogotá': 'Bogotá, Colombia',
    'medellin': 'Medellín, Colombia',
    'medellín': 'Medellín, Colombia',
  };

  const clave = valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  if (equivalencias[clave]) {
    return equivalencias[clave];
  }

  return pais ? `${valor}, ${pais}` : valor;
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
      paisCodigo: obtenerCodigoPais(contexto.pais),
    },
    deps,
  );
}
