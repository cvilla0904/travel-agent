/**
 * Construcción del catálogo a partir de archivos de GeoNames y OurAirports (se ejecuta en desarrollo, no en Vercel).
 * Funciones puras y probadas con fragmentos reales en formato original; el script
 * scripts/construir-catalogo-geo.ts solo lee/escribe archivos.
 *
 * Formatos (documentación de cada fuente):
 *  - cities1000.txt (GeoNames, TSV 19 columnas): id, name, asciiname, alternatenames, lat, lon, fclass, fcode, país, cc2,
 *    admin1, admin2, admin3, admin4, población, elevación, dem, zona horaria, modificación.
 *  - countryInfo.txt (TSV; líneas «#» son comentarios): ISO, ISO3, num, fips, país, capital, área, población, continente,
 *    tld, moneda, nombre moneda, teléfono, formato postal, regex postal, idiomas, geonameid, vecinos, fips equivalente.
 *  - alternateNamesV2.txt (opcional): id, geonameid, idioma, nombre, preferido, corto, coloquial, histórico, desde, hasta.
 *  - airports.csv (OurAirports): id, ident, type, name, latitude_deg, longitude_deg, elevation_ft, continent, iso_country,
 *    iso_region, municipality, scheduled_service, icao_code, iata_code, gps_code, local_code, …
 */
import { distanciaKm, normalizar } from './normalizar.js';
import type { Aeropuerto, Ciudad, EntradaIndice, Indice, Pais, Region, ShardPais } from './tipos.js';

export const RADIO_AEROPUERTO_KM = 80;
export const MAX_NOMBRES_CIUDAD = 20;

const NOMBRE_VALIDO = /^[\p{L}\p{M}\p{N}\s'’. \-]+$/u;

export interface EntradaGeoNames { id: string; nombre: string; ascii: string; alternos: string[]; lat: number; lon: number; pais: string; admin1: string; poblacion: number }

export function parsearGeoNames(texto: string): EntradaGeoNames[] {
  const out: EntradaGeoNames[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const c = linea.split('\t');
    if (c.length < 15) continue;
    const lat = Number(c[4]), lon = Number(c[5]), poblacion = Number(c[14]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ id: c[0]!, nombre: c[1]!, ascii: c[2]!, alternos: (c[3] ?? '').split(',').filter(Boolean), lat, lon, pais: c[8]!, admin1: c[10] ?? '', poblacion: Number.isFinite(poblacion) ? poblacion : 0 });
  }
  return out;
}

export interface InfoPais { iso: string; nombre: string; geonameid: string; idiomas: string[] }
export function parsearCountryInfo(texto: string): InfoPais[] {
  const out: InfoPais[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea || linea.startsWith('#')) continue;
    const c = linea.split('\t');
    if (c.length < 17) continue;
    out.push({ iso: c[0]!, nombre: c[4]!, geonameid: c[16] ?? '', idiomas: (c[15] ?? '').split(',').map((s) => s.split('-')[0]!.trim()).filter(Boolean) });
  }
  return out;
}

/** geonameid → nombres en los idiomas indicados (es, en y los del país), sin históricos. */
export function parsearNombresAlternos(texto: string, idiomasPorGeoid: (geoid: string) => Set<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea) continue;
    const c = linea.split('\t');
    if (c.length < 8 || c[7] === '1') continue;
    const permitidos = idiomasPorGeoid(c[1]!);
    if (!permitidos.has(c[2]!)) continue;
    const l = out.get(c[1]!) ?? []; l.push(c[3]!); out.set(c[1]!, l);
  }
  return out;
}

/** CSV con campos entrecomillados (OurAirports). */
export function parsearCsv(texto: string): Array<Record<string, string>> {
  const filas: string[][] = [];
  let campo = '', fila: string[] = [], q = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]!;
    if (q) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.length > 1 || fila[0] !== '') filas.push(fila); fila = []; }
    else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const [cab, ...resto] = filas;
  if (!cab) return [];
  return resto.map((f) => Object.fromEntries(cab.map((k, i) => [k, f[i] ?? ''])));
}

