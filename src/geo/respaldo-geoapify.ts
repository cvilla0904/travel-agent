import type { Identidad, ResultadoResolucion } from './tipos.js';

/**
 * Respaldo online (Geoapify Geocoding) para lo que el catálogo local no resuelve.
 * - Sin red ni clave NO se inventa nada: devuelve `error_geocodificador`, distinto de `no_encontrado`.
 * - El `fetch` es inyectable para probarlo sin llamar al servicio.
 * - Un destino resuelto aquí es `origen: 'respaldo'` y no tiene aeropuertos hasta resolverlos con el catálogo.
 */
export interface OpcionesRespaldo {
  apiKey?: string | undefined;
  fetchFn?: typeof fetch;
  /** Caché opcional (p. ej. Redis): clave → JSON. */
  cache?: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };
}

const TIPOS_ACEPTADOS = new Set(['city', 'locality', 'state', 'country']);

export async function resolverConGeoapify(texto: string, op: OpcionesRespaldo = {}): Promise<ResultadoResolucion> {
  const apiKey = op.apiKey ?? process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return { estado: 'error_geocodificador', error: 'GEOAPIFY_API_KEY no está configurada.' };
  const clave = `geo:geoapify:${texto.trim().toLowerCase()}`;
  try {
    const guardado = await op.cache?.get(clave);
    if (guardado) return JSON.parse(guardado) as ResultadoResolucion;

    const url = new URL('https://api.geoapify.com/v1/geocode/search');
    url.searchParams.set('text', texto);
    url.searchParams.set('limit', '5');
    url.searchParams.set('lang', 'es');
    url.searchParams.set('apiKey', apiKey);
    const resp = await (op.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return { estado: 'error_geocodificador', error: `Geoapify respondió ${resp.status}` };
    const datos = (await resp.json()) as { features?: Array<{ properties?: Record<string, any> }> };

    const candidatos: Identidad[] = [];
    for (const f of datos.features ?? []) {
      const p = f.properties ?? {};
      if (!TIPOS_ACEPTADOS.has(String(p.result_type)) || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const tipo = p.result_type === 'country' ? 'pais' : p.result_type === 'state' ? 'region' : 'ciudad';
      candidatos.push({
        tipo, id: `geoapify:${p.place_id ?? `${p.lat},${p.lon}`}`,
        nombre: String(p.city ?? p.state ?? p.country ?? p.name ?? texto),
        pais: p.country_code ? String(p.country_code).toUpperCase() : null, lat: p.lat, lon: p.lon,
      });
    }
    let resultado: ResultadoResolucion;
    if (candidatos.length === 0) resultado = { estado: 'no_encontrado' };
    else if (candidatos.length === 1) resultado = { estado: 'reconocido', origen: 'respaldo', identidad: candidatos[0]! };
    else resultado = { estado: 'aclaracion', candidatos, motivo: `«${texto}» puede referirse a varios lugares.` };
    await op.cache?.set(clave, JSON.stringify(resultado));
    return resultado;
  } catch (e) {
    return { estado: 'error_geocodificador', error: e instanceof Error ? e.message : 'Error desconocido' };
  }
}
