// Interpretación pura (sin DOM) del presupuesto, el itinerario y las secciones complementarias.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const codigo = fs.readFileSync(new URL('../public/render-conversacion.js', import.meta.url), 'utf8');
function cargar() {
  const ctx: any = { window: undefined };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx.MogavelConversacion;
}
const C = cargar();
const J = (x: any) => JSON.parse(JSON.stringify(x));

test('importes: cerrado, «desde», gratuito, pendiente y sin importe se distinguen sin inventar nada', () => {
  assert.equal(C.clasificarImporte('240 €'), 'cerrado');
  assert.equal(C.clasificarImporte('120 € por noche'), 'cerrado');
  assert.equal(C.clasificarImporte('Desde 62,10 EUR por persona'), 'desde');
  assert.equal(C.clasificarImporte('aprox. 30 €'), 'desde');
  assert.equal(C.clasificarImporte('GRATUITA'), 'gratis');
  assert.equal(C.clasificarImporte('Precio por confirmar'), 'pendiente');
  assert.equal(C.clasificarImporte('Por confirmar (unos 40 €)'), 'pendiente');
  assert.equal(C.clasificarImporte('3 h'), 'ninguno');
  assert.equal(C.clasificarImporte(''), 'ninguno');
});

test('análisis: reparte itinerario, presupuesto, complementarias y gastronomía; lo demás queda como «otro»', () => {
  const md = `Aquí tienes tu plan.\n\n## Tu itinerario\n### Día 1 · 2027-01-11\n- Coliseo · 3 h\n### Día 2\n- Vaticano · 2 h\n\n## Presupuesto\n- Vuelo: 240 €\n\n## Experiencias complementarias\n- Cena · 45 €\n\n## Gastronomía\n- Trattoria\n\n## Notas\nTexto libre`;
  const a = C.analizar(md);
  assert.deepEqual(J(a.secciones.map((s: any) => s.tipo)), ['itinerario', 'presupuesto', 'complementarias', 'gastronomia', 'otro']);
  assert.deepEqual(J(a.previo), ['Aquí tienes tu plan.', '']);
  // Los «Día N» pertenecen al itinerario (no abren secciones propias).
  assert.equal(a.secciones[0].lineas.filter((l: string) => /^###/.test(l)).length, 2);
});

test('presupuesto: «Total conocido: 240 €. Quedan importes pendientes…» → total 240 € y la frase sobrante se conserva', () => {
  const r = C.interpretarPresupuesto(['Total conocido: 240 €. Quedan importes pendientes de confirmar.']);
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].total, true);
  assert.equal(r.filas[0].valor, '240 €');
  assert.equal(r.filas[0].clase, 'cerrado');
  assert.deepEqual(J(r.sobrantes), ['Quedan importes pendientes de confirmar.']);
});

test('presupuesto: filas por viñetas y por tabla; el texto no interpretable no se pierde', () => {
  const r = C.interpretarPresupuesto([
    '- Vuelo Alfa: 240 €', '- **Hotel**: 120 € por noche', '- Coliseo: desde 62,10 EUR', '- Free tour: gratuita', '- Visita: precio por confirmar',
    '| Concepto | Importe |', '|---|---|', '| Seguro | 30 € |',
    'Esto es una aclaración sin importe.'
  ]);
  const por = (c: string) => r.filas.find((f: any) => f.concepto === c);
  assert.equal(por('Vuelo Alfa').clase, 'cerrado');
  assert.equal(por('Hotel').clase, 'cerrado');
  assert.equal(por('Coliseo').clase, 'desde');
  assert.equal(por('Free tour').clase, 'gratis');
  assert.equal(por('Visita').clase, 'pendiente');
  assert.equal(por('Seguro').valor, '30 €');
  assert.ok(r.sobrantes.includes('Esto es una aclaración sin importe.'));
  assert.ok(r.sobrantes.includes('Concepto · Importe'), 'la cabecera de la tabla tampoco se descarta');
});

test('itinerario: días con actividades, duración e importe tal cual; sin día, nada se interpreta', () => {
  const r = C.interpretarItinerario(['### Día 1 · 2027-01-11', '- Coliseo · 3 h · Desde 62,10 EUR', '- Paseo libre · Gratis', 'Comida libre', '### Día 2', '1. Vaticano — 2 h']);
  assert.equal(r.dias.length, 2);
  assert.equal(r.dias[0].titulo, '2027-01-11');
  assert.deepEqual(J(r.dias[0].items.map((i: any) => [i.nombre, i.clase, i.importe])), [['Coliseo', 'desde', '62,10 EUR'], ['Paseo libre', 'gratis', '']]);
  assert.deepEqual(J(r.dias[0].extra), ['Comida libre']);
  assert.equal(r.dias[1].items[0].nombre, 'Vaticano');
  const vacio = C.interpretarItinerario(['Texto sin días', '- algo']);
  assert.equal(vacio.dias.length, 0);
});

test('sin secciones reconocidas, renderizar devuelve null (el llamador muestra el texto completo)', () => {
  assert.equal(C.renderizar('Solo una respuesta normal sin secciones.', { document: {} }), null);
});
