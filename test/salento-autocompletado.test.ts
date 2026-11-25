// Autocompletado de «Salento»: tres destinos diferenciados (Quindío, Apulia, Campania) y coherencia con el backend.
// Catálogo versionado en disco, handler real de /api/geo. Sin red, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.js';
import { crearHandler } from '../api/geo.js';
import { DESTINOS_EDITORIALES, SALENTO_APULIA, destinoEditorial } from '../src/geo/destinos-editoriales.js';
import { regionEditorial } from '../src/geo/regiones-editoriales.js';
import { contextoDestinoSeleccionado, etiquetaDestino, normalizarDestinoSeleccionado } from '../src/services/destino-seleccionado.js';
import { codigoPaisDesdeDestino, consultaProveedorParaCiudad, datosCiudad, regionCurada, variantesCiudad, CIUDADES_EQUIVALENTES } from '../src/services/ciudades.js';
import { construirConsulta } from '../src/services/apify-hoteles.js';
import { validarUbicacion } from '../src/services/hoteles-apify-normalizar.js';
import { normalizarCiudadBusquedaMultidestino } from '../src/services/hoteles-multidestino.js';

const cat = new Catalogo(fuenteEnDisco());
const handler = crearHandler(() => cat);
const QUINDIO = 'gn:3670352', CAMPANIA = 'gn:3168676';

/** Llama al handler real como lo hace el navegador y devuelve los resultados. */
function geo(q: string, extra: Record<string, string> = {}): any[] {
  let cuerpo: any; let codigo = 0;
  const res: any = { setHeader() { return res; }, status(c: number) { codigo = c; return res; }, json(d: unknown) { cuerpo = d; return res; } };
  handler({ method: 'GET', query: { q, ...extra } }, res);
  assert.equal(codigo, 200, q);
  return cuerpo.resultados;
}
const salentos = (q: string) => geo(q).filter((r) => r.nombre === 'Salento').map((r) => r.id);

/** Lo que el navegador guarda al elegir una sugerencia (index.html: dataset.destinoGeo) y envía a /api/chat. */
const comoLoEnviaElNavegador = (r: any) => ({ nombre: r.nombre, pais: r.nombrePais || r.codigoPais || '', codigoPais: r.codigoPais || '', region: r.region || '', id: r.id, tipo: r.tipo });

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

test('«Salento» ofrece tres destinos diferenciados y en orden editorial: Quindío, Apulia, Campania', () => {
  assert.deepEqual(salentos('Salento'), [QUINDIO, SALENTO_APULIA, CAMPANIA]);
  assert.deepEqual(salentos('salen'), [QUINDIO, SALENTO_APULIA, CAMPANIA], 'también mientras se escribe');
  const r = geo('Salento').filter((x) => x.nombre === 'Salento');
  assert.deepEqual(r.map((x) => [x.region, x.codigoPais, x.nombrePais]), [['Quindío', 'CO', 'Colombia'], ['Apulia', 'IT', 'Italia'], ['Campania', 'IT', 'Italia']]);
  assert.equal(new Set(r.map((x) => `${x.region}|${x.codigoPais}`)).size, 3, 'ninguna pareja región/país se repite');
  for (const x of r) assert.ok(typeof x.latitud === 'number' && typeof x.longitud === 'number', x.id);
});

