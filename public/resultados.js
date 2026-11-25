/*
 * Mogavel — página de resultados (/resultados.html).
 *
 * - Recupera la búsqueda guardada por la portada (MogavelEstado) y lanza UNA sola llamada a /api/chat
 *   (mismo endpoint y mismo formato de petición que la portada).
 * - Pinta la respuesta con el renderer compartido (render-resultados.js) en un contenedor aparte y reparte
 *   el resultado en tres paneles montados a la vez: Vuelos, Hoteles y Actividades. Cambiar de pestaña solo
 *   alterna el atributo `hidden`: no se destruye contenido ni eventos.
 * - Las selecciones las gestiona trip-builder.js (panel «TU VIAJE»); aquí solo se refleja el recuento.
 * No toca backend, proveedores ni el contrato del agente.
 */
(function (global) {
  'use strict';

  var TABS = ['vuelos', 'hoteles', 'actividades'];
  var KIND_DE_TAB = { vuelos: 'flight', hoteles: 'hotel', actividades: 'activity' };
  var SELECTORES_TARJETA = { vuelos: '.flight-card', hoteles: '.hotel-card', actividades: '.activity-card' };
  var VACIO = {
    vuelos: 'Aún no hay vuelos en esta búsqueda.',
    hoteles: 'Aún no hay alojamientos en esta búsqueda.',
    actividades: 'Aún no hay actividades en esta búsqueda.'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  /* ---------- Reparto del HTML renderizado entre pestañas ---------- */

  function pestanaDeNodo(nodo) {
    if (nodo.matches('.trip-summary')) return 'resumen';
    if (nodo.querySelector('.flight-card, .flight-results, .empty-flight, h3.flights')) return 'vuelos';
    if (nodo.matches('.flight-card, .flight-results, .empty-flight')) return 'vuelos';
    if (nodo.querySelector('.hotel-card, .hotel-results, .hotel-category, h3.hotels') || nodo.matches('.hotel-card, .hotel-results')) return 'hoteles';
    if (nodo.querySelector('.activity-card, .activity-results') || nodo.matches('.activity-card, .activity-results')) return 'actividades';
    var titulo = nodo.querySelector('h3');
    if (titulo && /^\s*vuelos\b/i.test(titulo.textContent || '')) return 'vuelos';
    if (nodo.matches('.search-note')) {
      var t = nodo.textContent || '';
      if (/alojamient|hotel/i.test(t)) return 'hoteles';
      if (/actividad|experienc/i.test(t)) return 'actividades';
    }
    return 'notas';
  }

  /**
   * Reparte los hijos de `staging` (HTML generado por renderResultados) en
   * { resumen, vuelos, hoteles, actividades, notas } sin alterar su contenido.
   * En respuestas multidestino cada ciudad se divide en una sección para Hoteles y otra para Actividades.
   */
  function particionar(staging) {
    var out = { resumen: [], vuelos: [], hoteles: [], actividades: [], notas: [] };
    Array.prototype.slice.call(staging.children).forEach(function (nodo) {
      if (nodo.matches('.multicity-section')) {
        var secH = nodo.cloneNode(false), secA = nodo.cloneNode(false);
        var tieneH = false, tieneA = false;
        Array.prototype.slice.call(nodo.children).forEach(function (hijo) {
          if (hijo.matches('.multicity-title')) {
            secH.appendChild(hijo.cloneNode(true)); secA.appendChild(hijo.cloneNode(true));
            return;
          }
          var dest = pestanaDeNodo(hijo);
          if (dest === 'actividades') { secA.appendChild(hijo); tieneA = true; }
          else { secH.appendChild(hijo); tieneH = true; }
        });
        if (tieneH) out.hoteles.push(secH);
        if (tieneA) out.actividades.push(secA);
        return;
      }
      out[pestanaDeNodo(nodo)].push(nodo);
    });
    return out;
  }

  /* ---------- Estado de la página ---------- */

  var enCurso = false;
  var enviandoSeguimiento = false;
  var pestanaActiva = 'vuelos';

  function leerHash() {
    var h = String(global.location.hash || '').replace('#', '');
    return TABS.indexOf(h) >= 0 ? h : null;
  }

  function activarPestana(nombre, opciones) {
    if (TABS.indexOf(nombre) < 0) return;
    pestanaActiva = nombre;
    TABS.forEach(function (t) {
      var boton = $('tab-' + t), panel = $('panel-' + t), activa = t === nombre;
      boton.setAttribute('aria-selected', String(activa));
      boton.tabIndex = activa ? 0 : -1;
      panel.hidden = !activa;
    });
    if (!opciones || !opciones.sinHash) {
      try { global.history.replaceState(null, '', '#' + nombre); } catch (_) { /* nada */ }
    }
  }

  function actualizarContadores() {
    var sel = [];
    try { sel = (global.MogavelTripBuilder && global.MogavelTripBuilder.snapshot()) || []; } catch (_) { sel = []; }
    TABS.forEach(function (t) {
      var n = $('panel-' + t).querySelectorAll(SELECTORES_TARJETA[t]).length;
      var chip = document.querySelector('[data-count="' + t + '"]');
      if (!chip) return;
      var elegidos = sel.filter(function (x) { return x.kind === KIND_DE_TAB[t]; }).length;
      chip.textContent = n;
      chip.dataset.sel = elegidos ? '1' : '0';
      chip.title = elegidos ? (elegidos + (elegidos === 1 ? ' seleccionado' : ' seleccionados')) : '';
      var vacio = $('panel-' + t);
      vacio.dataset.vacio = VACIO[t];
    });
    vigilarPanel();
  }

  // El panel «TU VIAJE» es fijo y ocupa espacio variable: el final de la página (chat, pie) reserva ese hueco
  // para que el panel nunca tape el botón de enviar ni el contenido.
  var observadorPanel = null;
  function vigilarPanel() {
    var panel = $('mogavel-trip-builder');
    if (!panel || observadorPanel || typeof ResizeObserver === 'undefined') return;
    observadorPanel = new ResizeObserver(function () {
      document.body.style.paddingBottom = panel.hidden ? '' : (Math.ceil(panel.getBoundingClientRect().height) + 24) + 'px';
    });
    observadorPanel.observe(panel);
  }

  function mostrar(nodos, panel) {
    panel.replaceChildren.apply(panel, nodos);
  }

  /**
   * Pinta las pestañas con una respuesta del agente.
   *  - Con `resultados` (datos estructurados de /api/chat) las tarjetas salen DIRECTAMENTE de los datos (render-datos.js); el
   *    texto del modelo solo es la explicación. Solo se sustituyen las pestañas cuyos tipos traen bloques en esta respuesta.
   *  - Sin `resultados` (estados guardados por versiones anteriores) se interpreta el markdown como antes.
   * Devuelve { notas, hayPestanas, datos }.
   */
  function aplicarRespuesta(texto, resultados) {
    if (resultados !== undefined && global.MogavelDatos) {
      var p = global.MogavelDatos.paneles(resultados);
      var hay = false;
      TABS.forEach(function (t) { if (p[t].length) { mostrar(p[t], $('panel-' + t)); hay = true; } });
      actualizarContadores();
      return { notas: [], hayPestanas: hay, datos: true };
    }
    var staging = document.createElement('div');
    global.renderResultados(texto, staging);
    var partes = particionar(staging);
    if (partes.resumen.length) mostrar(partes.resumen, $('resumen'));
    TABS.forEach(function (t) { if (partes[t].length) mostrar(partes[t], $('panel-' + t)); });
    actualizarContadores();
    // Los nodos recién insertados los decora trip-builder.js (MutationObserver sobre #results).
    return {
      notas: partes.notas,
      hayPestanas: partes.resumen.length + partes.vuelos.length + partes.hoteles.length + partes.actividades.length > 0,
      datos: false
    };
  }

  var RE_TITULO_RESULTADOS = /^\s{0,3}#{1,6}\s*(?:\d+[.)]\s*)?(?:\*\*)?\s*(vuelos?|alojamientos?|hoteles?|actividades|experiencias(?!\s+complementarias))\b/i;
  function esTituloMd(l) { return /^\s{0,3}#{1,6}\s+\S/.test(l); }
  /**
   * Con datos estructurados, las listas de vuelos/alojamientos/actividades ya están en las tarjetas: se quitan del texto del
   * modelo las secciones que las repitan (por si el modelo las escribe pese a las instrucciones). El resto se conserva íntegro.
   */
  function limpiarExplicacion(texto) {
    var salida = [], saltando = false;
    String(texto || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (l) {
      if (esTituloMd(l)) { saltando = RE_TITULO_RESULTADOS.test(l); if (saltando) return; }
      // Dentro de una sección de resultados solo se descartan sus elementos (listas, tablas, sangrías, blancos); un párrafo
      // de prosa que siga a la lista es explicación y se conserva.
      if (saltando) {
        if (!l.trim() || /^\s*([-*•]\s+|\d+[.)]\s+|\|)/.test(l) || /^\s{2,}\S/.test(l)) return;
        saltando = false;
      }
      if (/^\s*Estado de actividades:/i.test(l)) return;
      salida.push(l);
    });
    return salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- Conversación cronológica: propuesta → petición del usuario → respuesta del agente ---------- */

  function nombresActividadesElegidas() {
    var tb = global.MogavelTripBuilder;
    if (!tb || typeof tb.snapshot !== 'function') return null;
    try {
      return tb.snapshot().filter(function (x) { return x.kind === 'activity'; }).map(function (x) { return x.name; });
    } catch (_) { return null; }
  }

  function normalizar(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  function entrada(clase, etiqueta) {
    var d = document.createElement('article');
    d.className = 'conv-msg ' + clase;
    if (etiqueta) { var e = document.createElement('div'); e.className = 'conv-quien'; e.textContent = etiqueta; d.appendChild(e); }
    $('conversacion').appendChild(d);
    return d;
  }

  function pintarUsuario(texto) {
    var d = entrada('conv-usuario', 'Tú');
    var p = document.createElement('p');
    p.textContent = texto;
    d.appendChild(p);
    return d;
  }

  function pintarPropuesta(items) {
    var d = entrada('conv-propuesta', null);
    d.id = 'mogavel-trip-review';
    d.className += ' mtr-review';
    var tb = global.MogavelTripBuilder;
    if (tb && typeof tb.rellenarPropuesta === 'function') tb.rellenarPropuesta(d, items);
    return d;
  }

  /**
   * Respuesta del agente en la conversación: secciones reconocidas (presupuesto, itinerario, complementarias,
   * gastronomía) con presentación propia y, además, el texto que no se reconoce, íntegro. Si la respuesta solo
   * actualiza pestañas y no trae texto adicional, se indica con una línea breve.
   */
  function pintarAgente(texto, info) {
    var d = entrada('conv-agente', 'Mogavel');
    var cuerpo = document.createElement('div');
    cuerpo.className = 'conv-cuerpo';
    var conv = global.MogavelConversacion;
    if (info && info.datos) return pintarAgenteDatos(d, cuerpo, texto, info, conv);
    var frag = conv ? conv.renderizar(texto, { seleccion: nombresActividadesElegidas(), incluirTextoSuelto: !info.hayPestanas }) : null;
    var reconocidas = frag ? conv.analizar(texto).secciones.filter(function (s) { return s.tipo !== 'otro'; }) : [];
    var titulos = reconocidas.map(function (s) { return normalizar(s.titulo); }).filter(Boolean);
    var hayContenido = false;
    if (frag) { cuerpo.appendChild(frag); hayContenido = true; }

    if (frag && !info.hayPestanas) {
      // Respuesta de solo texto: lo no reconocido (introducción, notas, cierre) se muestra completo.
      var a = conv.analizar(texto), resto = [];   // la introducción ya la pinta renderizar(), antes de las secciones
      a.secciones.forEach(function (sec) { if (sec.tipo === 'otro') { resto.push(sec.titulo); resto = resto.concat(sec.lineas); } });
      var limpio = resto.map(function (l) { return String(l).replace(/[#*]{1,3}/g, '').trim(); }).filter(Boolean);
      if (limpio.length) {
        var t = document.createElement('div'); t.className = 'cv-texto cv-resto';
        limpio.forEach(function (l, i) { if (i) t.appendChild(document.createElement('br')); t.appendChild(document.createTextNode(l)); });
        cuerpo.appendChild(t);
      }
    } else {
      info.notas.forEach(function (nodo) {
        var txt = normalizar(nodo.textContent);
        if (titulos.some(function (tt) { return txt.indexOf(tt) !== -1; })) return; // ya mostrado en la sección estructurada
        var c = document.createElement('div'); c.className = 'res-nota'; c.appendChild(nodo);
        cuerpo.appendChild(c); hayContenido = true;
      });
    }
    if (!hayContenido && !cuerpo.childNodes.length) {
      // Solo se indica la actualización cuando responde a una petición del usuario (no tras la búsqueda inicial).
      var respondeAPeticion = d.previousElementSibling && d.previousElementSibling.classList.contains('conv-usuario');
      if (!info.hayPestanas || !respondeAPeticion) { d.remove(); return null; }
      var n = document.createElement('p'); n.className = 'conv-actualizado';
      n.textContent = 'He actualizado los resultados de las pestañas.';
      cuerpo.appendChild(n);
    }
    d.appendChild(cuerpo);
    return d;
  }

  /** Respuesta con datos estructurados: el texto del modelo es SOLO la explicación y se muestra completo. */
  function pintarAgenteDatos(d, cuerpo, texto, info, conv) {
    var limpio = limpiarExplicacion(texto);
    var frag = conv && limpio ? conv.renderizar(limpio, { seleccion: nombresActividadesElegidas(), incluirTextoSuelto: true }) : null;
    if (frag) {
      cuerpo.appendChild(frag);
      conv.analizar(limpio).secciones.forEach(function (sec) {
        if (sec.tipo !== 'otro') return;
        var lineas = [sec.titulo].concat(sec.lineas).map(function (l) { return String(l).replace(/[#*]{1,3}/g, '').trim(); }).filter(Boolean);
        if (!lineas.length) return;
        var t = document.createElement('div'); t.className = 'cv-texto cv-resto';
        lineas.forEach(function (l, i) { if (i) t.appendChild(document.createElement('br')); t.appendChild(document.createTextNode(l)); });
        cuerpo.appendChild(t);
      });
    } else if (limpio) {
      var t2 = document.createElement('div'); t2.className = 'cv-texto cv-resto';
      limpio.split('\n').map(function (l) { return l.replace(/[#*]{1,3}/g, '').trim(); }).filter(Boolean).forEach(function (l, i) {
        if (i) t2.appendChild(document.createElement('br')); t2.appendChild(document.createTextNode(l));
      });
      cuerpo.appendChild(t2);
    }
    if (!cuerpo.childNodes.length) {
      var respondeAPeticion = d.previousElementSibling && d.previousElementSibling.classList.contains('conv-usuario');
      if (!info.hayPestanas || !respondeAPeticion) { d.remove(); return null; }
      var n = document.createElement('p'); n.className = 'conv-actualizado';
      n.textContent = 'He actualizado los resultados de las pestañas.';
      cuerpo.appendChild(n);
    }
    d.appendChild(cuerpo);
    return d;
  }

  function mostrarPropuesta(items) {
    var est = global.MogavelEstado.leer();
    var existente = $('conversacion').querySelectorAll('.conv-propuesta');
    var r = est ? global.MogavelEstado.registrarPropuesta(items) : { ok: true, nueva: !existente.length };
    var nodo = existente.length ? existente[existente.length - 1] : null;
    if (r.nueva || !nodo) nodo = pintarPropuesta(items);
    // Solo la última lleva el id (evita ids duplicados).
    Array.prototype.forEach.call($('conversacion').querySelectorAll('.conv-propuesta'), function (n) { n.removeAttribute('id'); });
    nodo.id = 'mogavel-trip-review';
    nodo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var input = $('chatMessage');
    if (input) {
      input.placeholder = '¿Qué quieres ajustar? Por ejemplo: cambia el hotel, añade tiempo libre o rehaz el itinerario.';
      input.focus({ preventScroll: true });
    }
  }

  function pestanaInicial(estado) {
    var h = leerHash();
    if (h) return h;
    var modo = estado && estado.modo;
    if (modo === 'hotels') return 'hoteles';
    if (modo === 'activities') return 'actividades';
    return 'vuelos';
  }

  /** Si la pestaña activa está vacía y otra tiene contenido, pasa a la primera con contenido (sin fijar el hash). */
  function ajustarPestanaVacia() {
    if (leerHash()) return;
    var n = function (t) { return $('panel-' + t).querySelectorAll(SELECTORES_TARJETA[t]).length; };
    if (n(pestanaActiva) > 0) return;
    for (var i = 0; i < TABS.length; i++) {
      if (n(TABS[i]) > 0) { activarPestana(TABS[i], { sinHash: true }); return; }
    }
  }

  /* ---------- Comunicación con el agente (mismo endpoint y formato que la portada) ---------- */

  function conContextoDeSeleccion(message) {
    if (global.MogavelTripBuilder && typeof global.MogavelTripBuilder.contexto === 'function') {
      return global.MogavelTripBuilder.contexto(message);
    }
    return message;
  }

  async function consultarAgente(message, sessionId, destinoSeleccionado) {
    var response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ message: conContextoDeSeleccion(message), sessionId: sessionId }, destinoSeleccionado ? { destinoSeleccionado: destinoSeleccionado } : {}))
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error en la búsqueda');
    return { texto: typeof data.response === 'string' ? data.response : '', resultados: data.resultados, aviso: data.aviso || null };
  }

  function avisoEstado(html, esError) {
    $('estado').innerHTML = html ? '<div class="res-aviso' + (esError ? ' res-error' : '') + '">' + html + '</div>' : '';
  }

  function conteosActuales() {
    var c = {};
    TABS.forEach(function (t) { c[t] = $('panel-' + t).querySelectorAll(SELECTORES_TARJETA[t]).length; });
    return c;
  }

  function terminarCarga(estado) {
    if (global.MogavelCarga) global.MogavelCarga.terminar(estado.modo, conteosActuales());
  }

  async function lanzarBusqueda(estado) {
    if (enCurso) return;
    enCurso = true;
    avisoEstado('');
    if (global.MogavelCarga) global.MogavelCarga.iniciar(estado.modo);
    // Se marca "en curso" ANTES de llamar: una recarga no repite la búsqueda (cada una consume créditos).
    global.MogavelEstado.marcarEnCurso();
    try {
      // Primera petición: viaja también el destino elegido en el autocompletado (si lo hubo). Los seguimientos no lo repiten.
      var turno = await consultarAgente(estado.mensaje, estado.sessionId, estado.formulario && estado.formulario.destinoSeleccionado);
      global.MogavelEstado.agregarRespuesta(turno.texto, turno.resultados);
      pintarAgente(turno.texto, aplicarRespuesta(turno.texto, turno.resultados));
      ajustarPestanaVacia();
      avisoEstado(turno.aviso ? esc(turno.aviso) : '');
      terminarCarga(estado);
    } catch (error) {
      if (global.MogavelCarga) global.MogavelCarga.fallar(estado.modo);
      global.MogavelEstado.marcarError(error.message);
      mostrarReintento('Ha ocurrido un error: ' + esc(error.message), estado, true);
    } finally {
      enCurso = false;
    }
  }

  function mostrarReintento(texto, estado, esError) {
    avisoEstado(texto + ' <button type="button" id="reintentar">Volver a lanzar la búsqueda</button>', esError);
    var b = $('reintentar');
    if (b) b.addEventListener('click', function () { lanzarBusqueda(estado); });
  }

  async function enviarSeguimiento() {
    if (enviandoSeguimiento) return;
    var input = $('chatMessage');
    var mensaje = input.value.trim();
    var estado = global.MogavelEstado.leer();
    if (!mensaje || !estado) return;
    enviandoSeguimiento = true;
    var boton = $('enviarSeguimiento');
    var etiqueta = boton.innerHTML;
    boton.disabled = true; boton.textContent = 'Enviando…';
    input.value = '';
    global.MogavelEstado.agregarMensajeUsuario(mensaje);
    var burbuja = pintarUsuario(mensaje);
    burbuja.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      var turno = await consultarAgente(mensaje, estado.sessionId);
      global.MogavelEstado.agregarRespuesta(turno.texto, turno.resultados);
      var respuestaNodo = pintarAgente(turno.texto, aplicarRespuesta(turno.texto, turno.resultados));
      if (respuestaNodo && respuestaNodo.scrollIntoView) respuestaNodo.scrollIntoView({ behavior: 'smooth', block: 'start' });
      ajustarPestanaVacia();
      avisoEstado(turno.aviso ? esc(turno.aviso) : '');
    } catch (error) {
      avisoEstado('Ha ocurrido un error: ' + esc(error.message), true);
    } finally {
      enviandoSeguimiento = false;
      boton.disabled = false; boton.innerHTML = etiqueta;
    }
  }

  /* ---------- Arranque ---------- */

  function configurarPestanas() {
    var lista = document.querySelector('.res-tabs');
    TABS.forEach(function (t) {
      $('tab-' + t).addEventListener('click', function () { activarPestana(t); });
    });
    lista.addEventListener('keydown', function (e) {
      var i = TABS.indexOf(pestanaActiva), n = null;
      if (e.key === 'ArrowRight') n = TABS[(i + 1) % TABS.length];
      else if (e.key === 'ArrowLeft') n = TABS[(i + TABS.length - 1) % TABS.length];
      else if (e.key === 'Home') n = TABS[0];
      else if (e.key === 'End') n = TABS[TABS.length - 1];
      if (n) { e.preventDefault(); activarPestana(n); $('tab-' + n).focus(); }
    });
    global.addEventListener('hashchange', function () { var h = leerHash(); if (h) activarPestana(h, { sinHash: true }); });
    document.addEventListener('mogavel:seleccion', actualizarContadores);
  }

  function iniciar() {
    configurarPestanas();
    var estado = global.MogavelEstado.leer();
    activarPestana(pestanaInicial(estado), { sinHash: true });
    actualizarContadores();

    if (!estado) {
      $('chatBox').style.display = 'none';
      if (global.MogavelCarga) global.MogavelCarga.ocultar();
      avisoEstado('No hay ninguna búsqueda en curso. <a href="/index.html#mis-viajes">Empieza una nueva búsqueda</a>.');
      return;
    }

    // Las pestañas se reconstruyen con los ÚLTIMOS datos guardados de cada tipo (estado.ultimos) y, para los mensajes de
    // versiones anteriores sin datos, con el markdown como antes. La conversación, en el orden en que ocurrió.
    if (estado.ultimos && global.MogavelDatos) aplicarRespuesta('', Object.assign({ version: 1, vuelos: [], hoteles: [], actividades: [] }, estado.ultimos));
    estado.mensajes.forEach(function (m) {
      if (m.tipo === 'usuario') pintarUsuario(m.texto);
      else if (m.tipo === 'propuesta') pintarPropuesta(m.items);
      else if (m.tipo === 'agente') {
        var info = m.datos ? { notas: [], hayPestanas: !!m.hayDatos, datos: true } : aplicarRespuesta(m.texto);
        pintarAgente(m.texto, info);
      }
    });
    var props = $('conversacion').querySelectorAll('.conv-propuesta');
    if (props.length) props[props.length - 1].id = 'mogavel-trip-review';
    ajustarPestanaVacia();
    $('enviarSeguimiento').addEventListener('click', enviarSeguimiento);
    $('chatMessage').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviarSeguimiento(); });

    if (estado.estado === 'pendiente') lanzarBusqueda(estado);
    else if (estado.estado === 'en_curso') mostrarReintento('La búsqueda anterior se interrumpió antes de recibir respuesta.', estado, false);
    else if (estado.estado === 'error') mostrarReintento('Ha ocurrido un error: ' + esc(estado.error || 'desconocido'), estado, true);
  }

  global.MogavelResultados = { particionar: particionar, aplicarRespuesta: aplicarRespuesta, limpiarExplicacion: limpiarExplicacion, activarPestana: activarPestana, mostrarPropuesta: mostrarPropuesta };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
