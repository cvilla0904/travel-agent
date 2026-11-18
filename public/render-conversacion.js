/*
 * Mogavel — presentación de las respuestas del agente en la conversación de /resultados.html.
 *
 * Lee el markdown tal y como lo devuelve el agente (sin cambiar su contrato) y pinta, cuando lo
 * reconoce: presupuesto destacado, itinerario día a día, experiencias complementarias y gastronomía.
 * No inventa datos ni importes: solo reordena lo que el texto ya dice. Todo lo que no se interpreta
 * se muestra íntegro como texto (nunca se descarta contenido).
 *
 * Script clásico: expone `MogavelConversacion` { analizar, renderizar, clasificarImporte }.
 */
(function (global) {
  'use strict';

  var RE_IMPORTE = /(?:[€$£]\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|eur\b|euros?\b|usd\b|\$|£))/i;
  var RE_GRATIS = /\b(gratis|gratuit[oa]s?|sin coste|entrada libre)\b/i;
  var RE_PENDIENTE = /(por confirmar|pendiente|por determinar|sin precio|precio no disponible|consultar|no incluid[oa]|sin confirmar)/i;
  var RE_DESDE = /\b(desde|a partir de|aprox(?:imadamente|\.)?|estimad[oa]|alrededor de|aproximad[oa])\b/i;

  /* ---------- Utilidades de texto ---------- */

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function limpiarMarcas(s) {
    return String(s || '').replace(/\*\*/g, '').replace(/__/g, '').replace(/^\s*[-*•]\s+/, '').trim();
  }

  /** Clasifica un importe: 'gratis' | 'pendiente' | 'desde' | 'cerrado' | 'ninguno'. Solo mira el texto. */
  function clasificarImporte(texto) {
    var t = String(texto || '');
    if (RE_GRATIS.test(t)) return 'gratis';
    var tiene = RE_IMPORTE.test(t);
    if (RE_PENDIENTE.test(t) && !tiene) return 'pendiente';
    if (!tiene) return 'ninguno';
    if (RE_PENDIENTE.test(t)) return 'pendiente';
    if (RE_DESDE.test(t)) return 'desde';
    return 'cerrado';
  }

  function extraerImporte(texto) {
    var m = String(texto || '').match(RE_IMPORTE);
    return m ? m[0].trim() : '';
  }

  /* ---------- Reparto del markdown en secciones ---------- */

  var TIPOS = [
    ['itinerario', /itinerario|plan d[ií]a a d[ií]a|d[ií]a a d[ií]a/i],
    ['presupuesto', /presupuesto|resumen de (?:gastos|costes|costos)|coste total|desglose/i],
    ['gastronomia', /gastronom|d[oó]nde comer|restaurantes?|comer y beber|comidas?\b/i],
    ['complementarias', /experiencias? (?:complementarias|adicionales|extra)|complementari|propuestas? adicionales|otras (?:experiencias|actividades|propuestas)|tambi[eé]n podr[ií]as|para completar|sugerencias/i]
  ];

  function tipoDeTitulo(titulo) {
    var t = limpiarMarcas(titulo);
    for (var i = 0; i < TIPOS.length; i++) if (TIPOS[i][1].test(t)) return TIPOS[i][0];
    return 'otro';
  }

  function esTitulo(linea) {
    var m = linea.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) return { nivel: m[1].length, texto: limpiarMarcas(m[2]) };
    m = linea.match(/^\s*\*\*([^*]{3,80})\*\*\s*:?\s*$/);
    if (m) return { nivel: 7, texto: limpiarMarcas(m[1]) };
    return null;
  }

  var RE_DIA = /^(?:d[ií]a|day)\s*(\d+)\b\s*[·:\-–—.]?\s*(.*)$/i;

  /**
   * Devuelve { secciones: [{tipo, titulo, lineas}], previo: [lineas] }.
   * Un título del mismo nivel o superior cierra la sección anterior; los «Día N» pertenecen al itinerario.
   */
  function analizar(markdown) {
    var lineas = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    var secciones = [], previo = [], actual = null;
    lineas.forEach(function (linea) {
      var h = esTitulo(linea);
      if (h) {
        var esDia = RE_DIA.test(h.texto);
        var tipo = esDia ? 'dia' : tipoDeTitulo(h.texto);
        if (tipo === 'dia' && actual && actual.tipo === 'itinerario') { actual.lineas.push(linea); return; }
        if (tipo === 'dia' && actual && actual.tipo === 'otro' && !actual.dias) {
          // «Día N» suelto sin título de itinerario: se trata como itinerario implícito.
          actual = { tipo: 'itinerario', titulo: 'Tu itinerario', nivel: h.nivel - 1, lineas: [linea] };
          secciones.push(actual); return;
        }
        if (tipo === 'dia') {
          actual = { tipo: 'itinerario', titulo: 'Tu itinerario', nivel: Math.max(1, h.nivel - 1), lineas: [linea] };
          secciones.push(actual); return;
        }
        // Un subtítulo (nivel mayor) de «otro» dentro de una sección reconocida se queda en ella.
        if (actual && tipo === 'otro' && h.nivel > actual.nivel && actual.tipo !== 'otro') { actual.lineas.push(linea); return; }
        actual = { tipo: tipo, titulo: h.texto, nivel: h.nivel, lineas: [] };
        secciones.push(actual);
        return;
      }
      if (actual) actual.lineas.push(linea); else previo.push(linea);
    });
    return { secciones: secciones, previo: previo };
  }

  /* ---------- Interpretación de cada sección ---------- */

  function esEstructural(l) { return /^\s*([-*•]\s+|\d+[.)]\s+|\|)/.test(l) || !!esTitulo(l); }

  /** Separa el texto de cierre («Si quieres cambiar algo…») de una sección: lo que sigue a la última línea
   *  estructural tras una línea en blanco. Devuelve { cuerpo, cierre }. Nada se descarta. */
  function separarCierre(lineas) {
    var ult = -1;
    for (var i = 0; i < lineas.length; i++) if (esEstructural(lineas[i])) ult = i;
    if (ult === -1) return { cuerpo: lineas, cierre: [] };
    var j = ult + 1;
    while (j < lineas.length && !String(lineas[j]).trim()) j++;
    if (j >= lineas.length || j === ult + 1) return { cuerpo: lineas, cierre: [] };
    return { cuerpo: lineas.slice(0, ult + 1), cierre: lineas.slice(j) };
  }


  function partirCeldas(linea) {
    return linea.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function (c) { return limpiarMarcas(c); });
  }

  function esSeparadorTabla(linea) { return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linea); }

  /** Filas de presupuesto: «- Concepto: 120 €», «Concepto · 120 €» o tabla. Lo que no encaja queda en `sobrantes`. */
  function interpretarPresupuesto(lineas) {
    var filas = [], sobrantes = [], cabecera = true;
    lineas.forEach(function (crudo) {
      var linea = crudo.trim();
      if (!linea) return;
      if (/^\|/.test(linea)) {
        if (esSeparadorTabla(linea)) { cabecera = false; return; }
        var c = partirCeldas(linea).filter(function (x) { return x !== ''; });
        if (c.length >= 2 && (clasificarImporte(c[c.length - 1]) !== 'ninguno' || clasificarImporte(c.join(' ')) !== 'ninguno')) {
          filas.push(crearFila(c[0], c.slice(1).join(' · ')));
        } else if (c.length) sobrantes.push(c.join(' · '));
        return;
      }
      var m = linea.replace(/^\s*[-*•]\s+/, '').replace(/\*\*/g, '');
      var sep = m.match(/^(.{2,80}?)\s*(?::|·|—|–| - )\s*(.+)$/);
      if (sep && clasificarImporte(sep[2]) !== 'ninguno') { filas.push(crearFila(sep[1], sep[2])); return; }
      if (clasificarImporte(m) !== 'ninguno' && /^\s*[-*•]/.test(crudo)) {
        var im = extraerImporte(m);
        filas.push(crearFila(m.replace(im, '').replace(/[:·—–\-\s]+$/, '').trim() || m, im || m));
        return;
      }
      sobrantes.push(limpiarMarcas(linea));
    });
    filas.forEach(function (f) { if (f.nota) sobrantes.push(f.nota); });
    return { filas: filas, sobrantes: sobrantes };
  }

  function crearFila(concepto, valor) {
    var total = /\btotal\b/i.test(concepto);
    valor = limpiarMarcas(valor);
    // «240 €. Quedan importes pendientes…»: el importe es la primera frase; lo demás es una nota que se conserva.
    var nota = '', m = valor.match(/^(.*?(?:[€$£]|\b(?:eur|euros?|usd)\b))\s*[.;]\s+(\S.*)$/i);
    if (m && RE_IMPORTE.test(m[1])) { valor = m[1].trim(); nota = m[2].trim(); }
    return { concepto: limpiarMarcas(concepto), valor: valor, clase: clasificarImporte(valor), total: total, nota: nota };
  }

  /** Itinerario: [{ dia, titulo, items:[{nombre, detalle, importe, clase}], extra:[texto] }] */
  function interpretarItinerario(lineas) {
    var dias = [], actual = null, previo = [];
    lineas.forEach(function (crudo) {
      var h = esTitulo(crudo), linea = crudo.trim();
      if (h) {
        var m = h.texto.match(RE_DIA);
        if (m) { actual = { dia: m[1], titulo: limpiarMarcas(m[2] || ''), items: [], extra: [] }; dias.push(actual); return; }
        (actual ? actual.extra : previo).push(h.texto);
        return;
      }
      if (!linea) return;
      var md = linea.match(/^\*{0,2}(?:d[ií]a|day)\s*(\d+)\*{0,2}\s*[·:\-–—.]?\s*(.*)$/i);
      if (md && !/^[-*•]/.test(linea)) { actual = { dia: md[1], titulo: limpiarMarcas(md[2] || ''), items: [], extra: [] }; dias.push(actual); return; }
      if (!actual) { previo.push(limpiarMarcas(linea)); return; }
      if (/^\s*[-*•]\s+/.test(crudo) || /^\s*\d+[.)]\s+/.test(crudo)) {
        var t = limpiarMarcas(linea.replace(/^\s*\d+[.)]\s+/, ''));
        var partes = t.split(/\s+[·|]\s+|\s+[—–]\s+/);
        var nombre = partes.shift().replace(/^\[|\]$/g, '').trim();
        var detalle = partes.join(' · ');
        var imp = extraerImporte(detalle) || extraerImporte(nombre);
        var clase = clasificarImporte(detalle || '');
        if (clase === 'ninguno') clase = clasificarImporte(nombre) === 'gratis' ? 'gratis' : 'ninguno';
        actual.items.push({ nombre: nombre, detalle: detalle, importe: imp, clase: clase });
      } else actual.extra.push(limpiarMarcas(linea));
    });
    return { dias: dias, previo: previo };
  }

  /** Listas simples (complementarias, gastronomía): elementos con nombre + detalle. */
  function interpretarLista(lineas) {
    var items = [], sobrantes = [];
    lineas.forEach(function (crudo) {
      var linea = crudo.trim();
      if (!linea) return;
      var h = esTitulo(crudo);
      if (h) { sobrantes.push(h.texto); return; }
      if (/^\s*[-*•]\s+/.test(crudo) || /^\s*\d+[.)]\s+/.test(crudo)) {
        var t = limpiarMarcas(linea.replace(/^\s*\d+[.)]\s+/, ''));
        var partes = t.split(/\s+[·|]\s+|\s+[—–]\s+|:\s+(?=\S)/);
        var nombre = partes.shift().replace(/^\[|\]$/g, '').trim();
        var detalle = partes.join(' · ');
        items.push({ nombre: nombre, detalle: detalle, importe: extraerImporte(detalle) || extraerImporte(nombre), clase: clasificarImporte(detalle || nombre) });
      } else sobrantes.push(limpiarMarcas(linea));
    });
    return { items: items, sobrantes: sobrantes };
  }

  /* ---------- Construcción del DOM (siempre con textContent) ---------- */

  function el(doc, tag, clase, texto) {
    var e = doc.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  var RE_INLINE = /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>]+)/g;

  /** Texto con enlaces seguros (solo http/https, rel noopener). */
  function inline(doc, padre, texto) {
    var t = String(texto == null ? '' : texto).replace(/\*\*/g, ''), ultimo = 0, m;
    RE_INLINE.lastIndex = 0;
    while ((m = RE_INLINE.exec(t))) {
      if (m.index > ultimo) padre.appendChild(doc.createTextNode(t.slice(ultimo, m.index)));
      var a = doc.createElement('a');
      a.href = m[2] || m[3]; a.textContent = m[1] || 'Ver enlace'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      padre.appendChild(a);
      ultimo = m.index + m[0].length;
    }
    if (ultimo < t.length) padre.appendChild(doc.createTextNode(t.slice(ultimo)));
    return padre;
  }

  var ETIQUETA = { cerrado: 'Cerrado', desde: 'Desde', gratis: 'Gratis', pendiente: 'Pendiente', ninguno: '' };

  function insignia(doc, clase) {
    if (!ETIQUETA[clase]) return null;
    return el(doc, 'span', 'cv-chip cv-' + clase, ETIQUETA[clase]);
  }

  function textoPlano(doc, lineas, clase) {
    var limpias = lineas.filter(function (l) { return String(l).trim(); });
    if (!limpias.length) return null;
    var p = el(doc, 'div', clase || 'cv-texto');
    limpias.forEach(function (l, i) { if (i) p.appendChild(doc.createElement('br')); inline(doc, p, l); });
    return p;
  }

  function tarjeta(doc, kicker, titulo) {
    var s = el(doc, 'section', 'cv-sec');
    var cab = el(doc, 'div', 'cv-cab');
    cab.appendChild(el(doc, 'span', 'cv-kicker', kicker));
    cab.appendChild(el(doc, 'h3', null, titulo));
    s.appendChild(cab);
    return s;
  }

  function pintarPresupuesto(doc, sec) {
    var r = interpretarPresupuesto(sec.lineas);
    var s = tarjeta(doc, 'PRESUPUESTO', sec.titulo || 'Presupuesto');
    s.className += ' cv-presupuesto';
    if (!r.filas.length) {
      // Sin filas interpretables: el texto completo, sin perder nada.
      var t = textoPlano(doc, sec.lineas);
      if (t) s.appendChild(t);
      return s;
    }
    var totales = r.filas.filter(function (f) { return f.total; });
    var resto = r.filas.filter(function (f) { return !f.total; });
    totales.forEach(function (f) {
      var d = el(doc, 'div', 'cv-total');
      var izq = el(doc, 'div');
      izq.appendChild(el(doc, 'small', null, f.concepto));
      d.appendChild(izq);
      var der = el(doc, 'strong', null, f.valor);
      d.appendChild(der);
      s.appendChild(d);
    });
    var grupos = [['cerrado', 'Importes cerrados'], ['desde', 'Importes «desde»'], ['gratis', 'Gratuito'], ['pendiente', 'Pendiente de confirmar'], ['ninguno', 'Otros']];
    var cont = el(doc, 'div', 'cv-grupos');
    grupos.forEach(function (g) {
      var fs = resto.filter(function (f) { return f.clase === g[0]; });
      if (!fs.length) return;
      var gr = el(doc, 'div', 'cv-grupo cv-g-' + g[0]);
      gr.appendChild(el(doc, 'h4', null, g[1]));
      var ul = el(doc, 'ul');
      fs.forEach(function (f) {
        var li = el(doc, 'li');
        li.appendChild(el(doc, 'span', 'cv-concepto', f.concepto));
        // El estado (cerrado / desde / gratis / pendiente) lo expresa el grupo; no se repite con una insignia.
        var v = el(doc, 'span', 'cv-valor');
        inline(doc, v, f.valor);
        li.appendChild(v);
        ul.appendChild(li);
      });
      gr.appendChild(ul);
      cont.appendChild(gr);
    });
    s.appendChild(cont);
    var extra = textoPlano(doc, r.sobrantes, 'cv-texto cv-nota');
    if (extra) s.appendChild(extra);
    return s;
  }

  function coincideSeleccion(nombre, seleccion) {
    var n = norm(nombre);
    if (!n) return false;
    return (seleccion || []).some(function (x) {
      var k = norm(x);
      return k && (n === k || n.indexOf(k) !== -1 || k.indexOf(n) !== -1);
    });
  }

  function pintarItinerario(doc, sec, seleccion) {
    var r = interpretarItinerario(sec.lineas);
    var s = tarjeta(doc, 'ITINERARIO', sec.titulo || 'Tu itinerario');
    s.className += ' cv-itinerario';
    if (!r.dias.length) {
      var t = textoPlano(doc, sec.lineas);
      if (t) s.appendChild(t);
      return s;
    }
    var previo = textoPlano(doc, r.previo, 'cv-texto cv-nota');
    if (previo) s.appendChild(previo);
    var haySel = Array.isArray(seleccion) && seleccion.length > 0;
    var linea = el(doc, 'ol', 'cv-dias');
    r.dias.forEach(function (d) {
      var li = el(doc, 'li', 'cv-dia');
      var marca = el(doc, 'div', 'cv-dia-marca');
      marca.appendChild(el(doc, 'span', 'cv-dia-num', 'Día ' + d.dia));
      if (d.titulo) marca.appendChild(el(doc, 'span', 'cv-dia-fecha', d.titulo));
      li.appendChild(marca);
      var cuerpo = el(doc, 'div', 'cv-dia-cuerpo');
      d.items.forEach(function (it) {
        var sel = haySel ? coincideSeleccion(it.nombre, seleccion) : null;
        var card = el(doc, 'article', 'cv-item' + (sel === true ? ' cv-elegida' : sel === false ? ' cv-adicional' : ''));
        var cab = el(doc, 'div', 'cv-item-cab');
        cab.appendChild(inline(doc, el(doc, 'strong'), it.nombre));
        if (sel === true) cab.appendChild(el(doc, 'span', 'cv-chip cv-elegida-chip', 'Elegida por ti'));
        else if (sel === false) cab.appendChild(el(doc, 'span', 'cv-chip cv-adicional-chip', 'Propuesta adicional'));
        card.appendChild(cab);
        if (it.detalle) card.appendChild(inline(doc, el(doc, 'p'), it.detalle));
        var ins = it.clase !== 'ninguno' ? insignia(doc, it.clase) : null;
        if (ins) card.appendChild(ins);
        cuerpo.appendChild(card);
      });
      var ex = textoPlano(doc, d.extra, 'cv-texto cv-nota');
      if (ex) cuerpo.appendChild(ex);
      li.appendChild(cuerpo);
      linea.appendChild(li);
    });
    s.appendChild(linea);
    return s;
  }

  function pintarLista(doc, sec, kicker, clase) {
    var r = interpretarLista(sec.lineas);
    var s = tarjeta(doc, kicker, sec.titulo);
    s.className += ' ' + clase;
    if (!r.items.length) {
      var t = textoPlano(doc, sec.lineas);
      if (t) s.appendChild(t);
      return s;
    }
    var ul = el(doc, 'ul', 'cv-lista');
    r.items.forEach(function (it) {
      var li = el(doc, 'li', 'cv-item');
      var cab = el(doc, 'div', 'cv-item-cab');
      cab.appendChild(inline(doc, el(doc, 'strong'), it.nombre));
      var ins = it.clase !== 'ninguno' ? insignia(doc, it.clase) : null;
      if (ins) cab.appendChild(ins);
      li.appendChild(cab);
      if (it.detalle) li.appendChild(inline(doc, el(doc, 'p'), it.detalle));
      ul.appendChild(li);
    });
    s.appendChild(ul);
    var extra = textoPlano(doc, r.sobrantes, 'cv-texto cv-nota');
    if (extra) s.appendChild(extra);
    return s;
  }

  /**
   * Devuelve un fragmento con las secciones reconocidas y, íntegro, el resto del texto de esas partes
   * del mensaje (secciones no reconocidas dentro de `solo`). Devuelve null si no se reconoce nada.
   *   opciones.seleccion: nombres de actividades elegidas (para marcar «Elegida por ti» / «Propuesta adicional»).
   *   opciones.tipos: limita los tipos a pintar (por defecto todos).
   */
  function renderizar(markdown, opciones) {
    opciones = opciones || {};
    var doc = opciones.document || global.document;
    var tipos = opciones.tipos || ['presupuesto', 'itinerario', 'complementarias', 'gastronomia'];
    var a = analizar(markdown);
    var reconocidas = a.secciones.filter(function (s) { return tipos.indexOf(s.tipo) !== -1; });
    if (!reconocidas.length) return null;
    var frag = doc.createDocumentFragment();
    // Introducción (texto anterior a la primera sección): va ANTES de las secciones.
    var intro = textoPlano(doc, a.previo.map(function (l) { return String(l).replace(/[#*]{1,3}/g, ''); }), 'cv-texto cv-resto');
    if (intro && opciones.incluirTextoSuelto !== false) frag.appendChild(intro);
    a.secciones.forEach(function (s) {
      if (tipos.indexOf(s.tipo) === -1) return;
      var sc = { tipo: s.tipo, titulo: s.titulo, nivel: s.nivel, lineas: s.lineas };
      var cierre = [];
      if (s.tipo !== 'presupuesto') { var sp = separarCierre(s.lineas); sc.lineas = sp.cuerpo; cierre = sp.cierre; }
      else { // en el presupuesto solo se separa el cierre que no contiene importes
        var sp2 = separarCierre(s.lineas);
        if (sp2.cierre.length && sp2.cierre.every(function (l) { return !String(l).trim() || clasificarImporte(l) === 'ninguno'; })) { sc.lineas = sp2.cuerpo; cierre = sp2.cierre; }
      }
      if (s.tipo === 'presupuesto') frag.appendChild(pintarPresupuesto(doc, sc));
      else if (s.tipo === 'itinerario') frag.appendChild(pintarItinerario(doc, sc, opciones.seleccion));
      else if (s.tipo === 'complementarias') frag.appendChild(pintarLista(doc, sc, 'EXPERIENCIAS COMPLEMENTARIAS', 'cv-complementarias'));
      else frag.appendChild(pintarLista(doc, sc, 'GASTRONOMÍA', 'cv-gastronomia'));
      var c = textoPlano(doc, cierre.map(function (l) { return String(l).replace(/[#*]{1,3}/g, ''); }), 'cv-texto cv-resto');
      if (c) frag.appendChild(c);
    });
    return frag;
  }

  global.MogavelConversacion = {
    analizar: analizar,
    renderizar: renderizar,
    clasificarImporte: clasificarImporte,
    interpretarPresupuesto: interpretarPresupuesto,
    interpretarItinerario: interpretarItinerario
  };
})(typeof window !== 'undefined' ? window : globalThis);
