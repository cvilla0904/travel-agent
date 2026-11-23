import type { Identidad, EntradaIndice, Pais, Region } from '../src/geo/tipos.js';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { normalizar } from '../src/geo/normalizar.js';

type GeoResult = {
  id: string;
  tipo: Identidad['tipo'];
  nombre: string;
  codigoPais: string | null;
  nombrePais: string | null;
  latitud?: number;
  longitud?: number;
  aeropuertos?: string[];
  coincidencia: 'exacta' | 'prefijo';
};

let catalogo: Catalogo | undefined;

function getCatalogo(): Catalogo {
  return (catalogo ??= new Catalogo(fuenteEnDisco()));
}

function identidadDesdeEntrada(cat: Catalogo, entrada: EntradaIndice): Identidad | undefined {
  const [tipo, id, iso] = entrada;
  if (tipo === 'p') {
    const p = cat.paises().find((item: Pais) => item.iso === iso);
    return p ? { tipo: 'pais', id, nombre: p.nombre, pais: iso } : undefined;
  }
  if (tipo === 'c') {
    const c = cat.ciudad(id, iso);
    return c ? { tipo: 'ciudad', id: c.id, nombre: c.nombre, pais: c.pais, lat: c.lat, lon: c.lon, aeropuertos: c.aeropuertos } : undefined;
  }
  if (tipo === 'a') {
    const a = cat.aeropuerto(id, iso);
    return a ? { tipo: 'aeropuerto', id: `iata:${a.iata}`, nombre: a.nombre, pais: a.pais, lat: a.lat, lon: a.lon, aeropuertos: [a.iata] } : undefined;
  }
  const r = cat.regiones().find((item: Region) => item.id === id);
  return r ? { tipo: 'region', id: r.id, nombre: r.nombre, pais: r.pais, lat: r.centro.lat, lon: r.centro.lon, aeropuertos: r.aeropuertosAcceso } : undefined;
}

function respuestaGeo(cat: Catalogo, identidad: Identidad, coincidencia: GeoResult['coincidencia']): GeoResult {
  const pais = identidad.pais ? cat.paises().find((p: Pais) => p.iso === identidad.pais) : undefined;
  return {
    id: identidad.id,
    tipo: identidad.tipo,
    nombre: identidad.nombre,
    codigoPais: identidad.pais,
    nombrePais: pais?.nombre ?? null,
    ...(typeof identidad.lat === 'number' ? { latitud: identidad.lat } : {}),
    ...(typeof identidad.lon === 'number' ? { longitud: identidad.lon } : {}),
    ...(identidad.aeropuertos?.length ? { aeropuertos: identidad.aeropuertos } : {}),
    coincidencia,
  };
}

export default function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
  const clave = normalizar(q);
  if (clave.length < 2 || clave.length > 100) {
    return res.status(400).json({ ok: false, error: 'El parámetro q debe contener entre 2 y 100 caracteres.' });
  }

  const pais = typeof req.query?.pais === 'string' && /^[a-z]{2}$/i.test(req.query.pais)
    ? req.query.pais.toUpperCase()
    : undefined;
  const limiteSolicitado = Number(req.query?.limite ?? 8);
  const limite = Number.isInteger(limiteSolicitado) ? Math.min(12, Math.max(1, limiteSolicitado)) : 8;

  try {
    const cat = getCatalogo();
    const nombres = cat.indice().nombres;
    const claves = Object.keys(nombres)
      .filter((nombre) => nombre === clave || nombre.startsWith(clave))
      .sort((a, b) => (a === clave ? -1 : b === clave ? 1 : a.localeCompare(b, 'es')));

    const vistos = new Set<string>();
    const resultados: GeoResult[] = [];
    for (const nombre of claves) {
      const coincidencia = nombre === clave ? 'exacta' : 'prefijo';
      for (const entrada of nombres[nombre] ?? []) {
        const identidad = identidadDesdeEntrada(cat, entrada);
        if (!identidad || (pais && identidad.pais !== pais) || vistos.has(identidad.id)) continue;
        vistos.add(identidad.id);
        resultados.push(respuestaGeo(cat, identidad, coincidencia));
        if (resultados.length >= limite) break;
      }
      if (resultados.length >= limite) break;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      ok: true,
      consulta: q,
      pais: pais ?? null,
      total: resultados.length,
      resultados,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    const noDisponible = /catálogo geográfico no está generado/i.test(mensaje);
    console.error('[api/geo]', mensaje);
    return res.status(noDisponible ? 503 : 500).json({
      ok: false,
      codigo: noDisponible ? 'CATALOGO_NO_GENERADO' : 'ERROR_CATALOGO',
      error: noDisponible
        ? 'El catálogo geográfico todavía no está generado. Ejecuta el proceso de construcción de datos.'
        : 'No se pudo consultar el catálogo geográfico.',
    });
  }
}
