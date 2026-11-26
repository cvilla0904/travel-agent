// Reduce un catálogo geográfico COMPLETO (formato v3, p. ej. el generado por «npm run geo:preparar») a los destinos de Mogavel.
// Es una transformación reproducible: mismo origen + mismos criterios (src/geo/data/seleccion-destinos.json) = mismo resultado.
//
// Uso: node scripts/seleccionar-catalogo-geo.ts <catalogo-completo> <carpeta-destino> [--informe informe.json]
//
// Criterios (ver docs/CATALOGO-DESTINOS.md):
//  1. Ciudades con aeropuerto comercial propio (large/medium de OurAirports con servicio regular).
//  2. Ciudades de 500.000 habitantes o más, la ciudad más poblada de cada país y las imprescindibles.
//  3. Ciudades curadas (grupos de ciudades.ts, preferidos, homónimos editoriales, correcciones de asociación).
//  Se descartan distritos y duplicados (misma ciudad con otro nombre a < 20 km): se fusionan en la ciudad principal.
//  Cada aeropuerto se asocia a UNA ciudad (por municipio y distancia) y cada ciudad conserva como máximo 3 aeropuertos.
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { escribirCatalogo, leerIndiceCompleto, verificarIntegridad } from '../src/geo/empaquetar.ts';
import { distanciaKm, normalizar } from '../src/geo/normalizar.ts';
import { asociarCuradas, nombresDeAeropuerto } from '../src/geo/construir.ts';
import { CIUDADES_EQUIVALENTES } from '../src/services/ciudades.ts';
import { ORDEN_HOMONIMOS, DESTINOS_EDITORIALES } from '../src/geo/destinos-editoriales.ts';
import type { Aeropuerto, Ciudad, EntradaIndice, Indice, PreferidoCatalogo, ShardPais } from '../src/geo/tipos.ts';

const [origen, destino] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const iInforme = process.argv.indexOf('--informe');
const rutaInforme = iInforme > 0 ? process.argv[iInforme + 1] : undefined;
if (!origen || !destino) { console.error('Uso: node scripts/seleccionar-catalogo-geo.ts <catalogo-completo> <carpeta-destino> [--informe f.json]'); process.exit(1); }

const dirDatos = path.join(import.meta.dirname, '../src/geo/data');
interface Seleccion {
  nombresEs: Record<string, string[]>;
  maxAeropuertosPorCiudad: number; poblacionMinima: number;
  codigosCiudad: Record<string, string>; aeropuertosPrincipales: Record<string, string[]>; imprescindibles: string[];
}
const sel = JSON.parse(fs.readFileSync(path.join(dirDatos, 'seleccion-destinos.json'), 'utf8')) as Seleccion;
const correcciones = JSON.parse(fs.readFileSync(path.join(dirDatos, 'correcciones-asociacion.json'), 'utf8')) as { pines: Record<string, string> };

const cat = new Catalogo(fuenteEnDisco(origen, dirDatos));
const paises = cat.paises();
const shards: Record<string, ShardPais> = {};
for (const p of paises) { const s = cat.shard(p.iso); if (s) shards[p.iso] = s; }
const indiceOrigen = leerIndiceCompleto(origen);
const preferidosOrigen = JSON.parse(fs.readFileSync(path.join(origen, 'preferidos.json'), 'utf8')) as Record<string, PreferidoCatalogo>;

const porId = new Map<string, Ciudad>();
for (const s of Object.values(shards)) for (const c of Object.values(s.ciudades)) porId.set(c.id, c);
const aeropuertosOrigen = Object.values(shards).flatMap((s) => Object.values(s.aeropuertos));

