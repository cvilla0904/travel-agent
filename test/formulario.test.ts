import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// La lógica vive en index.html (frontend estático). Se extrae el bloque delimitado y el catálogo real de ciudades
// y se ejecutan sin DOM, de modo que se prueba el código que se despliega, no una copia.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bloque = /\/\* === COMPOSICION_PETICION:INICIO === \*\/([\s\S]*?)\/\* === COMPOSICION_PETICION:FIN === \*\//.exec(html);
const catalogo = /const ciudadesMogavel = (\[[\s\S]*?\n    \]);/.exec(html);
assert.ok(bloque, 'bloque COMPOSICION_PETICION no encontrado en index.html');
assert.ok(catalogo, 'catálogo ciudadesMogavel no encontrado en index.html');

interface Aclaracion { campo: string; formulario: string; texto: string }
interface Peticion { estado: 'ok' | 'aclaracion'; fuente: string; mensaje: string; aclaraciones: Aclaracion[] }
const cargar = new Function(`${bloque![1]}; return { componerPeticionViaje, textoAclaracionViaje };`) as () => {
  componerPeticionViaje: (entrada: Record<string, unknown>, ciudades: unknown[]) => Peticion;
  textoAclaracionViaje: (a: Aclaracion[]) => string;
};
const ciudades = new Function(`return ${catalogo![1]};`)() as unknown[];
const { componerPeticionViaje, textoAclaracionViaje } = cargar();
const componer = (entrada: Record<string, unknown>) => componerPeticionViaje(entrada, ciudades);

const FORM = { origen: 'Madrid', destino: 'Florencia', ida: '2026-12-10', vuelta: '2026-12-13', viajeros: '2', presupuesto: '1500', preferencias: ['cultura'] };

test('formulario solo: misma frase que antes, una única petición con todos los datos', () => {
  const r = componer({ ...FORM, idea: '', viajerosTocado: false });
  assert.equal(r.estado, 'ok');
  assert.equal(r.fuente, 'formulario');
  assert.equal(
    r.mensaje,
    'Quiero viajar de Madrid a Florencia del 2026-12-10 al 2026-12-13 para 2 personas con un presupuesto total de 1500 euros y me interesan actividades relacionadas con cultura',
  );
});

test('texto libre solo: se envía tal cual (interpretación actual del agente) y se ignora el valor por defecto de viajeros', () => {
  const r = componer({ idea: 'Quiero un viaje tranquilo a Lisboa en mayo', viajeros: '2', viajerosTocado: false });
  assert.equal(r.fuente, 'texto');
  assert.equal(r.mensaje, 'Quiero un viaje tranquilo a Lisboa en mayo');
  assert.deepEqual(r.aclaraciones, []);
});

test('formulario + preferencias en texto libre: una sola petición que conserva todos los datos y el texto íntegro', () => {
  const idea = 'Me gustaría comer bien, pasear por la naturaleza y un ritmo tranquilo';
  const r = componer({ ...FORM, idea, viajerosTocado: false });
  assert.equal(r.estado, 'ok');
  assert.equal(r.fuente, 'mixto');
  for (const dato of ['de Madrid', 'a Florencia', '2026-12-10', '2026-12-13', 'para 2 personas', '1500 euros', 'cultura', idea]) {
    assert.ok(r.mensaje.includes(dato), `falta "${dato}" en: ${r.mensaje}`);
  }
  assert.match(r.mensaje, /Preferencias e instrucciones adicionales del usuario \(complementan los datos del formulario\): Me gustaría/);
  assert.equal(r.mensaje.split('Preferencias e instrucciones adicionales').length, 2, 'una sola petición');
  assert.deepEqual(r.aclaraciones, []);
});

test('texto libre que repite o amplía los datos del formulario no es contradicción', () => {
  for (const idea of [
    'Quiero ir a Florencia y también ver Pisa',
    'Saliendo desde Madrid, con mucha gastronomía',
    'Del 10 al 13 de diciembre de 2026, algo cultural',
    'El 11 de diciembre quiero visitar los Uffizi',
    'Somos 2 y preferimos hoteles céntricos',
    'Viaje de 3-4 días, ritmo relajado',
  ]) {
    const r = componer({ ...FORM, idea, viajerosTocado: true });
    assert.equal(r.estado, 'ok', `${idea} -> ${JSON.stringify(r.aclaraciones)}`);
    assert.ok(r.mensaje.includes(idea));
  }
});

