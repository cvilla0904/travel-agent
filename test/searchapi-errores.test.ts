import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buscarHotelesConEstado, clasificarError, limpiarSecretos } from '../src/services/searchapi.js';
import { hotelOutputSchema } from '../src/schemas/hotels.js';

// Respuestas SIMULADAS; no se llama a SearchAPI.
const CLAVE = 'clave-de-prueba-SECRETA-123456';
const base = { destino: 'Amsterdam', paisCodigo: 'nl', fechaEntrada: '2026-12-10', fechaSalida: '2026-12-13', adultos: 2 };

interface Fallo { status: number; cuerpo?: unknown; texto?: string; cabeceras?: Record<string, string>; etapa?: 'autocomplete' | 'booking' }

function fetchConFallo(fallo: Fallo) {
  const etapaFallo = fallo.etapa ?? 'booking';
  return (async (input: URL) => {
    const motor = new URL(String(input)).searchParams.get('engine');
    const falla = (motor === 'booking') === (etapaFallo === 'booking');
    if (!falla) {
      return new Response(
        JSON.stringify({ suggestions: [{ title: 'Amsterdam', label: 'Amsterdam, North Holland, Netherlands', dest_id: '-2140479', dest_type: 'city', country_code: 'nl' }] }),
        { status: 200 },
      );
    }
    const cuerpo = fallo.texto ?? (fallo.cuerpo === undefined ? '' : JSON.stringify(fallo.cuerpo));
    return new Response(cuerpo, { status: fallo.status, headers: fallo.cabeceras ?? {} });
  }) as unknown as typeof fetch;
}

async function ejecutar(fallo: Fallo) {
  const registros: string[] = [];
  const r = await buscarHotelesConEstado(base, {
    apiKey: CLAVE,
    fetch: fetchConFallo(fallo),
    registrar: (evento, datos) => registros.push(`${evento} ${JSON.stringify(datos)}`),
  });
  return { r, registros };
}

const AFIRMA_CUOTA = /mensual|agotad|cuota|cr[eé]ditos/i;

test('429 con Retry-After y evidencia de frecuencia -> limite_peticiones, conserva HTTP, cuerpo y Retry-After', async () => {
  const { r } = await ejecutar({ status: 429, cuerpo: { error: 'Rate limit exceeded: too many requests per second.' }, cabeceras: { 'Retry-After': '30' } });
  assert.equal(r.estado, 'error_proveedor');
  assert.equal(r.codigoError, 'limite_peticiones');
  assert.equal(r.httpStatus, 429);
  assert.equal(r.retryAfter, '30');
  assert.equal(r.etapaError, 'búsqueda');
  assert.match(r.detalleProveedor!, /too many requests/);
  assert.match(r.error!, /límite de frecuencia/);
  assert.match(r.error!, /Retry-After: 30 s/);
  assert.match(r.error!, /HTTP 429/);
  assert.doesNotMatch(r.error!, AFIRMA_CUOTA);
  assert.deepEqual(r.hoteles, []);
});

test('429 con Retry-After pero SIN evidencia en el cuerpo -> rechazo_sin_causa (Retry-After no basta para afirmar la causa)', async () => {
  const { r } = await ejecutar({ status: 429, cuerpo: {}, cabeceras: { 'retry-after': '120' } });
  assert.equal(r.codigoError, 'rechazo_sin_causa');
  assert.equal(r.retryAfter, '120');
  assert.match(r.error!, /Retry-After: 120 s/);
  assert.doesNotMatch(r.error!, AFIRMA_CUOTA);
  assert.doesNotMatch(r.error!, /frecuencia/);
});

test('Retry-After como fecha HTTP se conserva tal cual, sin calcular plazos', async () => {
  const fecha = 'Wed, 21 Oct 2026 07:28:00 GMT';
  const { r } = await ejecutar({ status: 429, cabeceras: { 'Retry-After': fecha } });
  assert.equal(r.retryAfter, fecha);
  assert.match(r.error!, /Retry-After: Wed, 21 Oct 2026 07:28:00 GMT\./);
});

test('respuesta que identifica explícitamente la cuota agotada -> limite_uso y cita el texto del proveedor', async () => {
  const detalle = 'You have exhausted your monthly search quota.';
  for (const status of [429, 402]) {
    const { r } = await ejecutar({ status, cuerpo: { error: detalle } });
    assert.equal(r.codigoError, 'limite_uso', String(status));
    assert.equal(r.httpStatus, status);
    assert.equal(r.detalleProveedor, detalle);
    assert.match(r.error!, /cuota o los créditos están agotados/);
    assert.ok(r.error!.includes(`«${detalle}»`), 'cita literal del proveedor');
  }
});

