/**
 * Región administrativa de ciudades de nombre repetido que Mogavel cura a mano.
 * El catálogo (GeoNames) solo trae un código admin1 numérico, sin nombre, así que la región legible de una ciudad
 * concreta se declara aquí (id de ciudad → nombre y claves normalizadas aceptadas al escribirla). Se usa para:
 *  - entender consultas como «Salento, Quindío» (la región prioriza la ciudad que la declara) y
 *  - mostrar y conservar la región en los resultados («Salento, Quindío, Colombia»).
 * No es un nomenclátor completo: una ciudad sin entrada simplemente no tiene región conocida.
 */
import { DESTINOS_EDITORIALES } from './destinos-editoriales.js';

/**
 * `nombre` es la región; `ciudad`, `pais` (ISO-2 en mayúsculas) y `paisNombre` identifican la ciudad a la que pertenece. Así un
 * identificador editorial implica TAMBIÉN su nombre y su país: el servidor puede imponerlos y rechazar combinaciones
 * contradictorias («gn:3168676» —Campania— con país Colombia).
 */
export interface RegionEditorial { nombre: string; claves: string[]; ciudad: string; pais: string; paisNombre: string }

export const REGIONES_EDITORIALES: Record<string, RegionEditorial> = {
  'gn:3670352': { nombre: 'Quindío', claves: ['quindio', 'departamento del quindio'], ciudad: 'Salento', pais: 'CO', paisNombre: 'Colombia' },          // Salento (Colombia)
  'gn:3687238': { nombre: 'Bolívar', claves: ['bolivar', 'departamento de bolivar'], ciudad: 'Cartagena', pais: 'CO', paisNombre: 'Colombia' },            // Cartagena de Indias (Colombia)
  'gn:3168676': { nombre: 'Campania', claves: ['campania', 'provincia di salerno', 'salerno'], ciudad: 'Salento', pais: 'IT', paisNombre: 'Italia' },     // Salento (Italia, municipio de Campania)
  'gn:2520058': { nombre: 'Región de Murcia', claves: ['murcia', 'region de murcia'], ciudad: 'Cartagena', pais: 'ES', paisNombre: 'España' },           // Cartagena (España)
};

export function regionEditorial(id: string): RegionEditorial | undefined {
  const destino = DESTINOS_EDITORIALES[id];
  return REGIONES_EDITORIALES[id] ?? (destino ? { nombre: destino.region, claves: destino.claves, ciudad: destino.nombre, pais: destino.pais, paisNombre: destino.paisNombre } : undefined);
}

/** Todas las regiones editoriales (curadas a mano y derivadas de los destinos editoriales), con el id de su ciudad. */
export function todasRegionesEditoriales(): Array<[string, RegionEditorial]> {
  const ids = new Set([...Object.keys(REGIONES_EDITORIALES), ...Object.keys(DESTINOS_EDITORIALES)]);
  return [...ids].map((id) => [id, regionEditorial(id)!] as [string, RegionEditorial]);
}
