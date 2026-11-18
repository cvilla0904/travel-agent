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

  /** Pinta una respuesta del agente. Las secciones que no vengan en ella conservan lo que ya había. */
  function aplicarRespuesta(texto) {
    var staging = document.createElement('div');
    global.renderResultados(texto, staging);
    var partes = particionar(staging);
    if (partes.resumen.length) mostrar(partes.resumen, $('resumen'));
    TABS.forEach(function (t) { if (partes[t].length) mostrar(partes[t], $('panel-' + t)); });
    partes.notas.forEach(function (nodo) {
      var contenedor = document.createElement('div');
      contenedor.className = 'res-nota';
      contenedor.appendChild(nodo);
      $('notas').appendChild(contenedor);
    });
    actualizarContadores();
    // Los nodos recién insertados los decora trip-builder.js (MutationObserver sobre #results).
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

  async function consultarAgente(message, sessionId) {
    var response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: conContextoDeSeleccion(message), sessionId: sessionId })
    });
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error en la búsqueda');
    return data.response;
  }

  function avisoEstado(html, esError) {
    $('estado').innerHTML = html ? '<div class="res-aviso' + (esError ? ' res-error' : '') + '">' + html + '</div>' : '';
  }

  async function lanzarBusqueda(estado) {
    if (enCurso) return;
    enCurso = true;
    $('estado').innerHTML = '<div class="loading">Buscando vuelos, alojamientos y experiencias para ti...</div>';
    // Se marca "en curso" ANTES de llamar: una recarga no repite la búsqueda (cada una consume créditos).
    global.MogavelEstado.marcarEnCurso();
    try {
      var texto = await consultarAgente(estado.mensaje, estado.sessionId);
      global.MogavelEstado.agregarRespuesta(texto);
      aplicarRespuesta(texto);
      ajustarPestanaVacia();
      avisoEstado('');
    } catch (error) {
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
    try {
      var texto = await consultarAgente(mensaje, estado.sessionId);
      global.MogavelEstado.agregarRespuesta(texto);
      aplicarRespuesta(texto);
      ajustarPestanaVacia();
      avisoEstado('');
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
      avisoEstado('No hay ninguna búsqueda en curso. <a href="/index.html#mis-viajes">Empieza una nueva búsqueda</a>.');
      return;
    }

    estado.respuestas.forEach(aplicarRespuesta);
    ajustarPestanaVacia();
    $('enviarSeguimiento').addEventListener('click', enviarSeguimiento);
    $('chatMessage').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviarSeguimiento(); });

    if (estado.estado === 'pendiente') lanzarBusqueda(estado);
    else if (estado.estado === 'en_curso') mostrarReintento('La búsqueda anterior se interrumpió antes de recibir respuesta.', estado, false);
    else if (estado.estado === 'error') mostrarReintento('Ha ocurrido un error: ' + esc(estado.error || 'desconocido'), estado, true);
  }

  global.MogavelResultados = { particionar: particionar, aplicarRespuesta: aplicarRespuesta, activarPestana: activarPestana };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})(window);
