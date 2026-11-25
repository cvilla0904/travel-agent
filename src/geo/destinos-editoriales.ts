/**
 * Destinos turísticos que el catálogo (GeoNames) no tiene como entidad propia y Mogavel cura a mano.
 * Son resultados COMPLEMENTARIOS del autocompletado: se mezclan con los del catálogo en buscarDestinos() y llevan un
 * identificador editorial estable («ed:…», nunca un «gn:» inventado), país, región y centro propios. Así lo que elige la
 * persona en el desplegable es exactamente lo que recibe el backend, sin regenerar los datos del catálogo.
 *
 * Fuente única: la tabla curada de ciudades.ts (centro, radio y regiones de «Salento, Italia») se construye desde aquí,
 * de modo que autocompletado, resolución de destino y validación de ubicación de hoteles no pueden discrepar.
 */
export interface DestinoEditorial {
  /** Identificador estable y único: «ed:<slug>». */
  id: string;
  /** Nombre que se muestra (el mismo que el de sus homónimos: la región y el país los distinguen). */
  nombre: string;
  /** Nombres normalizados (sin acentos, minúsculas) con los que se encuentra al escribir. */
  nombres: string[];
  /** País ISO-2 en mayúsculas y su nombre en español. */
  pais: string;
  paisNombre: string;
  /** Región que se muestra y se envía a los proveedores. */
  region: string;
  /** Regiones, provincias o zonas (normalizadas) que lo identifican al escribirlas tras el nombre: «Salento, Lecce». */
  claves: string[];
  /** Centro representativo de la ZONA y radio (km) dentro del cual se acepta un alojamiento sin que la dirección nombre el destino. */
  centro: { lat: number; lon: number; radioKm: number };
  /** Aeropuertos de acceso (IATA) editoriales: el destino no tiene aeropuerto propio. */
  aeropuertos: string[];
  motivo: string;
}

export const SALENTO_APULIA = 'ed:salento-apulia';

export const DESTINOS_EDITORIALES: Record<string, DestinoEditorial> = {
  [SALENTO_APULIA]: {
    id: SALENTO_APULIA,
    nombre: 'Salento',
    nombres: ['salento'],
    pais: 'IT',
    paisNombre: 'Italia',
    region: 'Apulia',
    claves: ['lecce', 'provincia di lecce', 'provincia de lecce', 'puglia', 'apulia', 'pulla'],
    // Entre Lecce, Otranto y Gallipoli (a 12, 27 y 28 km del centro); el municipio de Campania queda a 255 km.
    centro: { lat: 40.25, lon: 18.2, radioKm: 30 },
    aeropuertos: ['BDS'],
    motivo: 'Salento es la península de Lecce (Apulia). El único «Salento» del catálogo en Italia es un municipio de Campania de 760 habitantes.',
  },
};

export function destinoEditorial(id: string): DestinoEditorial | undefined {
  return DESTINOS_EDITORIALES[id];
}

/**
 * Orden editorial entre homónimos que comparten nombre exacto (ids, de primero a último). Sin esto mandaría la población
 * de un municipio de 760 habitantes sobre una zona turística. Coincide con la preferencia de la tabla curada de ciudades.ts:
 * «Salento» a secas es Quindío; después Apulia; después el municipio de Campania.
 */
export const ORDEN_HOMONIMOS: Record<string, string[]> = {
  salento: ['gn:3670352', SALENTO_APULIA, 'gn:3168676'],
};