test('destino contradictorio: pide aclaración, no genera petición y no descarta ninguno de los dos valores', () => {
  const r = componer({ ...FORM, idea: 'Quiero ir a Roma con buena gastronomía', viajerosTocado: false });
  assert.equal(r.estado, 'aclaracion');
  assert.equal(r.mensaje, '');
  assert.deepEqual(r.aclaraciones, [{ campo: 'destino', formulario: 'Florencia', texto: 'Roma' }]);
  const aviso = textoAclaracionViaje(r.aclaraciones);
  assert.match(aviso, /Destino: formulario «Florencia» \/ texto «Roma»/);
  assert.match(aviso, /prefiero no elegir por ti/);
});

test('origen contradictorio: solo si el texto indica salida desde otra ciudad', () => {
  const r = componer({ ...FORM, idea: 'Saliendo desde Barcelona', viajerosTocado: false });
  assert.equal(r.estado, 'aclaracion');
  assert.deepEqual(r.aclaraciones.map(a => a.campo), ['origen']);
  // "desde Barcelona" sin origen en el formulario complementa, no contradice
  const sinOrigen = componer({ ...FORM, origen: '', idea: 'Saliendo desde Barcelona', viajerosTocado: false });
  assert.equal(sinOrigen.estado, 'ok');
});

test('fechas contradictorias: rango distinto, fecha fuera de rango o mes distinto', () => {
  for (const [idea, esperado] of [
    ['Del 12 al 15 de diciembre', '12/12 → 15/12'],
    ['Quiero estar el 24 de diciembre en Florencia', '24/12'],
    ['Mejor en marzo', 'mes 3'],
    ['Salgo el 15/01/2027', '15/01/2027'],
  ] as const) {
    const r = componer({ ...FORM, idea, viajerosTocado: false });
    assert.equal(r.estado, 'aclaracion', idea);
    assert.deepEqual(r.aclaraciones, [{ campo: 'fechas', formulario: '2026-12-10 → 2026-12-13', texto: esperado }], idea);
  }
  const iso = componer({ ...FORM, idea: 'Del 2026-11-01 al 2026-11-05', viajerosTocado: false });
  assert.equal(iso.estado, 'aclaracion');
});

test('viajeros: el valor por defecto no se considera dato del usuario; si lo ha cambiado y el texto difiere, se pide aclaración', () => {
  const sinTocar = componer({ ...FORM, idea: 'Somos 4 personas', viajerosTocado: false });
  assert.equal(sinTocar.estado, 'ok');
  assert.ok(!sinTocar.mensaje.includes('para 2 personas'), 'no se envía el 2 por defecto cuando el texto indica otro número');
  assert.ok(sinTocar.mensaje.includes('Somos 4 personas'));
  const tocado = componer({ ...FORM, idea: 'Somos cuatro personas', viajerosTocado: true });
  assert.equal(tocado.estado, 'aclaracion');
  assert.deepEqual(tocado.aclaraciones, [{ campo: 'viajeros', formulario: '2', texto: '4' }]);
  const igual = componer({ ...FORM, viajeros: '4', idea: 'Somos 4 personas', viajerosTocado: true });
  assert.equal(igual.estado, 'ok');
});

test('varias contradicciones se listan juntas (una sola aclaración)', () => {
  const r = componer({ ...FORM, idea: 'Quiero ir a Roma el 24 de diciembre, somos 5', viajerosTocado: true });
  assert.equal(r.estado, 'aclaracion');
  assert.deepEqual(r.aclaraciones.map(a => a.campo).sort(), ['destino', 'fechas', 'viajeros']);
});

