// M2 (verificación con el SDK real): el destino elegido por el usuario llega a buscarHotelesConEstado a través de
//   run(Travel Manager) → herramienta hotel_agent (Agent.asTool, corrida anidada) → herramienta buscar_hoteles → proveedor,
// aunque el modelo escriba otro `destino`, y dos corridas concurrentes con destinos distintos no mezclan su contexto
// (AsyncLocalStorage en src/services/destino-fijado.ts).
//
// QUÉ ES REAL: @openai/agents (Runner, Agent.asTool, ejecución de herramientas), los agentes reales de src/index.ts
//   (travelAgent, hotelAgent, buscar_hoteles), hoteles.ts → apify-hoteles.ts y destino-fijado.ts.
// QUÉ ESTÁ SIMULADO: (1) el modelo: un `Model` propio que responde con llamadas a herramientas deterministas, sin API de OpenAI;
//   (2) el cliente de Apify (se inyecta con fijarDependenciasHoteles): registra la consulta que recibe y falla, de modo que no hay
//   red ni créditos; globalThis.fetch rechaza cualquier host; (3) el token de Apify y las de Upstash son valores de prueba.
// Por qué no ScriptedModel (@openai/agents/testing): consume los pasos en orden de llamada y aquí hay dos corridas concurrentes
//   sobre los mismos agentes; un modelo sin estado que responde según la petición mantiene el reparto determinista.
//
// Si @openai/agents no está instalado (entorno sin dependencias) la prueba se omite; se ejecuta en CI (npm ci).
import test from 'node:test';
import assert from 'node:assert/strict';
import { conDestinoFijado } from '../src/services/destino-fijado.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let sdk: any = null;
try {
  sdk = await import('@openai/agents');
} catch {
  sdk = null;
}
const OMITIR: string | false = sdk ? false : 'SDK @openai/agents no instalado en este entorno: se ejecuta en CI';

const APULIA = { nombre: 'Salento', pais: 'Italia', codigoPais: 'IT', region: 'Apulia', id: 'ed:salento-apulia', tipo: 'ciudad' };
const QUINDIO = { nombre: 'Salento', pais: 'Colombia', codigoPais: 'CO', region: 'Quindío', id: 'gn:3670352', tipo: 'ciudad' };

/* ---------- utilidades del modelo simulado ---------- */

const textoDeItem = (item: any): string => {
  const c = item?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
  return '';
};
const itemsDe = (request: any): any[] => (Array.isArray(request.input) ? request.input : [{ role: 'user', content: String(request.input ?? '') }]);
const textoUsuario = (request: any): string => textoDeItem(itemsDe(request).find((i) => i?.role === 'user'));
const resultadoDe = (request: any, herramienta: string): any =>
  itemsDe(request).filter((i) => i?.type === 'function_call_result' && i?.name === herramienta).at(-1);
const textoSalida = (item: any): string => {
  const o = item?.output;
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o.map((p: any) => p?.text ?? '').join('');
  return String(o?.text ?? '');
};
const llamada = (name: string, args: Record<string, unknown>, callId: string) => ({
  type: 'function_call',
  name,
  callId,
  id: callId,
  status: 'completed',
  arguments: JSON.stringify(args),
});
const mensaje = (text: string) => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text }],
});

interface Registro { agente: 'manager' | 'hotel'; destinoEscritoPorElModelo?: string }

function crearModelo(registro: Registro[]) {
  return {
    async getResponse(request: any) {
      const herramientas: string[] = (request.tools ?? []).map((t: any) => t.name);
      const usage = new sdk.Usage();
      // Travel Manager: delega en hotel_agent con el texto del usuario y devuelve lo que ese agente respondió.
      if (herramientas.includes('hotel_agent')) {
        registro.push({ agente: 'manager' });
        const previo = resultadoDe(request, 'hotel_agent');
        if (!previo) return { usage, output: [llamada('hotel_agent', { input: textoUsuario(request) }, `m-${registro.length}`)] };
        return { usage, output: [mensaje(textoSalida(previo))] };
      }
      // Hotel Agent: el modelo «escribe» como destino lo que viene tras «Hoteles en »; después devuelve el resultado de la herramienta.
      if (herramientas.includes('buscar_hoteles')) {
        const destino = /Hoteles en (.+)$/.exec(textoUsuario(request))?.[1]?.trim() ?? '';
        registro.push({ agente: 'hotel', destinoEscritoPorElModelo: destino });
        const previo = resultadoDe(request, 'buscar_hoteles');
        if (!previo) {
          return {
            usage,
            output: [llamada('buscar_hoteles', { destino, fechaEntrada: '2027-03-10', fechaSalida: '2027-03-13', adultos: 2 }, `h-${registro.length}`)],
          };
        }
        const bruto = textoSalida(previo);
        let r: any = {};
        try { r = JSON.parse(bruto); } catch { r = { error: bruto }; }
        const estados = ['ok', 'sin_resultados', 'error_proveedor', 'error_interno'];
        const salida = {
          destino,
          fechaEntrada: '2027-03-10',
          fechaSalida: '2027-03-13',
          adultos: 2,
          estado: estados.includes(r.estado) ? r.estado : 'error_interno',
          error: typeof r.detalleProveedor === 'string' ? r.detalleProveedor : (typeof r.error === 'string' ? r.error : null),
          codigoError: typeof r.codigoError === 'string' ? r.codigoError : null,
          httpStatus: null,
          retryAfter: null,
          detalleProveedor: null,
          etapaError: null,
          diagnostico: { destinoResuelto: '', propiedadesProveedor: 0, devueltos: 0, conPrecio: 0, sinPrecio: 0, conEnlace: 0 },
          hoteles: [],
        };
        return { usage, output: [mensaje(JSON.stringify(salida))] };
      }
      throw new Error(`Modelo simulado: agente no previsto (herramientas: ${herramientas.join(', ')})`);
    },
    getStreamedResponse() {
      throw new Error('Modelo simulado: no se usa streaming');
    },
  };
}

