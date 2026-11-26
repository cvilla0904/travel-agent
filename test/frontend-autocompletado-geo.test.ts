// Autocompletado de destinos (index.html) en Chromium contra el handler REAL de api/geo.ts
// con el catálogo v2 de prueba leído de disco (datos ficticios del fixture). Sin red externa ni proveedores.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { catalogoEnDiscoDePrueba } from './geo-fixture.ts';
import { crearHandler } from '../api/geo.ts';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;

function adaptar(handler: (req: any, res: any) => unknown) {
  return (url: URL, _q: any, r: any) => {
    if (url.pathname !== '/api/geo') return false;
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    let codigo = 200;
    const cab: Record<string, string> = { 'content-type': 'application/json' };
    const res = {
      setHeader: (k: string, v: string) => { cab[k] = v; return res; },
      status: (c: number) => { codigo = c; return res; },
      json: (d: unknown) => { r.writeHead(codigo, cab); r.end(JSON.stringify(d)); return res; },
    };
    handler({ method: 'GET', query }, res);
    return true;
  };
}

const escribir = async (p: any, id: string, texto: string) => {
  await p.fill(`#${id}`, '');
  await p.type(`#${id}`, texto, { delay: 15 });
};
const opciones = (p: any, id: string) => p.evaluate((i: string) => [...document.querySelectorAll(`#${i}-suggestions .city-suggestion`)].map((b) => ({
  nombre: b.querySelector('strong')!.textContent, pais: b.querySelector('small')!.textContent, etiqueta: b.querySelector('.city-suggestion-code')!.textContent,
})), id);

test('autocompletado: endpoint real, aeropuertos, selección, sin resultados, errores sin respaldo local', { skip: omitir }, async () => {
  const { cat, limpiar } = catalogoEnDiscoDePrueba();
  const root = path.resolve(import.meta.dirname, '..');
  let modo: 'real' | '503' | 'caido' | 'lento' = 'real';
  const real = crearHandler(() => cat);
  const vacio = new Catalogo(fuenteEnDisco(path.join(root, 'no-existe-catalogo')));
  const silencio = console.error;
  const api = adaptar((req, res) => {
    if (modo === '503') { console.error = () => {}; try { return crearHandler(() => vacio)(req, res); } finally { console.error = silencio; } }
    return real(req, res);
  });
  const { base, cerrar } = await servirFrontend(root, (url, q, r) => {
    if (modo === 'caido' && url.pathname === '/api/geo') { q.socket.destroy(); return true; }
    return api(url, q, r);
  });
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    const consola: string[] = [], errores: string[] = [];
    // Los recursos externos (fuentes, etc.) se abortan a propósito y el servidor de pruebas no sirve /favicon.ico (Chrome lo pide solo):
    // solo cuentan los demás errores de la propia página, con su URL para poder diagnosticarlos.
    p.on('console', (m: any) => { if (m.type() === 'error' && String(m.location()?.url ?? '').startsWith(base) && !String(m.location().url).endsWith('/favicon.ico')) consola.push(m.text() + ' ' + m.location().url); });
    p.on('pageerror', (e: any) => errores.push(String(e)));
    await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
    await p.goto(base + '/');

    // 1) Resultados reales del endpoint (no el diccionario local): ciudades del catálogo, con país y aeropuertos.
    await escribir(p, 'destino', 'mad');
    await p.waitForSelector('#destino-suggestions .city-suggestion');
    let o = await opciones(p, 'destino');
    assert.ok(o.some((x: any) => x.nombre === 'Madrid' && x.pais === 'España' && x.etiqueta === 'MAD'), JSON.stringify(o));

    // 2) Ciudad con varios aeropuertos: se muestran todos (no solo el primero).
    await escribir(p, 'destino', 'tok');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions strong')].some((e) => e.textContent === 'Tokyo'));
    o = await opciones(p, 'destino');
    assert.equal(o.find((x: any) => x.nombre === 'Tokyo').etiqueta.split(' · ').sort().join(), 'HND,NRT');

    // 3) Acentos y Unicode no latino: ciudades que NO existen en el diccionario local de index.html.
    await escribir(p, 'destino', 'são');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions strong')].some((e) => e.textContent === 'São Paulo'));
    await escribir(p, 'destino', 'москв');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions strong')].some((e) => e.textContent === 'Moscow'));

    // 3b) Consulta CJK de solo 2 caracteres (東京): el frontend ya la envía y el endpoint la acepta.
    await escribir(p, 'destino', '東京');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions strong')].some((e) => e.textContent === 'Tokyo'));

    // 4) Aeropuerto por código IATA.
    await escribir(p, 'destino', 'nrt');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions .city-suggestion-code')].some((e) => e.textContent === 'NRT'));

    // 5) Selección con teclado: el campo guarda el id y el tipo del catálogo.
    await escribir(p, 'destino', 'sao pa');
    await p.waitForFunction(() => [...document.querySelectorAll('#destino-suggestions strong')].some((e) => e.textContent === 'São Paulo'));
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
    const elegido = await p.evaluate(() => { const i = document.getElementById('destino') as HTMLInputElement; return { v: i.value, id: i.dataset.geoId, t: i.dataset.geoTipo, c: i.dataset.codigoCiudad }; });
    assert.deepEqual([elegido.v, elegido.id, elegido.t, elegido.c], ['São Paulo', 'gn:3448439', 'ciudad', 'GRU']);

    // 6) Selección con el ratón en el segundo campo.
    await escribir(p, 'origen', 'mad');
    await p.waitForSelector('#origen-suggestions .city-suggestion');
    await p.dispatchEvent('#origen-suggestions .city-suggestion >> nth=0', 'mousedown');
    assert.ok((await p.inputValue('#origen')).length > 0);

    // 7) Sin resultados: mensaje, no fallback con datos inventados.
    await escribir(p, 'destino', 'zzzzqx');
    await p.waitForSelector('#destino-suggestions .city-suggestion-empty');
    assert.match(await p.textContent('#destino-suggestions'), /No hay coincidencias/);

    assert.deepEqual(consola, [], 'sin errores de consola con el catálogo disponible');
    assert.deepEqual(errores, []);

    // 8) Catálogo no disponible (503) o servidor caído: NO se inventan sugerencias (fuente única: /api/geo) y la página no se rompe.
    for (const m of ['503', 'caido'] as const) {
      modo = m;
      await escribir(p, 'destino', m === '503' ? 'madr' : 'barc');
      await p.waitForTimeout(600);
      assert.equal(await p.locator('#destino-suggestions .city-suggestion:not(.city-suggestion-empty)').count(), 0, `sin sugerencias inventadas (${m})`);
    }
    assert.deepEqual(errores, [], 'ninguna excepción de página en los errores de red');
  } finally { await b.close(); cerrar(); limpiar(); }
});
