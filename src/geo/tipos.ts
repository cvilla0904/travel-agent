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
  /** IATA de los aeropuertos comerciales asociados a esta ciudad. */
  aeropuertos: string[];
}

export interface ShardPais { iso: string; ciudades: Record<string, Ciudad>; aeropuertos: Record<string, Aeropuerto> }

/** Entrada del índice: [tipo, id, país ISO]. t: p=país, c=ciudad, r=región, a=aeropuerto. */
export type EntradaIndice = ['p' | 'c' | 'r' | 'a', string, string];
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