/** Registro de llamadas al modelo, compartido por todas las pruebas del fichero. */
const registro: Registro[] = [];
const modeloUnico = sdk ? crearModelo(registro) : null;
let proveedorInstalado = false;

/* ---------- entorno simulado (sin red, sin credenciales reales) ---------- */

const ENTORNO = {
  APIFY_API_TOKEN: 'token-apify-de-prueba-no-real',
  UPSTASH_REDIS_REST_URL: 'https://redis-de-prueba.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'token-de-prueba-no-real',
};
const VARIABLES_A_QUITAR: string[] = [];

interface Llamada { consulta: string }

async function prepararEntorno(opciones: { barrera?: number } = {}) {
  const previo: Record<string, string | undefined> = {};
  for (const k of [...Object.keys(ENTORNO), ...VARIABLES_A_QUITAR]) previo[k] = process.env[k];
  Object.assign(process.env, ENTORNO);
  for (const k of VARIABLES_A_QUITAR) delete process.env[k];

  const fetchOriginal = globalThis.fetch;
  const llamadas: Llamada[] = [];
  const rechazadas: string[] = [];
  // Barrera opcional: las N primeras peticiones esperan a que todas hayan llegado, de modo que las corridas se solapan de verdad.
  let llegadas = 0;
  let liberar: () => void = () => {};
  const puerta = new Promise<void>((r) => { liberar = r; });
  const temporizador = opciones.barrera ? setTimeout(liberar, 5000) : undefined;
  globalThis.fetch = (async (entrada: any) => {
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada?.url ?? String(entrada)));
    rechazadas.push(url.toString());
    throw new Error(`Red bloqueada en la prueba: ${url.hostname}`);
  }) as typeof fetch;
  // Cliente de Apify simulado: registra la consulta (con la que viaja el destino) y falla con ella en el detalle.
  const { fijarDependenciasHoteles } = await import('../src/services/hoteles.js');
  fijarDependenciasHoteles({
    apify: {
      token: 't',
      env: {},
      registrar: () => {},
      crearCliente: () => ({
        actor: () => ({
          call: async (entradaActor: any) => {
            const consulta = String(entradaActor?.searchQueries?.[0] ?? '');
            llamadas.push({ consulta });
            if (opciones.barrera && llegadas < opciones.barrera) {
              llegadas += 1;
              if (llegadas === opciones.barrera) liberar();
              await puerta;
            }
            throw Object.assign(new Error(`consulta=${consulta}`), { statusCode: 500 });
          },
        }),
        dataset: () => ({ listItems: async () => ({ items: [] }) }),
      }) as any,
    },
  });

  sdk.setTracingDisabled(true);
  // El Runner por defecto del SDK memoriza el primer proveedor que usa (LazyDefaultModelProvider en run.ts): el modelo y su proveedor
  // se crean una sola vez y el registro compartido se vacía antes de cada prueba.
  registro.length = 0;
  if (!proveedorInstalado) {
    sdk.setDefaultModelProvider({ getModel: () => modeloUnico });
    proveedorInstalado = true;
  }
  const { travelAgent } = await import('../src/index.js');

  return {
    travelAgent,
    registro,
    llamadas,
    rechazadas,
    restaurar() {
      if (temporizador) clearTimeout(temporizador);
      fijarDependenciasHoteles(undefined);
      globalThis.fetch = fetchOriginal;
      for (const [k, v] of Object.entries(previo)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

/** Ejecuta Travel Manager y devuelve el campo `error` que el proveedor produjo (lleva el destino y el país que recibió). */
async function ejecutar(travelAgent: any, texto: string, seleccionado: unknown): Promise<{ error: string; salida: any }> {
  const resultado = await conDestinoFijado(seleccionado, () => sdk.run(travelAgent, texto));
  const salida = JSON.parse(String(resultado.finalOutput));
  return { error: String(salida.error ?? ''), salida };
}

/* ---------- pruebas ---------- */

test('SDK real: sin destino fijado el modelo manda (control), con Apulia elegido llega «Salento, Apulia, Italia» al proveedor', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const control = await ejecutar(e.travelAgent, 'Hoteles en Salento', undefined);
    assert.match(control.error, /consulta=hotels in Salento$/, 'control: sin destino fijado, el proveedor recibe lo que escribió el modelo');
    assert.doesNotMatch(control.error, /Apulia|Italia/);

    const fijado = await ejecutar(e.travelAgent, 'Hoteles en Salento', APULIA);
    assert.match(fijado.error, /consulta=hotels in Salento, Apulia, Italia$/);

    // La corrida pasó realmente por el agente anidado: 2 llamadas del manager y 2 del Hotel Agent por ejecución.
    assert.equal(e.registro.filter((r) => r.agente === 'manager').length, 4);
    assert.equal(e.registro.filter((r) => r.agente === 'hotel').length, 4);
    assert.deepEqual(e.rechazadas, [], 'ninguna petición de red directa');
    assert.ok(e.llamadas.length > 0);
  } finally {
    e.restaurar();
  }
});

test('SDK real: el modelo escribe «Salento, Colombia» pero el usuario eligió Apulia → conserva Apulia (y al revés con Quindío)', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const a = await ejecutar(e.travelAgent, 'Hoteles en Salento, Colombia', APULIA);
    assert.match(a.error, /consulta=hotels in Salento, Apulia, Italia$/);
    const q = await ejecutar(e.travelAgent, 'Hoteles en Salento, Italia', QUINDIO);
    assert.match(q.error, /consulta=hotels in Salento, Quindío, Colombia$/);
    assert.ok(e.registro.some((r) => r.destinoEscritoPorElModelo === 'Salento, Colombia'), 'el modelo escribió realmente otro destino');
  } finally {
    e.restaurar();
  }
});

