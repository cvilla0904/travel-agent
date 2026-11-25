/**
 * Relevancia del autocompletado con nombres en otros idiomas: para cada consulta indica en qué posición queda la ciudad esperada.
 *   npx tsx scripts/medir-relevancia-geo.ts [dirCatalogo]
 */
import path from 'node:path';
import { Catalogo, DIR_CATALOGO, fuenteEnDisco } from '../src/geo/catalogo.ts';
import { buscarDestinos } from '../src/geo/buscar.ts';

// [consulta, nombre canónico esperado (GeoNames), país]
export const CASOS: Array<[string, string, string]> = [
  ['munich', 'Munich', 'DE'], ['moscu', 'Moscow', 'RU'], ['pekin', 'Beijing', 'CN'], ['estambul', 'Istanbul', 'TR'],
  ['florencia', 'Florence', 'IT'], ['venecia', 'Venice', 'IT'], ['ginebra', 'Geneva', 'CH'], ['copenhague', 'Copenhagen', 'DK'],
  ['bombay', 'Mumbai', 'IN'], ['calcuta', 'Kolkata', 'IN'], ['nueva delhi', 'New Delhi', 'IN'], ['san petersburgo', 'Saint Petersburg', 'RU'],
  ['la meca', 'Makkah', 'SA'], ['londres', 'London', 'GB'], ['nueva york', 'New York City', 'US'], ['viena', 'Vienna', 'AT'],
  ['praga', 'Prague', 'CZ'], ['sao paulo', 'São Paulo', 'BR'], ['seul', 'Seoul', 'KR'], ['tokio', 'Tokyo', 'JP'],
  ['ciudad de mexico', 'Mexico City', 'MX'], ['buenos aires', 'Buenos Aires', 'AR'], ['los angeles', 'Los Angeles', 'US'],
  ['san sebastian', 'Donostia / San Sebastián', 'ES'], ['donostia', 'Donostia / San Sebastián', 'ES'], ['sevilla', 'Sevilla', 'ES'], ['lisboa', 'Lisbon', 'PT'],
  ['brujas', 'Brugge', 'BE'], ['gante', 'Gent', 'BE'], ['atenas', 'Athens', 'GR'], ['el cairo', 'Cairo', 'EG'], ['pekín', 'Beijing', 'CN'],
  ['san jose', 'San Jose', 'US'], ['san francisco', 'San Francisco', 'US'], ['san antonio', 'San Antonio', 'US'], ['mad', 'Madrid', 'ES'], ['bog', 'Bogotá', 'CO'],
];
const dir = path.resolve(process.argv[2] ?? DIR_CATALOGO);
const cat = new Catalogo(fuenteEnDisco(dir));
let top1 = 0, top3 = 0, top8 = 0, fuera = 0;
for (const [q, esperado, pais] of CASOS) {
  const r = buscarDestinos(cat, q, { limite: 12 });
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pos = r.findIndex((x) => x.tipo === 'ciudad' && x.codigoPais === pais && norm(x.nombre) === norm(esperado));
  if (pos === 0) top1++; if (pos >= 0 && pos < 3) top3++; if (pos >= 0 && pos < 8) top8++; if (pos < 0) fuera++;
  console.log(`${q.padEnd(18)} → ${pos < 0 ? 'FUERA de los 12' : `posición ${pos + 1}`.padEnd(16)}  ${r.slice(0, 3).map((x) => x.nombre).join(' · ')}`);
}
console.log(`\nResumen: ${CASOS.length} consultas · primera posición ${top1} · top-3 ${top3} · top-8 ${top8} · fuera ${fuera}`);
