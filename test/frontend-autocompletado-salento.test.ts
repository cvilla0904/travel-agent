// «Salento» en el navegador (Chromium) contra el handler REAL de api/geo.ts con el catálogo real: tres opciones con región y país,
// y cada una deja en el formulario el destino que el backend recibirá. Sin red externa, sin proveedores, sin créditos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servirFrontend } from './servidor-frontend.ts';
import { crearHandler } from '../api/geo.ts';
import { Catalogo, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { etiquetaDestino, normalizarDestinoSeleccionado } from '../src/services/destino-seleccionado.ts';
import { datosCiudad } from '../src/services/ciudades.ts';

const require = createRequire(import.meta.url);
let chromium: any = null;
try { chromium = require('playwright').chromium; } catch { /* sin playwright */ }
const EXEC = ['/opt/pw-browsers/chromium', process.env.CHROMIUM_PATH].find((p) => p && fs.existsSync(p));
const omitir = !chromium ? 'playwright no disponible' : false;

test('Salento: tres sugerencias con región y país; cada elección fija el destino exacto', { skip: omitir }, async () => {
  const cat = new Catalogo(fuenteEnDisco());
  const real = crearHandler(() => cat);
  const root = path.resolve(import.meta.dirname, '..');
  const { base, cerrar } = await servirFrontend(root, (url, _q, r) => {
    if (url.pathname !== '/api/geo') return false;
    const query: Record<string, string> = {}; url.searchParams.forEach((v, k) => { query[k] = v; });
    let codigo = 200; const cab: Record<string, string> = { 'content-type': 'application/json' };
    const res: any = { setHeader: (k: string, v: string) => { cab[k] = v; return res; }, status: (c: number) => { codigo = c; return res; }, json: (d: unknown) => { r.writeHead(codigo, cab); r.end(JSON.stringify(d)); return res; } };
    real({ method: 'GET', query }, res);
    return true;
  });
  const b = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  try {
    const p = await b.newPage();
    const errores: string[] = [];
    p.on('pageerror', (e: any) => errores.push(String(e)));
    await p.route((u: URL) => !u.href.startsWith(base), (r: any) => r.abort());
    await p.goto(base + '/');

    const sugerencias = () => p.evaluate(() => [...document.querySelectorAll('#destino-suggestions .city-suggestion')].map((b) => ({
      nombre: b.querySelector('strong')!.textContent, detalle: b.querySelector('small')!.textContent,
    })));
    const escribir = async (t: string) => { await p.fill('#destino', ''); await p.type('#destino', t, { delay: 15 }); await p.waitForSelector('#destino-suggestions .city-suggestion'); };
    // Lo que /api/chat recibiría como destinoSeleccionado y el texto que el formulario compone para el agente.
    const estado = () => p.evaluate(() => ({
      visible: (document.getElementById('destino') as HTMLInputElement).value,
      sel: (window as any).leerDestinoSeleccionado(),
      geo: JSON.parse((document.getElementById('destino') as HTMLInputElement).dataset.destinoGeo || 'null'),
    }));

    await escribir('Salento');
    await p.waitForFunction(() => document.querySelectorAll('#destino-suggestions .city-suggestion').length >= 3);
    const o = await sugerencias();
    assert.deepEqual(o.slice(0, 3), [
      { nombre: 'Salento', detalle: 'Quindío, Colombia' },
      { nombre: 'Salento', detalle: 'Apulia, Italia' },
      { nombre: 'Salento', detalle: 'Campania, Italia' },
    ]);

    const casos = [
      { indice: 0, visible: 'Salento, Quindío', id: 'gn:3670352', pais: 'CO', region: 'Quindío', etiqueta: 'Salento, Quindío, Colombia' },
      { indice: 1, visible: 'Salento, Apulia', id: 'ed:salento-apulia', pais: 'IT', region: 'Apulia', etiqueta: 'Salento, Apulia, Italia' },
      { indice: 2, visible: 'Salento, Campania', id: 'gn:3168676', pais: 'IT', region: 'Campania', etiqueta: 'Salento, Campania, Italia' },
    ];
    for (const c of casos) {
      await escribir('Salento');
      await p.waitForFunction(() => document.querySelectorAll('#destino-suggestions .city-suggestion').length >= 3);
      await p.dispatchEvent(`#destino-suggestions .city-suggestion >> nth=${c.indice}`, 'mousedown');
      const e = await estado();
      assert.equal(e.visible, c.visible, 'el campo muestra qué homónimo se eligió');
      assert.deepEqual([e.sel?.id, e.sel?.codigoPais, e.sel?.region], [c.id, c.pais, c.region], 'destinoSeleccionado vigente que viaja a /api/chat');
      // Lo que recibe el servidor tras sanearlo = lo que el catálogo ofreció, y sus coordenadas son las que usará Apify.
      const srv = normalizarDestinoSeleccionado(e.sel)!;
      assert.equal(etiquetaDestino(srv), c.etiqueta);
      const d = datosCiudad(etiquetaDestino(srv))!;
      const ofrecido = (await p.evaluate(async (q: string) => (await (await fetch('/api/geo?q=' + q)).json()).resultados, 'Salento')).find((r: any) => r.id === c.id);
      assert.ok(Math.abs(d.lat - ofrecido.latitud) < 0.01 && Math.abs(d.lng - ofrecido.longitud) < 0.01, `${c.id}: mismas coordenadas en autocompletado y backend`);
    }

    // Editar a mano el texto elegido descarta la identidad (se usaría solo el texto escrito).
    await p.type('#destino', 'x');
    assert.equal((await estado()).sel, null);
    assert.deepEqual(errores, []);
  } finally { await b.close(); cerrar(); }
});
