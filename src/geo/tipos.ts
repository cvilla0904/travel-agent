/** Tipos del motor geográfico de Mogavel (src/geo). Sin dependencias de proveedores. */

export type TipoEntidad = 'pais' | 'region' | 'ciudad' | 'aeropuerto';

export interface Pais { iso: string; nombre: string; nombres: string[] }

export interface Aeropuerto {
  iata: string; nombre: string; pais: string; lat: number; lon: number;
  tipo: 'large' | 'medium'; municipio: string;
  /** Id de la ciudad del catálogo a la que sirve (null si no se pudo asociar con seguridad). */
  ciudadId: string | null;
}

export interface Ciudad {
  /** Identidad estable reutilizable por vuelos, hoteles y actividades: «gn:<geonameid>». */
  id: string; nombre: string; nombreAscii?: string; pais: string; admin1?: string;
  poblacion: number; lat: number; lon: number;
  /** Nombres alternativos ya normalizados (sin acentos, minúsculas). */
  nombres: string[];
  /** IATA de los aeropuertos comerciales asociados a esta ciudad (máximo 3; el primero es el principal). */
  aeropuertos: string[];
  /** Código IATA de ciudad (metropolitano: PAR, LON, ROM…), solo cuando IATA define uno. Distinto de los de aeropuerto. */
  codigoCiudad?: string;
}

/** Ficha mínima de una ciudad para mostrar y resolver destinos (sin lista de nombres alternativos). */
export interface FichaCiudad {
  id: string; nombre: string; nombreAscii: string; pais: string; poblacion: number; lat: number; lon: number;
  aeropuertos: string[];
}

export interface MetaCatalogo {
  formato: 3; generado: string; ciudades: number; aeropuertos: number; paises: number; buckets: number;
  /** SHA-256 de cada archivo generado, para detectar catálogos incompletos o alterados. */
  sha256: Record<string, string>;
}

export interface ShardPais { iso: string; ciudades: Record<string, Ciudad>; aeropuertos: Record<string, Aeropuerto> }

/**
 * Entrada del índice: [tipo, id, país ISO, población?, propio?]. t: p=país, c=ciudad, r=región, a=aeropuerto.
 * La población (solo ciudades) permite ordenar las coincidencias sin abrir ninguna ficha.
 * El quinto elemento vale 1 cuando la clave que la contiene es un NOMBRE PROPIO de la entidad (su nombre, su nombre ASCII, un
 * nombre editorial/curado o su código IATA) y falta cuando es un alias (traducción, transliteración, nombre histórico…).
 * Se calcula al construir el índice, de modo que la búsqueda ordena por relevancia sin abrir fichas.
 */
export type TipoIndice = 'p' | 'c' | 'r' | 'a';
export type EntradaIndice =
  | [TipoIndice, string, string]
  | [TipoIndice, string, string, number]
  | [TipoIndice, string, string, number, 1];
export interface Indice { v: 1; nombres: Record<string, EntradaIndice[]> }

export interface Region {
  id: string; nombre: string; pais: string; nombres: string[];
  /** Centro aproximado (editorial) para calcular distancias en línea recta. */
  centro: { lat: number; lon: number };
  /** Aeropuertos de acceso razonables (IATA, editorial; se validan contra el catálogo). */
  aeropuertosAcceso: string[];
  descripcion: string;
}

export interface Destacados {
  /** Selección editorial de ciudades por país (nombre + motivo), prevalece sobre la fórmula. */
  paises: Record<string, { ciudades: string[]; motivo: string }>;
  /** Para nombres repetidos en el mundo, el país preferido (editorial). Si no hay entrada, se pregunta. */
  preferidos: Record<string, string>;
  /** Aeropuertos de acceso editoriales para destinos sin aeropuerto propio (IATA). */
  acceso: Record<string, string[]>;
}

export interface Identidad {
  tipo: TipoEntidad; id: string; nombre: string; pais: string | null;
  lat?: number; lon?: number; aeropuertos?: string[];
}

export type ResultadoResolucion =
  | { estado: 'reconocido'; origen: 'catalogo' | 'respaldo'; identidad: Identidad }
  | { estado: 'aclaracion'; candidatos: Identidad[]; motivo: string }
  | { estado: 'no_encontrado' }
  | { estado: 'error_geocodificador'; error: string };

export interface AeropuertoAcceso { iata: string; nombre: string; distanciaKm: number; esAcceso: true }

/** Ciudad curada a la que apunta un nombre repetido (derivada de las equivalencias editoriales de ciudades.ts). */
export interface PreferidoCatalogo { pais: string; id: string }
