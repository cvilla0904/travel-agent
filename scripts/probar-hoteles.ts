/**
 * Prueba REAL de SearchAPI (consume créditos; requiere SEARCHAPI_API_KEY en el entorno).
 * Uso: SEARCHAPI_API_KEY=... npx tsx scripts/probar-hoteles.ts "Florencia" it 2026-12-10 2026-12-13 2
 * No imprime la clave.
 */
import { buscarHotelesConEstado } from '../src/services/searchapi.js';

const [destino = 'Florencia', pais = 'it', entrada = '2026-12-10', salida = '2026-12-13', adultos = '2'] = process.argv.slice(2);
const r = await buscarHotelesConEstado({ destino, paisCodigo: pais, fechaEntrada: entrada, fechaSalida: salida, adultos: Number(adultos) });
console.log(JSON.stringify({ estado: r.estado, error: r.error, diagnostico: r.diagnostico, muestra: r.hoteles.slice(0, 3) }, null, 2));
process.exit(r.estado === 'ok' ? 0 : 1);
