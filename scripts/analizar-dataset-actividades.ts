/**
 * Analiza OFFLINE un dataset de actividades ya descargado (no llama a Apify ni consume créditos).
 *
 *   npx tsx scripts/analizar-dataset-actividades.ts Bruselas dataset-bruselas.json
 *
 * El JSON se obtiene leyendo un dataset existente (no lanza ninguna ejecución):
 *   curl "https://api.apify.com/v2/datasets/<DATASET_ID>/items?token=<TOKEN>&limit=50" > dataset-bruselas.json
 * Imprime, por registro, los campos geográficos originales y el veredicto del filtro con su motivo.
 */
import { readFileSync } from 'node:fs';
import { evaluarUbicacionActividad, analizarDataset } from '../src/services/actividades-ciudad.ts';

const [destino, archivo] = process.argv.slice(2);
if (!destino || !archivo) { console.error('Uso: tsx scripts/analizar-dataset-actividades.ts <destino> <dataset.json>'); process.exit(1); }
const items: any[] = JSON.parse(readFileSync(archivo, 'utf8'));
const campos = (a: any) => ({
  title: a?.title, platform: a?.platform, city: a?.city, country: a?.country,
  latitude: a?.latitude, longitude: a?.longitude, pointOfInterest: a?.pointOfInterest,
  searchQuery: a?.searchQuery, sourceUrl: a?.sourceUrl, url: a?.url,
});
items.forEach((a, i) => console.log(i + 1, JSON.stringify({ ...campos(a), veredicto: evaluarUbicacionActividad(a, destino) })));
console.log('RESUMEN:', JSON.stringify(analizarDataset(items, destino), null, 2));
