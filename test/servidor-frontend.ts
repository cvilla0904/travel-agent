// Servidor estático mínimo para probar el frontend real en Chromium (sin red externa).
// Mapa de rutas equivalente al de vercel.json: páginas en la raíz, scripts y CSS en public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TIPOS: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

export type ApiExtra = (url: URL, q: http.IncomingMessage, r: http.ServerResponse) => boolean;

export async function servirFrontend(root: string, api?: ApiExtra): Promise<{ base: string; cerrar: () => void }> {
  const srv = http.createServer((q, r) => {
    if (api && api(new URL(q.url || '/', 'http://x'), q, r)) return;
    const url = (q.url || '/').split('?')[0]!;
    const archivo = url === '/' ? 'index.html'
      : /^\/[\w-]+\.html$/.test(url) ? url.slice(1)
      : /^\/[\w-]+\.(js|css)$/.test(url) ? 'public' + url
      : url === '/travel-agent-illustration.jpg' ? 'travel-agent-illustration.jpg'
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
