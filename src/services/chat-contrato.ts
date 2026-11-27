/**
 * Contrato de /api/chat (versión 1 de los resultados estructurados).
 *
 * Respuesta correcta (HTTP 200):
 *   { response: string,            // explicación y conversación del Travel Manager (texto; NO es la fuente de los resultados)
 *     resultados: ResultadosChat,  // vuelos / hoteles / actividades como datos (resultados-estructurados.ts)
 *     aviso?: string }             // solo si el agente falló después de obtener resultados reales: se conservan
 *   Error: HTTP 4xx/5xx con { error: string }.
 * `response` se mantiene por compatibilidad con los clientes anteriores.
 *
 * Compartido por api/index.ts (Vercel) y src/server.ts (local); sin dependencias del SDK, de modo que se prueba tal cual.
 */
import { conDestinoFijado } from './destino-fijado.js';
import { conColectorResultados, sinResultados, type ResultadosChat } from './resultados-estructurados.js';

export interface CuerpoChatOk { response: string; resultados: ResultadosChat; aviso?: string }
export type RespuestaChat = { status: 200; body: CuerpoChatOk } | { status: 500; body: { error: string } };

function aTexto(salida: unknown): string {
  if (typeof salida === 'string') return salida;
  if (salida === null || salida === undefined) return '';
  try { return JSON.stringify(salida); } catch { return String(salida); }
}

/** Ejecuta un turno del agente con el destino fijado y recogiendo los resultados estructurados de las herramientas. */
export async function turnoChat(
  destinoSeleccionado: unknown,
  ejecutar: () => Promise<{ finalOutput?: unknown }>,
): Promise<RespuestaChat> {
  const r = await conColectorResultados(() => conDestinoFijado(destinoSeleccionado, ejecutar));
  if (r.ok) return { status: 200, body: { response: aTexto(r.valor.finalOutput), resultados: r.resultados } };
  const mensaje = r.error instanceof Error ? r.error.message : 'Error interno.';
  console.error(r.error);
  // Resultados reales ya obtenidos: no se tiran por un fallo posterior del agente al redactar la explicación.
  if (!sinResultados(r.resultados)) {
    return {
      status: 200,
      body: {
        response: '',
        resultados: r.resultados,
        aviso: 'Se han obtenido los resultados de los proveedores, pero no se ha podido redactar la explicación. Puedes pedirla de nuevo.',
      },
    };
  }
  return { status: 500, body: { error: mensaje || 'Error interno.' } };
}
