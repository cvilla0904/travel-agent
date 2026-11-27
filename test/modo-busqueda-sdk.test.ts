// Modo de búsqueda con el SDK REAL (@openai/agents): el modo elegido en la web llega hasta el Travel Manager y decide qué
// agentes especializados pueden ejecutarse. Se comprueba el comportamiento del flujo de agentes, no solo que una función reciba un valor.
//
// QUÉ ES REAL: @openai/agents (Runner, Agent.asTool, Agent.clone, ejecución de herramientas anidadas), los agentes de
//   src/index.ts (travelAgent y agenteParaModo), la herramienta buscar_actividades → apify.ts (con el input real que se
//   enviaría al actor), el colector de resultados estructurados y el manejador HTTP real de api/index.ts (Express).
// QUÉ ESTÁ SIMULADO: (1) el modelo de lenguaje: un `Model` sin estado que, en el Travel Manager, INTENTA llamar a todas las
//   herramientas de agente que tenga disponibles (es el peor caso: un modelo que quisiera buscar de todo) y en cada agente
//   especializado responde de forma determinista; (2) el cliente de Apify (no hay red ni créditos); (3) Upstash Redis (un
//   servidor REST en memoria). Lo que NO se puede comprobar sin un modelo real es que el LLM obedezca las instrucciones de modo
//   (p. ej. no pedir fechas): aquí se comprueba que recibe esas instrucciones y que solo dispone de las herramientas de su modo.
//
// Si @openai/agents no está instalado (entorno sin dependencias) la prueba se omite; se ejecuta en CI (npm ci).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { turnoChat } from '../src/services/chat-contrato.ts';
import { establecerClienteApify } from '../src/services/apify.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
let sdk: any = null;
try { sdk = await import('@openai/agents'); } catch { sdk = null; }
const OMITIR: string | false = sdk ? false : 'SDK @openai/agents no instalado en este entorno: se ejecuta en CI';

const BRUSELAS = { nombre: 'Brussels', pais: 'Bélgica', codigoPais: 'BE', region: '', id: 'gn:2800866', tipo: 'ciudad' };
const TOOLS_AGENTE = ['flight_agent', 'hotel_agent', 'activities_agent'];

/* ---------- utilidades del modelo simulado ---------- */

const textoDeItem = (item: any): string => {
  const c = item?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
  return '';
};
const itemsDe = (request: any): any[] => (Array.isArray(request.input) ? request.input : [{ role: 'user', content: String(request.input ?? '') }]);
/** Resultado de una herramienta en el TURNO ACTUAL: solo cuentan los elementos posteriores al último mensaje del usuario (el historial de la sesión trae los de turnos anteriores). */
const resultadoDe = (request: any, herramienta: string): any => {
  const items = itemsDe(request);
  const ultimoUsuario = items.map((i) => i?.role).lastIndexOf('user');
  return items.slice(ultimoUsuario + 1).filter((i) => i?.type === 'function_call_result' && i?.name === herramienta).at(-1);
};
const textoSalida = (item: any): string => {
  const o = item?.output;
  if (typeof o === 'string') return o;
  if (Array.isArray(o)) return o.map((p: any) => p?.text ?? '').join('');
  return String(o?.text ?? '');
};
const llamada = (name: string, args: Record<string, unknown>, callId: string) => ({
  type: 'function_call', name, callId, id: callId, status: 'completed', arguments: JSON.stringify(args),
});
const mensaje = (text: string) => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });

interface Registro { rol: 'manager' | 'vuelos' | 'hoteles' | 'actividades'; herramientas: string[]; instrucciones: string }

