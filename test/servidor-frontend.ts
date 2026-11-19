// Servidor estático mínimo para probar el frontend real en Chromium (sin red externa).
// Mapa de rutas equivalente al de vercel.json: páginas en la raíz, scripts y CSS en public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TIPOS: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export async function servirFrontend(root: string): Promise<{ base: string; cerrar: () => void }> {
  const srv = http.createServer((q, r) => {
    const url = (q.url || '/').split('?')[0]!;
    const archivo = url === '/' ? 'index.html'
      : /^\/[\w-]+\.html$/.test(url) ? url.slice(1)
      : /^\/[\w-]+\.(js|css)$/.test(url) ? 'public' + url
      : /^\/destinos\/[\w-]+\.svg$/.test(url) ? 'public' + url
      : '';
    const ruta = archivo ? path.join(root, archivo) : '';
    if (!ruta || !fs.existsSync(ruta)) { r.statusCode = 404; r.end(); return; }
    r.setHeader('content-type', TIPOS[path.extname(ruta)] || 'text/plain');
    r.end(fs.readFileSync(ruta));
  });
  await new Promise<void>((ok) => srv.listen(0, ok));
  return { base: 'http://127.0.0.1:' + (srv.address() as any).port, cerrar: () => srv.close() };
}