/** Aeropuertos comerciales: grandes o medianos, con servicio regular, IATA válido y no cerrados. */
export function aeropuertosComerciales(filas: Array<Record<string, string>>): Omit<Aeropuerto, 'ciudadId'>[] {
  const out: Omit<Aeropuerto, 'ciudadId'>[] = [];
  for (const f of filas) {
    const tipo = f.type === 'large_airport' ? 'large' : f.type === 'medium_airport' ? 'medium' : null;
    const iata = (f.iata_code ?? '').trim().toUpperCase();
    const lat = Number(f.latitude_deg), lon = Number(f.longitude_deg);
    if (!tipo || f.scheduled_service !== 'yes' || !/^[A-Z]{3}$/.test(iata) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ iata, nombre: f.name ?? iata, pais: f.iso_country ?? '', lat, lon, tipo, municipio: f.municipality ?? '' });
  }
  return out;
}

/**
 * Asocia cada aeropuerto a UNA ciudad del mismo país dentro de 80 km, la que maximiza población / (1 + d/15 km)².
 * Así Medellín (2,5 M a ~28 km) gana a Rionegro (a ~8 km) y Düsseldorf a Colonia. Sin ciudad cercana, no se asocia.
 */
export function asociarAeropuertos(ciudades: EntradaGeoNames[], aeropuertos: Omit<Aeropuerto, 'ciudadId'>[]) {
  // Índice espacial por país y celdas de 1°: evita comparar cada aeropuerto con todas las ciudades.
  // La búsqueda amplía el rango longitudinal en latitudes altas y confirma siempre con Haversine.
  const porPais = new Map<string, Map<string, EntradaGeoNames[]>>();
  const celda = (lat: number, lon: number) => Math.floor(lat) + ':' + Math.floor(lon);
  for (const c of ciudades) {
    let rejilla = porPais.get(c.pais);
    if (!rejilla) { rejilla = new Map(); porPais.set(c.pais, rejilla); }
    const clave = celda(c.lat, c.lon);
    const lista = rejilla.get(clave) ?? [];
    lista.push(c);
    rejilla.set(clave, lista);
  }

  const asociados: Aeropuerto[] = [];
  const sinCiudad: string[] = [];
  for (const a of aeropuertos) {
    const rejilla = porPais.get(a.pais);
    if (!rejilla) { sinCiudad.push(a.iata); continue; }
    const rangoLat = RADIO_AEROPUERTO_KM / 110.5;
    const cosLat = Math.max(Math.cos((a.lat * Math.PI) / 180), 0.01);
    const rangoLon = Math.min(180, RADIO_AEROPUERTO_KM / (111.32 * cosLat));
    const candidatos = new Set<EntradaGeoNames>();
    for (let latCell = Math.floor(a.lat - rangoLat); latCell <= Math.floor(a.lat + rangoLat); latCell++) {
      for (let lonCell = Math.floor(a.lon - rangoLon); lonCell <= Math.floor(a.lon + rangoLon); lonCell++) {
        const lonNormalizada = ((lonCell + 180) % 360 + 360) % 360 - 180;
        for (const c of rejilla.get(latCell + ':' + lonNormalizada) ?? []) candidatos.add(c);
      }
    }

    let mejor: EntradaGeoNames | null = null;
    let mejorP = -1;
    for (const c of candidatos) {
      const d = distanciaKm(c, a);
      if (d > RADIO_AEROPUERTO_KM) continue;
      const puntuacion = Math.max(c.poblacion, 1) / (1 + d / 15) ** 2;
      if (puntuacion > mejorP) { mejorP = puntuacion; mejor = c; }
    }
    if (mejor) asociados.push({ ...a, ciudadId: 'gn:' + mejor.id });
    else sinCiudad.push(a.iata);
  }
  return { asociados, sinCiudad };
}

