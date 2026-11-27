// Compara el índice de dos catálogos (p. ej. el reclasificado y versionado frente al reconstruido desde las fuentes).
// Uso: npx tsx scripts/comparar-catalogos-geo.ts <catalogo-A> <catalogo-B>
import { leerIndiceCompleto } from '../src/geo/empaquetar.ts';
const [a, b] = [process.argv[2], process.argv[3]];
if (!a || !b) { console.error('Uso: comparar-catalogos-geo.ts <A> <B>'); process.exit(1); }
const A = leerIndiceCompleto(a).nombres, B = leerIndiceCompleto(b).nombres;
const clave = (e: unknown[]) => `${e[0]}:${e[1]}`;
let soloA = 0, soloB = 0, difBandera = 0, comunes = 0; const muestra: string[] = [];
for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
  const ma = new Map((A[k] ?? []).map((e) => [clave(e), e[4] === 1])), mb = new Map((B[k] ?? []).map((e) => [clave(e), e[4] === 1]));
  for (const [id, p] of ma) { if (!mb.has(id)) { soloA++; } else { comunes++; if (mb.get(id) !== p) { difBandera++; if (muestra.length < 15) muestra.push(`${k} → ${id} A=${p ? 'propio' : 'alias'} B=${mb.get(id) ? 'propio' : 'alias'}`); } } }
  for (const id of mb.keys()) if (!ma.has(id)) soloB++;
}
console.log(`claves A=${Object.keys(A).length} B=${Object.keys(B).length} · entradas comunes ${comunes} · solo en A ${soloA} · solo en B ${soloB} · distinta clasificación ${difBandera}`);
for (const m of muestra) console.log('  ', m);