/** Nombre normalizado de cada ciudad (se calcula una sola vez: normalizar es costoso). */
const nombreNorm = new Map<string, { n: string; a: string }>();
for (const c of porId.values()) nombreNorm.set(c.id, { n: normalizar(c.nombre), a: normalizar(c.nombreAscii ?? c.nombre) });
const memoCiudad = new Map<string, Ciudad | undefined>();
/** «nombre|ISO» → ciudad más poblada de ese país con ese nombre (nombre, ASCII o alternativo). */
function buscarCiudad(ref: string): Ciudad | undefined {
  if (memoCiudad.has(ref)) return memoCiudad.get(ref);
  const [nombre, iso] = ref.split('|');
  const n = normalizar(nombre);
  const s = shards[iso!];
  let r: Ciudad | undefined;
  if (s) {
    const todas = Object.values(s.ciudades);
    const exactas = todas.filter((c) => { const x = nombreNorm.get(c.id)!; return x.n === n || x.a === n; });
    const lista = exactas.length ? exactas : todas.filter((c) => c.nombres.includes(n));
    r = lista.sort((a, b) => b.poblacion - a.poblacion)[0];
  }
  memoCiudad.set(ref, r);
  return r;
}

/* ---------- 1. Asociación aeropuerto → ciudad ---------- */
function ciudadDeAeropuerto(a: Aeropuerto): Ciudad | undefined {
  const s = shards[a.pais];
  if (!s) return undefined;
  const ciudades = Object.values(s.ciudades);
  const municipio = normalizar(String(a.municipio ?? '').replace(/\(.*?\)/g, ''));
  // Caja envolvente barata (≈ 60 km) antes de calcular distancias exactas.
  const gr = 60 / 111;
  const cerca = ciudades.filter((c) => Math.abs(c.lat - a.lat) <= gr && Math.abs(c.lon - a.lon) <= gr / Math.max(0.2, Math.cos((a.lat * Math.PI) / 180)));
  const todas = cerca.map((c) => ({ c, d: distanciaKm(c, a) }));
  const dentro = (km: number) => todas.filter((x) => x.d <= km);
  const cerca60 = dentro(60);
  // 1) El municipio que declara el aeropuerto coincide con el nombre de una ciudad cercana.
  const puntuaGrande = (x: { c: Ciudad; d: number }) => x.c.poblacion / (1 + x.d / 15) ** 2;
  const metropoli = dentro(40).filter((x) => x.c.poblacion >= 100_000).sort((x, y) => puntuaGrande(y) - puntuaGrande(x))[0];
  if (municipio) {
    const porNombre = cerca60.filter(({ c }) => nombreNorm.get(c.id)!.n === municipio || nombreNorm.get(c.id)!.a === municipio || c.nombres.includes(municipio));
    const nombrada = porNombre.sort((x, y) => y.c.poblacion - x.c.poblacion)[0];
    // Un aeropuerto cuyo «municipio» es una localidad diminuta (Balice, Tocumen…) sirve a la gran ciudad que tiene al lado.
    // Idem si la localidad nombrada es mucho menor que una metrópoli a ≤ 25 km (Velika Gorica → Zagreb).
    const absorbida = metropoli && metropoli.d <= 25 && nombrada && nombrada.c.poblacion * 5 <= metropoli.c.poblacion;
    if (nombrada && !absorbida && (nombrada.c.poblacion >= 20_000 || !metropoli)) return nombrada.c;
    if (metropoli) return metropoli.c;
  }
  // 2) La ciudad (≥ 50.000 hab.) más relevante a ≤ 50 km: población penalizada por la distancia.
  const puntua = (x: { c: Ciudad; d: number }) => x.c.poblacion / (1 + x.d / 15) ** 2;
  const grandes = dentro(50).filter((x) => x.c.poblacion >= 50_000).sort((x, y) => puntua(y) - puntua(x));
  if (grandes.length) return grandes[0]!.c;
  // 3) Cualquier población a ≤ 25 km.
  const cercanas = dentro(25).sort((x, y) => puntua(y) - puntua(x));
  return cercanas[0]?.c;
}
const ciudadDe = new Map<string, string>(); // IATA → id de ciudad
const aeropuertoPorIata = new Map(aeropuertosOrigen.map((a) => [a.iata, a]));
for (const a of aeropuertosOrigen) { const c = ciudadDeAeropuerto(a); if (c) ciudadDe.set(a.iata, c.id); }

