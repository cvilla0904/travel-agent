// M2 (verificación con el SDK real): el destino elegido por el usuario llega a buscarHotelesConEstado a través de
//   run(Travel Manager) → herramienta hotel_agent (Agent.asTool, corrida anidada) → herramienta buscar_hoteles → proveedor,
// aunque el modelo escriba otro `destino`, y dos corridas concurrentes con destinos distintos no mezclan su contexto
// (AsyncLocalStorage en src/services/destino-fijado.ts).
//
// QUÉ ES REAL: @openai/agents (Runner, Agent.asTool, ejecución de herramientas), los agentes reales de src/index.ts
//   (travelAgent, hotelAgent, buscar_hoteles), hoteles.ts → searchapi.ts y destino-fijado.ts.
// QUÉ ESTÁ SIMULADO: (1) el modelo: un `Model` propio que responde con llamadas a herramientas deterministas, sin API de OpenAI;
//   (2) globalThis.fetch: solo atiende al autocompletado de SearchAPI (siempre sin sugerencias) y rechaza cualquier otro host,
//   de modo que no hay red ni créditos; (3) la clave de SearchAPI y las de Upstash son valores de prueba.
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
          error: typeof r.error === 'string' ? r.error : null,
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
  SEARCHAPI_API_KEY: 'clave-de-prueba-no-real',
  UPSTASH_REDIS_REST_URL: 'https://redis-de-prueba.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'token-de-prueba-no-real',
};
const VARIABLES_A_QUITAR = ['HOTELES_PROVEEDOR'];

interface Llamada { motor: string; q: string }

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
    if (url.hostname !== 'www.searchapi.io') {
      rechazadas.push(url.toString());
      throw new Error(`Red bloqueada en la prueba: ${url.hostname}`);
    }
    llamadas.push({ motor: url.searchParams.get('engine') ?? '', q: url.searchParams.get('q') ?? '' });
    if (opciones.barrera && llegadas < opciones.barrera) {
      llegadas += 1;
      if (llegadas === opciones.barrera) liberar();
      await puerta;
    }
    return new Response(JSON.stringify({ suggestions: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

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
    assert.match(control.error, /para "Salento"/, 'control: sin destino fijado, el proveedor recibe lo que escribió el modelo');
    assert.doesNotMatch(control.error, /Apulia|Italia/);

    const fijado = await ejecutar(e.travelAgent, 'Hoteles en Salento', APULIA);
    assert.match(fijado.error, /para "Salento, Apulia, Italia"/);
    assert.match(fijado.error, /país "it"/i);

    // La corrida pasó realmente por el agente anidado: 2 llamadas del manager y 2 del Hotel Agent por ejecución.
    assert.equal(e.registro.filter((r) => r.agente === 'manager').length, 4);
    assert.equal(e.registro.filter((r) => r.agente === 'hotel').length, 4);
    assert.deepEqual(e.rechazadas, [], 'ninguna petición fuera de SearchAPI simulado');
    assert.ok(e.llamadas.length > 0 && e.llamadas.every((l) => l.motor === 'booking_autocomplete'));
  } finally {
    e.restaurar();
  }
});

test('SDK real: el modelo escribe «Salento, Colombia» pero el usuario eligió Apulia → conserva Apulia (y al revés con Quindío)', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const a = await ejecutar(e.travelAgent, 'Hoteles en Salento, Colombia', APULIA);
    assert.match(a.error, /para "Salento, Apulia, Italia"/);
    assert.match(a.error, /país "it"/i);
    const q = await ejecutar(e.travelAgent, 'Hoteles en Salento, Italia', QUINDIO);
    assert.match(q.error, /para "Salento, Quindío, Colombia"/);
    assert.match(q.error, /país "co"/i);
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
    assert.match(a.error, /para "Salento, Apulia, Italia"/);
    assert.match(a.error, /país "it"/i);
    assert.doesNotMatch(a.error, /Quindío|Colombia/);
    assert.match(b.error, /para "Salento, Quindío, Colombia"/);
    assert.match(b.error, /país "co"/i);
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
      [APULIA, /para "Salento, Apulia, Italia"/, /país "it"/i],
      [QUINDIO, /para "Salento, Quindío, Colombia"/, /país "co"/i],
      [undefined, /para "Salento"/, /^(?![\s\S]*Apulia)(?![\s\S]*Quindío)/],
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