test('cuota explícita en un HTTP 200 con campo error -> limite_uso; otro error 200 no se atribuye a cuota', async () => {
  const cuota = await ejecutar({ status: 200, cuerpo: { error: 'Insufficient credits.' } });
  assert.equal(cuota.r.codigoError, 'limite_uso');
  assert.equal(cuota.r.httpStatus, 200);
  const otro = await ejecutar({ status: 200, cuerpo: { error: 'Invalid dest_id.' } });
  assert.equal(otro.r.codigoError, 'api');
  assert.doesNotMatch(otro.r.error!, AFIRMA_CUOTA);
});

test('429 sin información suficiente (cuerpo vacío, HTML, ambiguo o con evidencias contradictorias) -> mensaje neutral', async () => {
  const casos: Fallo[] = [
    { status: 429 },
    { status: 429, cuerpo: {} },
    { status: 429, texto: '<html><body>Too</body></html>' },
    { status: 429, cuerpo: { error: 'Request limit.' } },
    { status: 429, cuerpo: { error: 'Rate limit or quota problem.' } },
  ];
  for (const caso of casos) {
    const { r } = await ejecutar(caso);
    const id = JSON.stringify(caso);
    assert.equal(r.estado, 'error_proveedor', id);
    assert.equal(r.codigoError, 'rechazo_sin_causa', id);
    assert.equal(r.httpStatus, 429, id);
    assert.match(r.error!, /^SearchAPI ha rechazado temporalmente la petición con HTTP 429 \(búsqueda\); no se ha podido confirmar el motivo\./, id);
    assert.doesNotMatch(r.error!, AFIRMA_CUOTA, id);
    assert.doesNotMatch(r.error!, /frecuencia/, id);
  }
});

test('el fallo en el autocompletado también conserva etapa y diagnóstico', async () => {
  const { r } = await ejecutar({ status: 429, etapa: 'autocomplete' });
  assert.equal(r.etapaError, 'autocompletado');
  assert.equal(r.codigoError, 'rechazo_sin_causa');
  assert.match(r.error!, /\(autocompletado\)/);
});

test('401/403 se clasifican como autenticación; 500 como error genérico, sin atribuir cuota', async () => {
  assert.equal((await ejecutar({ status: 401 })).r.codigoError, 'autenticacion');
  assert.equal((await ejecutar({ status: 403 })).r.codigoError, 'autenticacion');
  const e500 = (await ejecutar({ status: 500, cuerpo: { error: 'Internal error' } })).r;
  assert.equal(e500.codigoError, 'api');
  assert.doesNotMatch(e500.error!, AFIRMA_CUOTA);
});

test('no se filtran claves ni tokens en mensajes, detalle ni registros', async () => {
  const cuerpo = { error: `Invalid api_key=${CLAVE} for Bearer abcdef1234567890 token: xyz987654321` };
  const { r, registros } = await ejecutar({ status: 429, cuerpo });
  const todo = [r.error, r.detalleProveedor, ...registros].join('\n');
  assert.ok(!todo.includes(CLAVE), 'la clave no aparece');
  assert.ok(!todo.includes('abcdef1234567890'), 'el Bearer no aparece');
  assert.ok(!todo.includes('xyz987654321'), 'el token no aparece');
  assert.match(todo, /\[REDACTED\]/);
  assert.equal(limpiarSecretos(`x ${CLAVE} y`, CLAVE), 'x [REDACTED] y');
});

test('el registro del error incluye clasificación, HTTP, Retry-After y etapa', async () => {
  const { registros } = await ejecutar({ status: 429, cabeceras: { 'Retry-After': '7' } });
  const linea = registros.find((l) => l.startsWith('error_proveedor'))!;
  assert.ok(linea);
  const datos = JSON.parse(linea.slice('error_proveedor '.length));
  assert.equal(datos.codigo, 'rechazo_sin_causa');
  assert.equal(datos.httpStatus, 429);
  assert.equal(datos.retryAfter, '7');
  assert.equal(datos.etapa, 'búsqueda');
});

test('clasificarError: solo clasifica con evidencia explícita', () => {
  assert.equal(clasificarError(429, ''), 'rechazo_sin_causa');
  assert.equal(clasificarError(429, 'Too many requests'), 'limite_peticiones');
  assert.equal(clasificarError(429, 'Monthly quota exceeded'), 'limite_uso');
  assert.equal(clasificarError(429, 'quota and rate limit'), 'rechazo_sin_causa');
  assert.equal(clasificarError(402, ''), 'rechazo_sin_causa');
  assert.equal(clasificarError(500, 'plan'), 'api');
});

test('la salida con el diagnóstico cumple el esquema del agente', async () => {
  for (const fallo of [{ status: 429 }, { status: 429, cuerpo: { error: 'quota exceeded' } }] as Fallo[]) {
    const { r } = await ejecutar(fallo);
    assert.doesNotThrow(() => hotelOutputSchema.parse(r));
  }
});

