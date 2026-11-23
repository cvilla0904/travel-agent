import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { LONGITUD_MAX_CONSULTA, LONGITUD_MIN_CONSULTA, buscarDestinos } from '../src/geo/buscar.js';
import { normalizar } from '../src/geo/normalizar.js';

let catalogo: Catalogo | undefined;
const catalogoEnDisco = () => (catalogo ??= new Catalogo(fuenteEnDisco()));

/** Handler con catálogo inyectable (las pruebas usan uno propio; en producción se lee de src/geo/data/catalogo). */
export function crearHandler(obtener: () => Catalogo) {
  return function handler(req: any, res: any) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'Método no permitido.' });
    }

    const q = typeof req.query?.q === 'string' ? req.query.q.trim() : '';
    const clave = normalizar(q);
    if (clave.length < LONGITUD_MIN_CONSULTA || clave.length > LONGITUD_MAX_CONSULTA) {
      return res.status(400).json({ ok: false, error: `El parámetro q debe contener entre ${LONGITUD_MIN_CONSULTA} y ${LONGITUD_MAX_CONSULTA} caracteres.` });
    }

    const pais = typeof req.query?.pais === 'string' && /^[a-z]{2}$/i.test(req.query.pais) ? req.query.pais.toUpperCase() : undefined;
    const limiteSolicitado = Number(req.query?.limite ?? 8);
    const limite = Number.isInteger(limiteSolicitado) ? Math.min(12, Math.max(1, limiteSolicitado)) : 8;

    try {
      const resultados = buscarDestinos(obtener(), q, { ...(pais ? { pais } : {}), limite });
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).json({ ok: true, consulta: q, pais: pais ?? null, total: resultados.length, resultados });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      const noDisponible = error instanceof Error && error.name === 'CatalogoNoDisponible';
      console.error('[api/geo]', mensaje);
      return res.status(noDisponible ? 503 : 500).json({
        ok: false,
        codigo: noDisponible ? 'CATALOGO_NO_GENERADO' : 'ERROR_CATALOGO',
        error: noDisponible
          ? 'El catálogo geográfico todavía no está generado. Ejecuta el proceso de construcción de datos.'
          : 'No se pudo consultar el catálogo geográfico.',
      });
    }
  };
}

export default crearHandler(catalogoEnDisco);