const SALIDA_VUELOS = {
  origen: '', destino: '', aeropuertoDestino: '', aeropuertoOrigen: '', fechaIda: '', fechaVuelta: '', pasajeros: 0,
  estado: 'sin_resultados', error: null, direccionesConError: [], avisos: [], vuelos: [],
};
const SALIDA_HOTELES = {
  destino: 'Brussels', fechaEntrada: '', fechaSalida: '', adultos: 2, proveedor: 'Google Hotels (Apify)',
  estado: 'sin_resultados', error: null, codigoError: null, httpStatus: null, retryAfter: null, detalleProveedor: null, etapaError: null,
  diagnostico: { destinoResuelto: '', propiedadesProveedor: 0, devueltos: 0, conPrecio: 0, sinPrecio: 0, conEnlace: 0 }, hoteles: [],
};

function crearModelo(registro: Registro[]) {
  return {
    async getResponse(request: any) {
      const herramientas: string[] = (request.tools ?? []).map((t: any) => t.name);
      const instrucciones = String(request.systemInstructions ?? '');
      const usage = new sdk.Usage();
      const agentesDisponibles = herramientas.filter((n) => TOOLS_AGENTE.includes(n));

      // Travel Manager: quiere buscar de todo; solo puede llamar a los agentes que tiene como herramienta.
      if (agentesDisponibles.length > 0) {
        registro.push({ rol: 'manager', herramientas, instrucciones });
        const pendientes = agentesDisponibles.filter((n) => !resultadoDe(request, n));
        if (pendientes.length > 0) {
          return { usage, output: pendientes.map((n, i) => llamada(n, { input: 'Busca en Bruselas' }, `m-${registro.length}-${i}`)) };
        }
        return { usage, output: [mensaje('Resumen del Travel Manager')] };
      }
      // Agentes especializados (se reconocen por su herramienta de proveedor).
      if (herramientas.includes('buscar_vuelos')) {
        registro.push({ rol: 'vuelos', herramientas, instrucciones });
        return { usage, output: [mensaje(JSON.stringify(SALIDA_VUELOS))] };
      }
      if (herramientas.includes('buscar_hoteles')) {
        registro.push({ rol: 'hoteles', herramientas, instrucciones });
        return { usage, output: [mensaje(JSON.stringify(SALIDA_HOTELES))] };
      }
      if (herramientas.includes('buscar_actividades')) {
        registro.push({ rol: 'actividades', herramientas, instrucciones });
        const previo = resultadoDe(request, 'buscar_actividades');
        if (!previo) return { usage, output: [llamada('buscar_actividades', { destino: 'Bruselas', tipos: ['cultura'] }, `a-${registro.length}`)] };
        const r = JSON.parse(textoSalida(previo));
        return { usage, output: [mensaje(JSON.stringify({
          destino: r.destino, estado: r.estado, motivo: r.motivo ?? null, mensaje: r.mensaje ?? null,
          diagnosticoBusqueda: r.diagnosticoBusqueda, actividades: r.actividades,
        }))] };
      }
      throw new Error(`Modelo simulado: agente no previsto (herramientas: ${herramientas.join(', ')})`);
    },
    getStreamedResponse() { throw new Error('Modelo simulado: no se usa streaming'); },
  };
}

const registro: Registro[] = [];
const modeloUnico = sdk ? crearModelo(registro) : null;
let proveedorInstalado = false;

/* ---------- entorno simulado ---------- */

const ENTORNO = {
  APIFY_API_TOKEN: 'token-apify-de-prueba-no-real',
  UPSTASH_REDIS_REST_URL: 'https://redis-de-prueba.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'token-de-prueba-no-real',
};

const ITEMS_CIVITATIS = [
  { title: 'Atomium y Mini-Europa', url: 'https://www.civitatis.com/es/bruselas/atomium/', platform: 'civitatis', priceFrom: 20, city: 'Brussels', latitude: 50.8949, longitude: 4.3415 },
];

/** Registro de lo que se enviaría al actor de Apify de actividades. */
interface LlamadaActor { actor: string; input: any; opciones: any }