test('contrato del agente: el prompt transmite el diagnóstico y prohíbe inventar causas', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  for (const campo of ['codigoError', 'httpStatus', 'retryAfter', 'detalleProveedor', 'etapaError']) {
    assert.ok(src.includes(`"${campo}"`), `el agente de hoteles debe copiar ${campo}`);
  }
  assert.match(src, /NO deduzcas ni inventes causas ni plazos de recuperación/);
  assert.match(src, /Una hipótesis nunca se presenta como un hecho/);
  assert.match(src, /rechazo_sin_causa/);
  // multidestino: el diagnóstico llega al agente gestor
  assert.match(src, /diagnosticoErrorAlojamientos/);
  assert.match(src, /NO deduzcas ni inventes la causa/);
});

// ---- Falsos positivos y casos de clasificación de cuota / frecuencia ----
// Los textos son SIMULADOS: no son mensajes documentados de SearchAPI. Comprueban la lógica del clasificador.

test('mencionar créditos, mensualidad o saldo NO se interpreta como cuota agotada (429 -> neutral)', () => {
  const sinEvidencia = [
    'Check your credits at the dashboard.',
    'You have 169 searches remaining this month.',
    'Your monthly plan renews on 9 November.',
    'You have used 81 out of 250 credits.',
    'You have not exceeded your monthly quota.',
    'Quota usage: 12%.',
    'Request limit.',
    'Credits',
  ];
  for (const texto of sinEvidencia) {
    assert.equal(clasificarError(429, texto), 'rechazo_sin_causa', texto);
    assert.equal(clasificarError(402, texto), 'rechazo_sin_causa', texto);
  }
});

test('un mensaje de saldo no convierte un 429 en cuota agotada de extremo a extremo', async () => {
  const { r } = await ejecutar({ status: 429, cuerpo: { error: 'Check your credits at the dashboard.' } });
  assert.equal(r.codigoError, 'rechazo_sin_causa');
  assert.match(r.error!, /no se ha podido confirmar el motivo/);
  assert.doesNotMatch(r.error!, /agotad/i);
  assert.ok(r.error!.includes('«Check your credits at the dashboard.»'), 'el detalle del proveedor se conserva');
});

test('cuota agotada: solo con expresiones explícitas de agotamiento', () => {
  const explicitos = [
    'You have exhausted your monthly search quota.',
    'Insufficient credits.',
    'insufficient_credits',
    'quota_exceeded',
    'You are out of credits.',
    'You ran out of search credits.',
    'No credits remaining.',
    '0 credits left',
    'Your monthly limit has been reached.',
    'Monthly quota exceeded',
    'Credits exhausted',
  ];
  for (const texto of explicitos) {
    assert.equal(clasificarError(429, texto), 'limite_uso', texto);
    assert.equal(clasificarError(402, texto), 'limite_uso', texto);
  }
});

test('frecuencia: solo con expresiones explícitas, incluido el límite horario si el proveedor lo dice', () => {
  const explicitos = [
    'Rate limit exceeded: too many requests per second.',
    'Too many requests',
    'Hourly request limit reached.',
    'Hourly limit exceeded.',
    '100 requests per hour allowed.',
    'Please slow down.',
    'Rate limit exceeded. 169 searches remaining.', // mencionar búsquedas restantes no cambia la causa
  ];
  for (const texto of explicitos) {
    assert.equal(clasificarError(429, texto), 'limite_peticiones', texto);
  }
});

test('evidencias contradictorias o mezcladas -> neutral', () => {
  for (const texto of [
    'Rate limit exceeded: out of credits.',
    'Too many requests; monthly quota exceeded.',
    'Rate limit or quota problem.',
    'Rate limit. Check your credits.',
  ]) {
    assert.equal(clasificarError(429, texto), 'rechazo_sin_causa', texto);
  }
});

test('fuera de 429/402: solo la cuota explícita se clasifica como uso; el resto es genérico', () => {
  assert.equal(clasificarError(null, 'Insufficient credits.'), 'limite_uso');
  assert.equal(clasificarError(null, 'You have 169 credits remaining.'), 'api');
  assert.equal(clasificarError(null, 'Your monthly plan renews soon.'), 'api');
  assert.equal(clasificarError(500, 'Check your credits'), 'api');
  assert.equal(clasificarError(null, 'Invalid api_key'), 'autenticacion');
  assert.equal(clasificarError(401, ''), 'autenticacion');
});

test('los mensajes de falsos positivos conocidos no afirman agotamiento ni mensualidad', async () => {
  for (const texto of ['You have used 81 out of 250 credits.', 'Your monthly plan renews on 9 November.']) {
    const { r } = await ejecutar({ status: 429, cuerpo: { error: texto } });
    assert.equal(r.codigoError, 'rechazo_sin_causa', texto);
    // Fuera de la cita literal del proveedor, el mensaje no afirma cuota ni mensualidad.
    const sinCita = r.error!.replace(/«[^»]*»/g, '');
    assert.doesNotMatch(sinCita, AFIRMA_CUOTA, texto);
  }
});