test('campos opcionales y valores por defecto', () => {
  // Nada relleno (viajeros por defecto sin tocar): mensaje genérico, no "para 2 personas"
  assert.equal(componer({ viajeros: '2', viajerosTocado: false }).mensaje, 'Ayúdame a planear un viaje');
  assert.equal(componer({}).mensaje, 'Ayúdame a planear un viaje');
  // Solo destino
  assert.equal(componer({ destino: 'Roma', viajeros: '2' }).mensaje, 'Quiero viajar a Roma para 2 personas');
  // Una sola fecha: sin "al " colgando
  assert.equal(
    componer({ destino: 'Roma', ida: '2026-12-10', viajeros: '2' }).mensaje,
    'Quiero viajar a Roma con fecha de ida 2026-12-10 para 2 personas',
  );
  // Sin presupuesto ni preferencias: no aparecen
  const r = componer({ origen: 'Madrid', destino: 'Roma', ida: '2026-12-10', vuelta: '2026-12-13', viajeros: '3', viajerosTocado: true });
  assert.ok(!/presupuesto|interesan/.test(r.mensaje));
  assert.ok(r.mensaje.includes('para 3 personas'));
  // Solo preferencias marcadas
  assert.equal(componer({ preferencias: ['aventura', 'naturaleza'], viajeros: '2' }).mensaje, 'para 2 personas y me interesan actividades relacionadas con aventura, naturaleza');
  // Espacios y valores nulos
  assert.equal(componer({ idea: '   ', origen: null, destino: undefined, viajeros: '' }).mensaje, 'Ayúdame a planear un viaje');
  // Con texto libre y SIN viajeros tocados ni indicados en el texto, se mantiene el valor por defecto en la petición
  const mixto = componer({ destino: 'Roma', idea: 'Algo de naturaleza', viajeros: '2', viajerosTocado: false });
  assert.ok(mixto.mensaje.includes('para 2 personas'));
});

test('destino con país o código no genera falsos conflictos ("Florencia, Italia", "Madrid (MAD)")', () => {
  const r = componer({ origen: 'Madrid (MAD)', destino: 'Florencia, Italia', idea: 'Quiero ver Florencia y saliendo desde Madrid', viajeros: '2' });
  assert.equal(r.estado, 'ok');
});

test('cableado en buscarViaje: una sola composición, una sola llamada al agente, aclaración sin búsqueda ni sesión nueva', () => {
  const fn = /async function buscarViaje\(\) \{([\s\S]*?)\n    \}\n\n    function escapeHtml/.exec(html);
  assert.ok(fn, 'buscarViaje no encontrada');
  const cuerpo = fn![1]!;
  assert.equal((cuerpo.match(/componerPeticionViaje\(/g) || []).length, 1);
  assert.equal((cuerpo.match(/consultarAgente\(/g) || []).length, 1);
  assert.ok(cuerpo.indexOf('componerPeticionViaje(') < cuerpo.indexOf('iniciarNuevaBusqueda()'), 'primero se compone');
  const iAcl = cuerpo.indexOf("peticion.estado === 'aclaracion'");
  const iReturn = cuerpo.indexOf('return;', iAcl);
  assert.ok(iAcl > -1 && iReturn > iAcl && iReturn < cuerpo.indexOf('iniciarNuevaBusqueda()'), 'la aclaración sale antes de nueva sesión y de buscar');
  assert.match(cuerpo, /if \(busquedaEnCurso\) return;/);
  assert.match(cuerpo, /finally \{\s*busquedaEnCurso = false;/);
});

test('contrato del agente: la regla de "Preferencias e instrucciones adicionales" está en el prompt', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /Preferencias e instrucciones adicionales del\s+usuario/);
  assert.match(src, /NO elijas uno por tu\s+cuenta ni busques: pregunta al usuario/);
  assert.match(src, /única\s+búsqueda coherente/);
});

test('el texto libre #ideaViaje es visible (no oculto) y chatMessage sigue siendo el de seguimiento', () => {
  const idea = /<textarea id="ideaViaje"([^>]*)>/.exec(html);
  assert.ok(idea, '#ideaViaje no encontrado');
  assert.doesNotMatch(idea![1]!, /idea-hidden/);
  assert.match(idea![1]!, /placeholder=/);
  assert.match(html, /<textarea id="chatMessage"/);
  assert.match(html, /function enviarMensaje\(/);
});