/* ---------- 2. Selección de ciudades ---------- */
const elegidas = new Set<string>();
const motivo = new Map<string, string>();
const elegir = (id: string | undefined, porque: string) => { if (id && porId.has(id) && !elegidas.has(id)) { elegidas.add(id); motivo.set(id, porque); } };
for (const id of ciudadDe.values()) elegir(id, 'aeropuerto');
for (const c of porId.values()) if (c.poblacion >= sel.poblacionMinima) elegir(c.id, 'población');
for (const s of Object.values(shards)) {
  const mayor = Object.values(s.ciudades).sort((a, b) => b.poblacion - a.poblacion)[0];
  elegir(mayor?.id, 'ciudad principal del país');
}
for (const ref of sel.imprescindibles) elegir(buscarCiudad(ref)?.id, 'imprescindible');
for (const p of Object.values(preferidosOrigen)) elegir(p.id, 'curada');
// Todas las ciudades de los grupos curados de ciudades.ts (también los homónimos: Cartagena de España, Salento de Campania…).
const todasParaCuradas = [...porId.values()].map((c) => ({ id: c.id, pais: c.pais, poblacion: c.poblacion, nombres: [c.nombre, c.nombreAscii ?? c.nombre, ...c.nombres] }));
const curadas = asociarCuradas(todasParaCuradas, CIUDADES_EQUIVALENTES);
for (const id of curadas.extraPorCiudad.keys()) elegir(id, 'curada');
for (const p of Object.values(curadas.preferidos)) elegir(p.id, 'curada');
for (const g of CIUDADES_EQUIVALENTES) for (const n of [g.consulta, ...g.nombres]) elegir(buscarCiudad(`${n}|${g.pais.toUpperCase()}`)?.id, 'curada');
for (const ids of Object.values(ORDEN_HOMONIMOS)) for (const id of ids) elegir(id, 'homónimo editorial');
for (const id of Object.values(correcciones.pines)) elegir(id, 'curada');
for (const ref of Object.keys(sel.aeropuertosPrincipales)) elegir(buscarCiudad(ref)?.id, 'aeropuerto principal');
// Las ciudades que identifican a un destino editorial al escribirse tras su nombre («Salento, Lecce») también se conservan.
for (const d of Object.values(DESTINOS_EDITORIALES)) for (const k of d.claves.filter((x) => normalizar(x) !== normalizar(d.nombre))) elegir(buscarCiudad(`${k}|${d.pais}`)?.id, 'clave de destino editorial');
// Ciudades destacadas por país (editorial).
for (const [iso, d] of Object.entries(cat.destacados().paises)) for (const nombre of d.ciudades) elegir(buscarCiudad(`${nombre}|${iso}`)?.id, 'destacada');

/* ---------- 3. Distritos y duplicados: se fusionan en la ciudad principal ---------- */
const fusion = new Map<string, string>(); // descartada → principal
const ordenadas = [...elegidas].map((id) => porId.get(id)!).sort((a, b) => b.poblacion - a.poblacion);
const principales: Ciudad[] = [];
const intocables = new Set<string>([...Object.values(preferidosOrigen).map((p) => p.id), ...Object.values(ORDEN_HOMONIMOS).flat(), ...Object.values(correcciones.pines)]);
for (const c of ordenadas) {
  const n = nombreNorm.get(c.id)!.a;
  const madre = intocables.has(c.id) ? undefined : principales.find((l) => {
    if (l.pais !== c.pais || distanciaKm(l, c) > 20) return false;
    const m = nombreNorm.get(l.id)!.a;
    return n === m || n.startsWith(`${m} `) || m.startsWith(`${n} `);
  });
  if (madre) fusion.set(c.id, madre.id); else principales.push(c);
}
for (const id of fusion.keys()) { elegidas.delete(id); motivo.delete(id); }
// Una localidad pequeña con el mismo nombre que un destino editorial (Positano, Santorini…) es el mismo destino: manda el editorial.
{
  const protegidas = new Set(Object.values(ORDEN_HOMONIMOS).flat());
  const editoriales = new Set(Object.values(DESTINOS_EDITORIALES).map((d) => `${normalizar(d.nombre)}|${d.pais}`));
  for (const id of [...elegidas]) {
    const c = porId.get(id)!;
    if (protegidas.has(id) || c.poblacion >= sel.poblacionMinima || ciudadDe.size === 0) continue;
    if (editoriales.has(`${normalizar(c.nombre)}|${c.pais}`) && ![...ciudadDe.values()].includes(id)) { elegidas.delete(id); motivo.delete(id); }
  }
}
const resolver = (id: string): string => fusion.get(id) ?? id;
for (const [iata, id] of ciudadDe) ciudadDe.set(iata, resolver(id));