test('tabla de entradas esperadas del autocompletado', () => {
  const primero = (q: string) => geo(q)[0]?.id;
  assert.equal(primero('Salento, Colombia'), QUINDIO);
  assert.deepEqual(salentos('Salento, Colombia'), [QUINDIO], 'el país acota: ni Apulia ni Campania');
  assert.deepEqual(salentos('Salento, Italia'), [SALENTO_APULIA, CAMPANIA], 'Apulia primero, Campania como alternativa diferenciada');
  assert.equal(primero('Salento, Lecce'), SALENTO_APULIA);
  assert.equal(primero('Salento, Puglia'), SALENTO_APULIA);
  assert.equal(primero('Salento, Apulia'), SALENTO_APULIA);
  assert.equal(primero('Salento, Campania'), CAMPANIA);
  assert.equal(primero('Salento, Camp'), CAMPANIA, 'región a medio escribir');
  assert.equal(primero('Salento, Quindío'), QUINDIO);
  assert.deepEqual(geo('Salento, Francia'), [], 'ninguno es francés');
  assert.deepEqual(salentos('Salento, it'), [SALENTO_APULIA, CAMPANIA]);
  assert.deepEqual(geo('Salento', { pais: 'IT' }).map((r) => r.id), [SALENTO_APULIA, CAMPANIA], 'filtro pais= del endpoint');
});

test('cada sugerencia, tal como la envía el navegador, produce el mismo destino en el backend', () => {
  const esperado: Record<string, { region: string | undefined; etiqueta: string; pais: string }> = {
    [QUINDIO]: { region: 'Quindío', etiqueta: 'Salento, Quindío, Colombia', pais: 'co' },
    [SALENTO_APULIA]: { region: 'Apulia', etiqueta: 'Salento, Apulia, Italia', pais: 'it' },
    [CAMPANIA]: { region: undefined, etiqueta: 'Salento, Campania, Italia', pais: 'it' },
  };
  for (const r of geo('Salento').filter((x) => x.nombre === 'Salento')) {
    const sel = normalizarDestinoSeleccionado(comoLoEnviaElNavegador(r))!;
    const e = esperado[r.id]!;
    assert.equal(sel.id, r.id);
    assert.equal(sel.codigoPais, r.codigoPais);
    assert.equal(etiquetaDestino(sel), e.etiqueta, r.id);
    const contexto = contextoDestinoSeleccionado(sel);
    assert.ok(contexto.includes(`«${e.etiqueta}»`) && contexto.includes(r.id), r.id);
    // El backend resuelve esa etiqueta al MISMO punto que mostró el autocompletado.
    const d = datosCiudad(etiquetaDestino(sel));
    assert.ok(d, r.id);
    assert.ok(km(d!, { lat: r.latitud, lng: r.longitud }) < 1, `${r.id}: coordenadas del backend (${d!.lat},${d!.lng}) = las del resultado (${r.latitud},${r.longitud})`);
    assert.equal(codigoPaisDesdeDestino(etiquetaDestino(sel)), e.pais, r.id);
    assert.equal(regionCurada(etiquetaDestino(sel)), e.region, r.id);
    assert.equal(construirConsulta(etiquetaDestino(sel)), `hotels in ${e.etiqueta}`, 'la consulta que recibiría Apify');
    assert.equal(consultaProveedorParaCiudad(etiquetaDestino(sel)), 'Salento');
    assert.ok(variantesCiudad(etiquetaDestino(sel)).includes('salento'));
    assert.equal(normalizarCiudadBusquedaMultidestino(etiquetaDestino(sel)), e.etiqueta, 'multidestino conserva el destino elegido');
  }
});