async function prepararEntorno() {
  const previo: Record<string, string | undefined> = {};
  for (const k of Object.keys(ENTORNO)) previo[k] = process.env[k];
  Object.assign(process.env, ENTORNO);
  const llamadasActor: LlamadaActor[] = [];
  establecerClienteApify(() => ({
    actor: (actor: string) => ({
      call: async (input: any, opciones: any) => {
        llamadasActor.push({ actor, input, opciones });
        return { status: 'SUCCEEDED', id: 'run-falso', defaultDatasetId: 'dataset-falso' };
      },
    }),
    dataset: () => ({ listItems: async () => ({ items: ITEMS_CIVITATIS }) }),
  }));
  sdk.setTracingDisabled(true);
  registro.length = 0;
  if (!proveedorInstalado) {
    sdk.setDefaultModelProvider({ getModel: () => modeloUnico });
    proveedorInstalado = true;
  }
  const { agenteParaModo, travelAgent } = await import('../src/index.ts');
  return {
    agenteParaModo, travelAgent, llamadasActor,
    restaurar() {
      establecerClienteApify(undefined);
      for (const [k, v] of Object.entries(previo)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    },
  };
}

const roles = (r: Registro[]) => [...new Set(r.map((x) => x.rol))].sort();

/** Un turno exactamente como lo ejecuta api/index.ts: destino fijado + colector de resultados + agente del modo. */
const turno = (agente: any, texto = 'Busca en Bruselas') =>
  turnoChat(BRUSELAS, () => sdk.run(agente, texto));

/* ---------- los cuatro modos con el SDK real ---------- */

test('SDK real, modo activities: solo se activa el agente de actividades y el actor recibe Civitatis', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const agente = e.agenteParaModo('activities');
    assert.deepEqual(agente.tools.map((t: any) => t.name), ['activities_agent'], 'el Travel Manager solo dispone de actividades');
    const r = await turno(agente);
    assert.equal(r.status, 200);
    assert.deepEqual(roles(registro), ['actividades', 'manager'], 'ni vuelos ni hoteles se ejecutan, aunque el modelo quería buscarlos');
    const manager = registro.find((x) => x.rol === 'manager')!;
    assert.match(manager.instrucciones, /SOLO ACTIVIDADES/);
    assert.match(manager.instrucciones, /NO pidas ciudad de origen, número de viajeros ni presupuesto/);
    assert.match(manager.instrucciones, /Eres el Travel Manager/, 'conserva las instrucciones base');
    // El actor real se invoca una sola vez, solo con Civitatis y con el límite de gasto.
    assert.equal(e.llamadasActor.length, 1);
    assert.deepEqual(e.llamadasActor[0]!.input.platforms, ['civitatis']);
    assert.equal(e.llamadasActor[0]!.opciones.maxTotalChargeUsd, 0.1);
    // Resultados estructurados: llegan actividades y ninguna otra categoría.
    const res: any = (r.body as any).resultados;
    assert.equal(res.actividades.length, 1);
    assert.equal(res.actividades[0].opciones[0].nombre, 'Atomium y Mini-Europa');
    assert.deepEqual([res.vuelos.length, res.hoteles.length], [0, 0]);
  } finally { e.restaurar(); }
});

test('SDK real, modo hotels: solo se activa el agente de hoteles', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const agente = e.agenteParaModo('hotels');
    assert.deepEqual(agente.tools.map((t: any) => t.name), ['hotel_agent']);
    await turno(agente);
    assert.deepEqual(roles(registro), ['hoteles', 'manager']);
    assert.match(registro.find((x) => x.rol === 'manager')!.instrucciones, /SOLO HOTELES[\s\S]*NO pidas ciudad de origen/);
    assert.equal(e.llamadasActor.length, 0, 'ninguna llamada al actor de actividades');
  } finally { e.restaurar(); }
});

test('SDK real, modo flights: solo se activa el agente de vuelos', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const agente = e.agenteParaModo('flights');
    assert.deepEqual(agente.tools.map((t: any) => t.name), ['flight_agent']);
    await turno(agente);
    assert.deepEqual(roles(registro), ['manager', 'vuelos']);
    assert.match(registro.find((x) => x.rol === 'manager')!.instrucciones, /SOLO VUELOS[\s\S]*origen, destino, fecha de ida/);
    assert.equal(e.llamadasActor.length, 0);
  } finally { e.restaurar(); }
});

