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

/** Destino editorial de una isla o zona turística sin aeropuerto/ciudad propia con ese nombre en el catálogo. */
function zona(id: string, nombre: string, nombres: string[], pais: string, paisNombre: string, region: string, claves: string[],
  centro: DestinoEditorial['centro'], aeropuertos: string[], motivo: string): DestinoEditorial {
  return { id: `ed:${id}`, nombre, nombres, pais, paisNombre, region, claves, centro, aeropuertos, motivo };
}

/**
 * Islas y zonas turísticas que GeoNames no tiene como localidad (o que se conocen por el nombre de la isla, no el de su capital).
 * Los aeropuertos son los de acceso habituales (IATA); se validan contra el catálogo en los tests.
 */
const ZONAS: DestinoEditorial[] = [
  zona('menorca', 'Menorca', ['menorca', 'minorca'], 'ES', 'España', 'Islas Baleares', ['baleares', 'islas baleares', 'balears'], { lat: 39.95, lon: 4.1, radioKm: 30 }, ['MAH'], 'Isla de las Baleares; su aeropuerto es Menorca (Mahón).'),
  zona('mallorca', 'Mallorca', ['mallorca', 'majorca'], 'ES', 'España', 'Islas Baleares', ['baleares', 'islas baleares', 'balears'], { lat: 39.65, lon: 2.95, radioKm: 55 }, ['PMI'], 'Isla de las Baleares; su aeropuerto es Palma de Mallorca.'),
  zona('gran-canaria', 'Gran Canaria', ['gran canaria'], 'ES', 'España', 'Canarias', ['canarias', 'islas canarias'], { lat: 28.1, lon: -15.43, radioKm: 40 }, ['LPA'], 'Isla de Canarias; su aeropuerto es Las Palmas.'),
  zona('lanzarote', 'Lanzarote', ['lanzarote'], 'ES', 'España', 'Canarias', ['canarias', 'islas canarias'], { lat: 29.04, lon: -13.63, radioKm: 35 }, ['ACE'], 'Isla de Canarias; su aeropuerto es Arrecife.'),
  zona('fuerteventura', 'Fuerteventura', ['fuerteventura'], 'ES', 'España', 'Canarias', ['canarias', 'islas canarias'], { lat: 28.36, lon: -14.05, radioKm: 60 }, ['FUE'], 'Isla de Canarias; su aeropuerto es Fuerteventura.'),
  zona('madeira', 'Madeira', ['madeira'], 'PT', 'Portugal', 'Madeira', ['funchal'], { lat: 32.75, lon: -16.97, radioKm: 40 }, ['FNC'], 'Isla de Madeira; aeropuerto de Funchal.'),
  zona('algarve', 'Algarve', ['algarve'], 'PT', 'Portugal', 'Algarve', ['faro'], { lat: 37.15, lon: -8.2, radioKm: 60 }, ['FAO'], 'Costa sur de Portugal; aeropuerto de Faro.'),
  zona('azores', 'Azores', ['azores', 'acores'], 'PT', 'Portugal', 'Azores', ['sao miguel', 'ponta delgada'], { lat: 37.78, lon: -25.5, radioKm: 40 }, ['PDL'], 'Archipiélago; acceso por Ponta Delgada (São Miguel).'),
  zona('santorini', 'Santorini', ['santorini', 'thira', 'santorin'], 'GR', 'Grecia', 'Cícladas', ['cicladas', 'cyclades'], { lat: 36.4, lon: 25.45, radioKm: 15 }, ['JTR'], 'Isla de las Cícladas; aeropuerto de Santorini (Thira).'),
  zona('creta', 'Creta', ['creta', 'crete', 'kriti'], 'GR', 'Grecia', 'Creta', ['heraklion', 'iraklio', 'chania', 'la canea'], { lat: 35.25, lon: 24.9, radioKm: 100 }, ['HER', 'CHQ'], 'Isla griega; aeropuertos de Heraklion y La Canea.'),
  zona('sicilia', 'Sicilia', ['sicilia', 'sicily', 'sicilia italia'], 'IT', 'Italia', 'Sicilia', ['palermo', 'catania'], { lat: 37.6, lon: 14.0, radioKm: 130 }, ['PMO', 'CTA'], 'Isla italiana; aeropuertos de Palermo y Catania.'),
  zona('cerdena', 'Cerdeña', ['cerdena', 'sardinia', 'sardegna'], 'IT', 'Italia', 'Cerdeña', ['cagliari', 'olbia', 'alghero'], { lat: 40.1, lon: 9.0, radioKm: 120 }, ['CAG', 'OLB', 'AHO'], 'Isla italiana; aeropuertos de Cagliari, Olbia y Alghero.'),
  zona('corcega', 'Córcega', ['corcega', 'corsica', 'corse'], 'FR', 'Francia', 'Córcega', ['ajaccio', 'bastia'], { lat: 42.15, lon: 9.1, radioKm: 90 }, ['AJA', 'BIA'], 'Isla francesa; aeropuertos de Ajaccio y Bastia.'),
  zona('positano', 'Positano', ['positano'], 'IT', 'Italia', 'Campania', ['amalfi', 'costa amalfitana', 'salerno'], { lat: 40.63, lon: 14.48, radioKm: 12 }, ['NAP'], 'Pueblo de la Costa Amalfitana sin aeropuerto; el acceso habitual es Nápoles.'),
  zona('dolomitas', 'Dolomitas', ['dolomitas', 'dolomites', 'dolomiti'], 'IT', 'Italia', 'Trentino-Alto Adigio', ['trentino', 'alto adigio', 'sudtirol', 'bolzano'], { lat: 46.4, lon: 11.85, radioKm: 60 }, ['VRN', 'VCE'], 'Macizo alpino sin aeropuerto propio; accesos habituales por Verona y Venecia.'),
  zona('bali', 'Bali', ['bali'], 'ID', 'Indonesia', 'Bali', ['denpasar', 'ubud', 'kuta'], { lat: -8.4, lon: 115.19, radioKm: 60 }, ['DPS'], 'Isla indonesia; aeropuerto de Denpasar (Ngurah Rai).'),
  zona('isla-de-pascua', 'Isla de Pascua', ['isla de pascua', 'easter island', 'rapa nui'], 'CL', 'Chile', 'Valparaíso', ['rapa nui'], { lat: -27.11, lon: -109.37, radioKm: 20 }, ['IPC'], 'Isla chilena en el Pacífico; aeropuerto Mataveri.'),
];
for (const z of ZONAS) DESTINOS_EDITORIALES[z.id] = z;

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
  // Valencia de España antes que la de Venezuela (más poblada): es el destino turístico habitual; la otra sigue en la lista.
  valencia: ['gn:2509954', 'gn:3625549'],
};