/* ---------- 4. Aeropuertos por ciudad (máximo 3; los principales editoriales mandan) ---------- */
const porCiudad = new Map<string, string[]>();
for (const [iata, id] of ciudadDe) { if (!elegidas.has(id)) continue; (porCiudad.get(id) ?? porCiudad.set(id, []).get(id)!).push(iata); }
for (const [ref, lista] of Object.entries(sel.aeropuertosPrincipales)) {
  const c = buscarCiudad(ref);
  if (!c) continue;
  const id = resolver(c.id);
  const validos = lista.filter((i) => aeropuertoPorIata.has(i) && aeropuertoPorIata.get(i)!.pais === c.pais);
  // Los aeropuertos editoriales se quitan de cualquier otra ciudad y se asignan a esta, en el orden indicado.
  for (const i of validos) {
    for (const [otra, l] of porCiudad) if (otra !== id) porCiudad.set(otra, l.filter((x) => x !== i));
    ciudadDe.set(i, id);
  }
  porCiudad.set(id, validos);
  elegir(id, 'aeropuerto principal');
}
const orden = (a: string, b: string, c: Ciudad) => {
  const A = aeropuertoPorIata.get(a)!, B = aeropuertoPorIata.get(b)!;
  if (A.tipo !== B.tipo) return A.tipo === 'large' ? -1 : 1;
  return distanciaKm(c, A) - distanciaKm(c, B);
};
const idsEditoriales = new Set<string>();
for (const ref of Object.keys(sel.aeropuertosPrincipales)) { const c = buscarCiudad(ref); if (c) idsEditoriales.add(resolver(c.id)); }
const quitados: string[] = [];
for (const [id, lista] of porCiudad) {
  const c = porId.get(id)!;
  const editorial = idsEditoriales.has(id);
  const fin = editorial ? lista : [...lista].sort((a, b) => orden(a, b, c));
  // El principal es el primero; los secundarios solo se conservan si son grandes (o editoriales): sin pistas regionales.
  const utiles = editorial ? fin : fin.filter((iata, i) => i === 0 || aeropuertoPorIata.get(iata)!.tipo === 'large');
  porCiudad.set(id, utiles.slice(0, sel.maxAeropuertosPorCiudad));
  quitados.push(...fin.filter((i) => !utiles.slice(0, sel.maxAeropuertosPorCiudad).includes(i)));
}
const conservados = new Set<string>();
for (const l of porCiudad.values()) for (const i of l) conservados.add(i);
// Los aeropuertos grandes sin ciudad seleccionada se conservan como aeropuertos sueltos (se buscan por IATA o nombre).
for (const a of aeropuertosOrigen) if (a.tipo === 'large' && !conservados.has(a.iata) && !quitados.includes(a.iata)) conservados.add(a.iata);

/* ---------- 5. Códigos de ciudad ---------- */
const codigoDe = new Map<string, string>();
for (const [ref, codigo] of Object.entries(sel.codigosCiudad)) { const c = buscarCiudad(ref); if (c) codigoDe.set(resolver(c.id), codigo); }

/* ---------- 6. Escritura ---------- */
const nuevosShards: Record<string, ShardPais> = {};
for (const [iso, s] of Object.entries(shards)) {
  const ciudades: Record<string, Ciudad> = {};
  for (const c of Object.values(s.ciudades)) {
    if (!elegidas.has(c.id)) continue;
    const ficha: Ciudad = { ...c, aeropuertos: porCiudad.get(c.id) ?? [] };
    const codigo = codigoDe.get(c.id);
    if (codigo) ficha.codigoCiudad = codigo;
    // Nombres de las ciudades fusionadas (distritos y duplicados).
    ciudades[c.id] = ficha;
  }
  const aeropuertos: Record<string, Aeropuerto> = {};
  for (const a of Object.values(s.aeropuertos)) {
    if (!conservados.has(a.iata)) continue;
    const id = ciudadDe.get(a.iata);
    aeropuertos[a.iata] = { ...a, ciudadId: id && elegidas.has(id) && porCiudad.get(id)?.includes(a.iata) ? id : null };
  }
  if (Object.keys(ciudades).length || Object.keys(aeropuertos).length) nuevosShards[iso] = { iso, ciudades, aeropuertos };
}
const todasNuevas = new Map<string, Ciudad>();
for (const s of Object.values(nuevosShards)) for (const c of Object.values(s.ciudades)) todasNuevas.set(c.id, c);