test('SDK real, modo complete: el Travel Manager de siempre (mismo agente, todas las herramientas, sin bloque de modo)', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    assert.equal(e.agenteParaModo('complete'), e.travelAgent, 'complete devuelve el agente original, sin copia');
    assert.equal(e.agenteParaModo(), e.travelAgent, 'sin modo = complete');
    const nombres = e.travelAgent.tools.map((t: any) => t.name);
    for (const n of TOOLS_AGENTE) assert.ok(nombres.includes(n), `herramienta ${n}`);
    assert.ok(nombres.length > TOOLS_AGENTE.length, 'además de los tres agentes conserva sus demás herramientas');
    await turno(e.agenteParaModo('complete'));
    assert.deepEqual(roles(registro), ['actividades', 'hoteles', 'manager', 'vuelos'], 'complete mantiene la búsqueda integral');
    const manager = registro.find((x) => x.rol === 'manager')!;
    assert.doesNotMatch(manager.instrucciones, /MODO DE BÚSQUEDA/);
  } finally { e.restaurar(); }
});

test('el agente de cada modo exclusivo es una copia: no modifica ni el Travel Manager original ni los demás modos', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const antes = e.travelAgent.tools.map((t: any) => t.name).join(',');
    const a = e.agenteParaModo('activities');
    const h = e.agenteParaModo('hotels');
    assert.notEqual(a, e.travelAgent);
    assert.notEqual(a, h);
    assert.equal(e.agenteParaModo('activities'), a, 'se reutiliza');
    assert.equal(e.travelAgent.tools.map((t: any) => t.name).join(','), antes);
    assert.doesNotMatch(String(e.travelAgent.instructions), /MODO DE BÚSQUEDA/);
  } finally { e.restaurar(); }
});

/* ---------- HTTP real: /api/chat de api/index.ts (Express) con Redis simulado ---------- */

/** Servidor REST mínimo compatible con @upstash/redis (respuestas en base64 si el cliente lo pide). */
function crearRedisSimulado() {
  const datos = new Map<string, string>();
  const comandos: string[][] = [];
  const codificar = (v: unknown) => (typeof v === 'string' ? Buffer.from(v, 'utf8').toString('base64') : v);
  const manejar = (cuerpo: any, base64: boolean) => {
    const cmd = (Array.isArray(cuerpo) ? cuerpo : []).map(String);
    comandos.push(cmd);
    const op = (cmd[0] ?? '').toLowerCase();
    let result: unknown = null;
    if (op === 'get') result = datos.get(cmd[1]!) ?? null;
    else if (op === 'set') { datos.set(cmd[1]!, cmd[2]!); result = 'OK'; }
    return { result: base64 ? codificar(result) : result };
  };
  return { datos, comandos, manejar };
}