test('validación geográfica de hoteles: cada Salento acepta lo suyo y rechaza lo de los otros', () => {
  const sitios = { quindio: { lat: 4.6376, lng: -75.57 }, lecce: { lat: 40.355, lng: 18.172 }, otranto: { lat: 40.148, lng: 18.487 }, campania: { lat: 40.249, lng: 15.189 } };
  const fila = (p: { lat: number; lng: number }, cc: string) => ({ countryCode: cc, latitude: p.lat, longitude: p.lng, address: 'Via Roma 1' });
  const valida = (etiqueta: string, p: { lat: number; lng: number }, cc: string) => {
    const d = datosCiudad(etiqueta)!;
    return validarUbicacion(fila(p, cc), {
      paisCodigo: codigoPaisDesdeDestino(etiqueta)!, nombresCiudad: variantesCiudad(etiqueta),
      centro: { lat: d.lat, lng: d.lng, ...(d.radioKm ? { radioKm: d.radioKm } : {}) },
    }).ok;
  };
  assert.equal(valida('Salento, Quindío, Colombia', sitios.quindio, 'CO'), true);
  assert.equal(valida('Salento, Quindío, Colombia', sitios.lecce, 'IT'), false);
  assert.equal(valida('Salento, Apulia, Italia', sitios.lecce, 'IT'), true);
  assert.equal(valida('Salento, Apulia, Italia', sitios.otranto, 'IT'), true);
  assert.equal(valida('Salento, Apulia, Italia', sitios.campania, 'IT'), false, 'el municipio de Campania no es Apulia');
  assert.equal(valida('Salento, Apulia, Italia', sitios.quindio, 'CO'), false);
  assert.equal(valida('Salento, Campania, Italia', sitios.campania, 'IT'), true);
  assert.equal(valida('Salento, Campania, Italia', sitios.lecce, 'IT'), false, 'Lecce no es el municipio de Campania');
  assert.equal(valida('Salento, Campania, Italia', sitios.otranto, 'IT'), false);
});

test('el servidor no se fía del cliente: el id editorial manda sobre nombre, país, código y región', () => {
  const manipulado = normalizarDestinoSeleccionado({ nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', region: 'Quindío', id: SALENTO_APULIA, tipo: 'region' })!;
  assert.deepEqual(manipulado, { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Apulia', id: SALENTO_APULIA, tipo: 'ciudad' });
  assert.equal(etiquetaDestino(manipulado), 'Salento, Apulia, Italia');
  // Un id editorial inexistente se descarta (no se acepta un identificador inventado).
  const falso = normalizarDestinoSeleccionado({ nombre: 'Salento', pais: 'Italia', id: 'ed:no-existe' })!;
  assert.equal(falso.id, undefined);
  // Un id de catálogo conserva la región editorial de ese id, no la del cliente.
  assert.equal(normalizarDestinoSeleccionado({ nombre: 'Salento', id: CAMPANIA, region: 'Apulia' })!.region, 'Campania');
  assert.equal(normalizarDestinoSeleccionado({ nombre: 'Salento', id: 'ed:salento-apulia; DROP' })!.id, undefined);
});

test('fuente única: la entrada curada de ciudades.ts y el destino editorial no pueden discrepar', () => {
  const ed = destinoEditorial(SALENTO_APULIA)!;
  const grupo = CIUDADES_EQUIVALENTES.find((g) => g.pais === 'it' && g.consulta === 'Salento')!;
  assert.deepEqual(grupo.regiones, ed.claves);
  assert.equal(grupo.region, ed.region);
  assert.equal(grupo.centro!.lat, ed.centro.lat);
  assert.equal(grupo.centro!.lng, ed.centro.lon);
  assert.equal(grupo.centro!.radioKm, ed.centro.radioKm);
  assert.equal(ed.pais.toLowerCase(), grupo.pais);
  assert.equal(regionEditorial(SALENTO_APULIA)!.nombre, ed.region);
  // Todo destino editorial tiene id «ed:», país conocido por el catálogo y aeropuertos de acceso existentes.
  for (const d of Object.values(DESTINOS_EDITORIALES)) {
    assert.match(d.id, /^ed:[a-z0-9-]+$/);
    assert.ok(cat.pais(d.pais), d.id);
    for (const iata of d.aeropuertos) assert.equal(cat.aeropuertoPorIata(iata)?.pais, d.pais, `${d.id}: ${iata}`);
  }
});

test('un catálogo sin ese país no ofrece destinos editoriales y el resto de búsquedas no cambia', () => {
  assert.deepEqual(geo('Madrid').map((r) => r.nombre).slice(0, 1), ['Madrid']);
  assert.ok(!geo('Madrid').some((r) => r.id.startsWith('ed:')));
  assert.ok(!geo('Lecce').some((r) => r.id.startsWith('ed:')), 'solo se ofrece cuando el nombre coincide');
});