test('SDK real: dos corridas concurrentes con destinos distintos no mezclan su contexto', { skip: OMITIR }, async () => {
  const e = await prepararEntorno({ barrera: 2 });
  try {
    // Mismo texto del modelo en ambas; solo difiere el destino elegido. La barrera mantiene las dos corridas en vuelo a la vez.
    const [a, b] = await Promise.all([
      ejecutar(e.travelAgent, 'Hoteles en Salento', APULIA),
      ejecutar(e.travelAgent, 'Hoteles en Salento', QUINDIO),
    ]);
    assert.match(a.error, /consulta=hotels in Salento, Apulia, Italia$/);
    assert.doesNotMatch(a.error, /Quindío|Colombia/);
    assert.match(b.error, /consulta=hotels in Salento, Quindío, Colombia$/);
    assert.doesNotMatch(b.error, /Apulia|Italia/);
    assert.deepEqual(e.rechazadas, []);
  } finally {
    e.restaurar();
  }
});

test('SDK real: muchas corridas concurrentes alternando Apulia, Quindío y sin destino fijado', { skip: OMITIR }, async () => {
  const e = await prepararEntorno({ barrera: 6 });
  try {
    const casos: Array<[unknown, RegExp, RegExp]> = [
      [APULIA, /consulta=hotels in Salento, Apulia, Italia$/, /Italia/],
      [QUINDIO, /consulta=hotels in Salento, Quindío, Colombia$/, /Colombia/],
      [undefined, /consulta=hotels in Salento$/, /^(?![\s\S]*Apulia)(?![\s\S]*Quindío)/],
    ];
    const lote = [...casos, ...casos];
    const resultados = await Promise.all(lote.map(([sel]) => ejecutar(e.travelAgent, 'Hoteles en Salento', sel)));
    resultados.forEach((r, i) => {
      assert.match(r.error, lote[i]![1], `corrida ${i}`);
      assert.match(r.error, lote[i]![2], `corrida ${i}`);
    });
  } finally {
    e.restaurar();
  }
});

test('SDK real: tras terminar las corridas no queda destino fijado en el contexto global', { skip: OMITIR }, async () => {
  const { destinoFijadoActual } = await import('../src/services/destino-fijado.js');
  const e = await prepararEntorno();
  try {
    await ejecutar(e.travelAgent, 'Hoteles en Salento', APULIA);
    assert.equal(destinoFijadoActual(), undefined);
  } finally {
    e.restaurar();
  }
});
