// Genera las páginas de destino nuevas y sus ilustraciones a partir de scripts/destinos-datos.mjs.
// Uso: node scripts/generar-destinos.mjs   (escribe *.html en la raíz y public/destinos/*.svg)
import fs from 'node:fs';
import path from 'node:path';
import { DESTINOS, urlFoto } from './destinos-datos.mjs';

const raiz = path.resolve(import.meta.dirname, '..');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Ilustración original (no es una fotografía): cielo, sol, tres planos de relieve y un motivo. */
export function svgDestino(d) {
  const p = d.paleta;
  const montes = (y, amp, color, fase) => {
    let t = `M0 ${y}`;
    for (let x = 0; x <= 1600; x += 160) t += ` Q${x + 80} ${y - amp * (1 + Math.sin(x / 160 + fase))} ${x + 160} ${y}`;
    return `<path d="${t} L1600 900 L0 900Z" fill="${color}"/>`;
  };
  const motivos = {
    palmas: [1000, 1250, 1380].map((x, i) => `<g transform="translate(${x} ${560 + i * 40})"><rect x="-6" y="0" width="12" height="${260 - i * 30}" fill="#6b4a2f"/><g fill="#14392f">${[-60, -30, 0, 30, 60].map((a) => `<ellipse cx="0" cy="-6" rx="70" ry="9" transform="rotate(${a - 90} 0 -6)"/>`).join('')}</g></g>`).join(''),
    velero: `<g transform="translate(1050 470)"><path d="M0 220 L240 220 L200 270 L40 270Z" fill="#f5f2ea"/><path d="M120 0 L120 215 L10 215Z" fill="#fff"/><path d="M130 30 L130 215 L220 215Z" fill="#f3d9b8"/></g><path d="M0 700 Q400 650 800 700 T1600 700 L1600 900 L0 900Z" fill="#2e6c8c" opacity=".55"/>`,
    fuerte: `<g fill="${p.cerca}" transform="translate(880 330)"><rect x="0" y="260" width="620" height="270"/>${[0, 120, 240, 360, 480].map((x) => `<rect x="${x + 10}" y="220" width="70" height="50"/>`).join('')}<rect x="250" y="120" width="120" height="150"/><path d="M250 120 Q310 20 370 120Z"/><rect x="40" y="150" width="60" height="120"/><path d="M40 150 Q70 90 100 150Z"/><rect x="520" y="150" width="60" height="120"/><path d="M520 150 Q550 90 580 150Z"/></g>`,
    minarete: `<g fill="${p.cerca}" transform="translate(1040 260)"><rect x="40" y="90" width="26" height="420"/><path d="M53 0 L68 90 L38 90Z"/><rect x="28" y="190" width="50" height="14"/><rect x="-130" y="420" width="190" height="100"/><path d="M-130 420 Q-35 320 60 420Z"/>${[250, 330, 400].map((x, i) => `<g transform="translate(${x} ${450 - i * 20})"><path d="M0 70 L50 0 L100 70Z"/><rect x="0" y="70" width="100" height="${40 + i * 20}"/></g>`).join('')}</g>`
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(d.alt)}"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.cielo[0]}"/><stop offset="1" stop-color="${p.cielo[1]}"/></linearGradient></defs><rect width="1600" height="900" fill="url(#c)"/><circle cx="420" cy="260" r="110" fill="${p.sol}" opacity=".9"/><circle cx="420" cy="260" r="170" fill="${p.sol}" opacity=".18"/>${montes(560, 60, p.lejos, 0)}${montes(660, 70, p.medio, 2)}${motivos[p.motivo]}${montes(790, 50, p.cerca, 4)}</svg>`;
}

function pagina(d) {
  const url = `/index.html?destino=${encodeURIComponent(d.destinoForm)}&dias=${d.dias}#inicio`;
  const dias = d.dias_plan.map((x, i) => `<article class="day"><span class="number">${String(i + 1).padStart(2, '0')}</span><div><h2>${esc(x[0])}</h2><p>${esc(x[1])}</p><p class="traslado"><b>Traslado:</b> ${esc(x[2])}</p></div></article>`).join('\n');
  const exp = d.experiencias.map(([t, l]) => `<div class="exp"><h3>${esc(t)}</h3><ul>${l.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  const extra = '.sec{margin:34px 0 0}.sec>h2{font:500 28px/1.2 Georgia,serif;color:var(--navy);margin:0 0 14px}.lugares{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}.lugares li{background:#fff;border:1px solid #eee5da;border-radius:999px;padding:7px 14px;font-size:13px}.expgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.exp{background:#fff;border:1px solid #eee8df;border-radius:18px;padding:20px}.exp h3{font:500 20px Georgia,serif;color:var(--navy);margin:0 0 8px}.exp ul,.consejos{margin:0;padding-left:18px;color:#5f7082}.exp li,.consejos li{margin:4px 0}.traslado{margin-top:8px!important;font-size:13px;color:var(--muted)!important}.traslado b{color:var(--navy)}.cover img{display:block;width:100%;height:100%;object-fit:cover}.cover{overflow:hidden}.credito{font-size:11px;color:var(--muted);margin:-18px 0 24px}@media(max-width:760px){.expgrid{grid-template-columns:1fr}}';
  const base = fs.readFileSync(path.join(raiz, 'viena.html'), 'utf8');
  const css = base.match(/<style>([\s\S]*?)<\/style>/)[1];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f8f5ef"><title>${esc(d.titulo)} · Mogavel</title><meta name="description" content="${esc(d.resumen)}"><style>${css}${extra}</style></head><body><header><nav class="wrap"><a class="brand" href="/">✦ Mogavel</a><a class="back" href="/index.html#planifica-tu-viaje">← Volver a Planifica tu viaje</a></nav></header><main class="wrap"><section class="hero"><span class="eyebrow">${d.dias} días · ${esc(d.pais)}</span><h1>${esc(d.titulo)}</h1><p class="intro">${esc(d.intro)}</p><div class="meta">${d.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div><div class="cover"><img src="${d.foto ? urlFoto(d.foto, 1800) : `/destinos/${d.slug}.svg`}" alt="${esc(d.foto ? d.fotoAlt : d.alt)}"${d.foto ? ` onerror="this.onerror=null;this.src='/destinos/${d.slug}.svg'"` : ''}></div><p class="credito">${d.foto ? 'Fotografía: Unsplash.' : 'Ilustración original de Mogavel, no es una fotografía del destino.'}</p></section><section class="content"><div><div class="days">
${dias}
</div><section class="sec" id="lugares"><h2>Ciudades y lugares que visitarás</h2><ul class="lugares">${d.lugares.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section><section class="sec" id="experiencias"><h2>Experiencias</h2><div class="expgrid">${exp}</div></section><section class="sec" id="consejos"><h2>Consejos prácticos y desplazamientos</h2><ul class="consejos">${d.consejos.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section></div><aside class="aside"><span class="eyebrow">${d.dias} días</span><h3>${esc(d.cardTitulo)}</h3><p>Una propuesta base para ajustar a tus fechas, ritmo y presupuesto. Cuéntanos qué te apetece y la convertimos en tu viaje.</p><a class="button" id="planificar" href="${url}">Planificar este viaje →</a><p class="note">Propuesta orientativa de Mogavel basada en rutas de referencia. Tiempos aproximados; confirma horarios, precios y disponibilidad antes de reservar.</p><p class="note"><a href="${d.enlace[0]}" target="_blank" rel="noopener">Más información: ${esc(d.enlace[1])}</a></p></aside></section></main><footer><div class="wrap">Mogavel · Tu próxima aventura empieza con una idea. <a href="/#inicio">Volver al inicio</a></div></footer></body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(path.join(raiz, 'public/destinos'), { recursive: true });
  for (const d of DESTINOS) {
    fs.writeFileSync(path.join(raiz, d.fichero), pagina(d));
    fs.writeFileSync(path.join(raiz, `public/destinos/${d.slug}.svg`), svgDestino(d));
    console.log('generado', d.fichero);
  }
}
