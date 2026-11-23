/** Normaliza un nombre: sin acentos, minúsculas, solo letras/números/espacios. */
export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Distancia en línea recta (km), fórmula de Haversine. No es distancia por carretera. */
export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