async function conServidorHttp<T>(fn: (post: (cuerpo: any) => Promise<{ status: number; json: any }>) => Promise<T>): Promise<{ valor: T; redis: ReturnType<typeof crearRedisSimulado> }> {
  const redis = crearRedisSimulado();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (entrada: any, init?: any) => {
    const url = new URL(typeof entrada === 'string' ? entrada : (entrada?.url ?? String(entrada)));
    if (url.hostname === 'redis-de-prueba.invalid') {
      const base64 = String(init?.headers?.['Upstash-Encoding'] ?? new Headers(init?.headers).get('Upstash-Encoding') ?? '') === 'base64';
      const cuerpo = JSON.parse(String(init?.body ?? '[]'));
      // El cliente agrupa los comandos en un pipeline (cuerpo = lista de comandos → respuesta = lista de resultados).
      const respuesta = Array.isArray(cuerpo[0]) ? cuerpo.map((c: unknown) => redis.manejar(c, base64)) : redis.manejar(cuerpo, base64);
      return new Response(JSON.stringify(respuesta), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === '127.0.0.1') return fetchOriginal(entrada, init);
    throw new Error(`Red bloqueada en la prueba: ${url.hostname}`);
  }) as typeof fetch;
  const { default: app } = await import('../api/index.ts');
  const servidor = http.createServer(app);
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as any).port;
  const post = async (cuerpo: any) => {
    const r = await fetchOriginal(`http://127.0.0.1:${puerto}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
    return { status: r.status, json: await r.json() };
  };
  try {
    return { valor: await fn(post), redis };
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
}

test('HTTP real: «activities» enviado por la web activa solo actividades y el modo se mantiene en un seguimiento SIN modo', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const { valor } = await conServidorHttp(async (post) => {
      const sessionId = 'sesion-modo-actividades';
      const t1 = await post({ message: 'Quiero viajar a Brussels, Bélgica para 2 personas', sessionId, modo: 'activities', destinoSeleccionado: BRUSELAS });
      const roles1 = roles(registro);
      registro.length = 0;
      // Turno posterior: el cliente no repite el modo (p. ej. un cliente antiguo); el servidor conserva el de la sesión.
      const t2 = await post({ message: 'Y ahora busca también vuelos y hoteles', sessionId, destinoSeleccionado: BRUSELAS });
      return { t1, roles1, t2, roles2: roles(registro) };
    });
    assert.equal(valor.t1.status, 200);
    assert.deepEqual(valor.roles1, ['actividades', 'manager']);
    assert.equal(valor.t1.json.resultados.actividades.length, 1);
    assert.equal(valor.t2.status, 200);
    assert.deepEqual(valor.roles2, ['actividades', 'manager'], 'el seguimiento sigue siendo solo de actividades: no hay vuelos ni hoteles accidentales');
    assert.equal(e.llamadasActor.length, 2, 'una llamada al actor por turno, ninguna a otros proveedores');
  } finally { e.restaurar(); }
});

test('HTTP real: el modo enviado en cada turno prevalece y un modo no válido se rechaza con 400 sin ejecutar agentes', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const { valor } = await conServidorHttp(async (post) => {
      const malo = await post({ message: 'hola', sessionId: 's-malo', modo: 'todo' });
      const rolesTrasMalo = roles(registro);
      const h = await post({ message: 'Hoteles', sessionId: 's-mixto', modo: 'hotels', destinoSeleccionado: BRUSELAS });
      const rolesH = roles(registro);
      registro.length = 0;
      const f = await post({ message: 'Vuelos', sessionId: 's-mixto', modo: 'flights', destinoSeleccionado: BRUSELAS });
      return { malo, rolesTrasMalo, h, rolesH, f, rolesF: roles(registro) };
    });
    assert.equal(valor.malo.status, 400);
    assert.match(valor.malo.json.error, /Modo de búsqueda no válido/);
    assert.deepEqual(valor.rolesTrasMalo, [], 'un modo no válido no ejecuta ningún agente');
    assert.deepEqual(valor.rolesH, ['hoteles', 'manager']);
    assert.deepEqual(valor.rolesF, ['manager', 'vuelos']);
    assert.equal(e.llamadasActor.length, 0);
  } finally { e.restaurar(); }
});

test('HTTP real: sin modo (cliente anterior) el comportamiento es el integral de siempre', { skip: OMITIR }, async () => {
  const e = await prepararEntorno();
  try {
    const { valor } = await conServidorHttp(async (post) => {
      const r = await post({ message: 'Viaje a Bruselas', sessionId: 's-complete', destinoSeleccionado: BRUSELAS });
      return { r, roles: roles(registro) };
    });
    assert.equal(valor.r.status, 200);
    assert.deepEqual(valor.roles, ['actividades', 'hoteles', 'manager', 'vuelos']);
  } finally { e.restaurar(); }
});