const nombres: Indice['nombres'] = {};
const poner = (clave: string, e: EntradaIndice) => {
  const l = nombres[clave] ?? (nombres[clave] = []);
  const i = l.findIndex((x) => x[0] === e[0] && x[1] === e[1]);
  if (i < 0) l.push(e);
  else if (e.length === 5 && l[i]!.length !== 5) l[i] = e; // un nombre propio gana a un alias
};
for (const [clave, entradas] of Object.entries(indiceOrigen.nombres)) {
  for (const e of entradas) {
    if (e[0] === 'c') {
      const id = resolver(e[1]);
      const c = todasNuevas.get(id);
      if (!c) continue;
      // Un nombre de ciudad fusionada pasa a ser alias (no propio) de la principal.
      poner(clave, id === e[1] ? e : [e[0], id, c.pais, c.poblacion]);
    } else if (e[0] === 'a') {
      if (conservados.has(e[1])) poner(clave, e);
    } else poner(clave, e);
  }
}
for (const [id, codigo] of codigoDe) { const c = todasNuevas.get(id); if (c) poner(codigo.toLowerCase(), ['c', id, c.pais, c.poblacion, 1]); }
for (const [ref, alias] of Object.entries(sel.nombresEs)) {
  const c = buscarCiudad(ref);
  const id = c && resolver(c.id);
  const nueva = id ? todasNuevas.get(id) : undefined;
  if (nueva) for (const a of alias) poner(normalizar(a), ['c', nueva.id, nueva.pais, nueva.poblacion, 1]);
}
// Los aeropuertos también se localizan por su nombre («Brussels Airport»), no solo por su código IATA.
// Solo los de una ciudad del catálogo (alternativas útiles): los aeropuertos sueltos no se ofrecen al escribir.
for (const s of Object.values(nuevosShards)) {
  const deCiudad = new Set(Object.values(s.ciudades).flatMap((c) => c.aeropuertos));
  for (const a of Object.values(s.aeropuertos)) if (deCiudad.has(a.iata)) for (const n of nombresDeAeropuerto(a.nombre)) poner(n, ['a', a.iata, a.pais, 0, 1]);
}
const preferidos: Record<string, PreferidoCatalogo> = {};
for (const [k, p] of Object.entries(preferidosOrigen)) { const id = resolver(p.id); if (todasNuevas.has(id)) preferidos[k] = { ...p, id }; }

const meta = escribirCatalogo(destino, { indice: { v: 1, nombres }, paises, shards: nuevosShards, preferidos });
const problemas = verificarIntegridad(destino);
if (problemas.length) throw new Error(`Verificación fallida: ${problemas.join('; ')}`);

const porMotivo: Record<string, number> = {};
for (const m of motivo.values()) porMotivo[m] = (porMotivo[m] ?? 0) + 1;
const informe = {
  origen: { ciudades: porId.size, aeropuertos: aeropuertosOrigen.length },
  destino: { ciudades: meta.ciudades, aeropuertos: meta.aeropuertos, paises: meta.paises, claves: Object.keys(nombres).length },
  porMotivo, fusionadas: fusion.size, aeropuertosDescartadosPorLimite: quitados.length,
  codigosCiudad: [...codigoDe].map(([id, c]) => `${c}=${todasNuevas.get(id)?.nombre}`),
};
if (rutaInforme) fs.writeFileSync(rutaInforme, JSON.stringify(informe, null, 1));
console.log(JSON.stringify(informe, null, 1));