export interface EntradaConstruccion {
  geonames: EntradaGeoNames[]; paises: InfoPais[]; aeropuertos: Omit<Aeropuerto, 'ciudadId'>[];
  /** Nombres de países y ciudades en español/otros idiomas, si se dispone de alternateNamesV2. */
  nombresAlternos?: Map<string, string[]>;
  /** Nombres de país curados (ISO → nombres), usados si faltan los alternos. */
  nombresPaisCurados?: Record<string, string[]>;
  regiones: Region[];
}

export interface CatalogoConstruido {
  indice: Indice; paises: Pais[]; shards: Record<string, ShardPais>; sinCiudad: string[];
}

export function construirCatalogo(e: EntradaConstruccion): CatalogoConstruido {
  const { asociados, sinCiudad } = asociarAeropuertos(e.geonames, e.aeropuertos);
  const shards: Record<string, ShardPais> = {};
  const nombres: Record<string, EntradaIndice[]> = {};
  const poner = (nombre: string, ent: EntradaIndice) => {
    const k = normalizar(nombre);
    if (!k) return;
    const l = nombres[k] ?? (nombres[k] = []);
    if (!l.some((x) => x[0] === ent[0] && x[1] === ent[1])) l.push(ent);
  };

  const paisesOut: Pais[] = e.paises.map((p) => {
    const extra = [...(e.nombresAlternos?.get(p.geonameid) ?? []), ...(e.nombresPaisCurados?.[p.iso] ?? [])];
    const todos = [...new Set([p.nombre, ...extra].filter((n) => NOMBRE_VALIDO.test(n)))];
    const nombre = e.nombresPaisCurados?.[p.iso]?.[0] ?? p.nombre;
    todos.forEach((n) => poner(n, ['p', `pais:${p.iso}`, p.iso]));
    return { iso: p.iso, nombre, nombres: todos.map(normalizar) };
  });

  for (const c of e.geonames) {
    const iso = c.pais;
    const shard = shards[iso] ?? (shards[iso] = { iso, ciudades: {}, aeropuertos: {} });
    const alternos = [c.ascii, ...c.alternos, ...(e.nombresAlternos?.get(c.id) ?? [])]
      .filter((n) => n && n.length <= 40 && NOMBRE_VALIDO.test(n));
    const unicos = [...new Set(alternos.map(normalizar).filter((n) => n && n !== normalizar(c.nombre)))].slice(0, MAX_NOMBRES_CIUDAD);
    const id = `gn:${c.id}`;
    const ciudad: Ciudad = { id, nombre: c.nombre, nombreAscii: c.ascii, pais: iso, poblacion: c.poblacion, lat: c.lat, lon: c.lon, nombres: unicos, aeropuertos: [] };
    if (c.admin1) ciudad.admin1 = c.admin1;
    shard.ciudades[id] = ciudad;
    poner(c.nombre, ['c', id, iso, c.poblacion]);
    unicos.forEach((n) => poner(n, ['c', id, iso, c.poblacion]));
  }

  for (const a of asociados) {
    const shard = shards[a.pais] ?? (shards[a.pais] = { iso: a.pais, ciudades: {}, aeropuertos: {} });
    shard.aeropuertos[a.iata] = a;
    const c = a.ciudadId ? shard.ciudades[a.ciudadId] : undefined;
    if (c && !c.aeropuertos.includes(a.iata)) c.aeropuertos.push(a.iata);
    poner(a.iata, ['a', a.iata, a.pais]);
  }

  for (const r of e.regiones) { [r.nombre, ...r.nombres].forEach((n) => poner(n, ['r', r.id, r.pais])); }
  return { indice: { v: 1, nombres }, paises: paisesOut, shards, sinCiudad };
}
