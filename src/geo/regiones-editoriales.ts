/**
 * Región administrativa de ciudades de nombre repetido que Mogavel cura a mano.
 * El catálogo (GeoNames) solo trae un código admin1 numérico, sin nombre, así que la región legible de una ciudad
 * concreta se declara aquí (id de ciudad → nombre y claves normalizadas aceptadas al escribirla). Se usa para:
 *  - entender consultas como «Salento, Quindío» (la región prioriza la ciudad que la declara) y
 *  - mostrar y conservar la región en los resultados («Salento, Quindío, Colombia»).
 * No es un nomenclátor completo: una ciudad sin entrada simplemente no tiene región conocida.
 */
export interface RegionEditorial { nombre: string; claves: string[] }

export const REGIONES_EDITORIALES: Record<string, RegionEditorial> = {
  'gn:3670352': { nombre: 'Quindío', claves: ['quindio', 'departamento del quindio'] },          // Salento (Colombia)
  'gn:3687238': { nombre: 'Bolívar', claves: ['bolivar', 'departamento de bolivar'] },            // Cartagena de Indias (Colombia)
  'gn:3168676': { nombre: 'Campania', claves: ['campania', 'provincia di salerno', 'salerno'] },     // Salento (Italia, municipio de Campania)
  'gn:2520058': { nombre: 'Región de Murcia', claves: ['murcia', 'region de murcia'] },           // Cartagena (España)
};

export function regionEditorial(id: string): RegionEditorial | undefined {
  return REGIONES_EDITORIALES[id];
}
