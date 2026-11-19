/*
 * Mogavel — pantalla de carga de /resultados.html.
 *
 * Solo refleja lo que el navegador sabe de verdad: hay UNA llamada a /api/chat que devuelve todo junto,
 * así que mientras está en vuelo cada categoría solicitada figura como «Buscando…» (sin porcentajes ni
 * pasos simulados). Al terminar, cada categoría pasa a «N resultados» o «Sin resultados»; si falla, a
 * «No completada». Las categorías que el modo de búsqueda no incluye figuran como «No solicitado».
 */
(function (global) {
  'use strict';

  var RECURSOS = ['vuelos', 'hoteles', 'actividades'];
  var INCLUIDOS = {
    complete: ['vuelos', 'hoteles', 'actividades'],
    flights: ['vuelos'],
    hotels: ['hoteles'],
    activities: ['actividades']
  };
  var ETIQUETA = {
    buscando: 'Buscando…',
    con_resultados: function (n) { return n === 1 ? '1 resultado' : n + ' resultados'; },
    sin_resultados: 'Sin resultados',
    error: 'No completada',
    no_solicitado: 'No solicitado'
  };

  function recursosDelModo(modo) { return (INCLUIDOS[modo] || INCLUIDOS.complete).slice(); }

  /** Estado de cada categoría. fase: 'buscando' | 'terminada' | 'error'. conteos: {vuelos,hoteles,actividades}. */
  function estadoRecursos(modo, fase, conteos) {
    var incluidos = recursosDelModo(modo), out = {};
    RECURSOS.forEach(function (r) {
      if (incluidos.indexOf(r) === -1) out[r] = 'no_solicitado';
      else if (fase === 'buscando') out[r] = 'buscando';
      else if (fase === 'error') out[r] = 'error';
      else out[r] = (conteos && conteos[r] > 0) ? 'con_resultados' : 'sin_resultados';
    });
    return out;
  }

  function texto(estado, n) {
    var e = ETIQUETA[estado];
    return typeof e === 'function' ? e(n) : e;
  }

  function pintar(modo, fase, conteos) {
    var panel = document.getElementById('carga');
    if (!panel) return;
    var est = estadoRecursos(modo, fase, conteos);
    RECURSOS.forEach(function (r) {
      var el = panel.querySelector('[data-recurso="' + r + '"]');
      if (!el) return;
      el.setAttribute('data-estado', est[r]);
      var t = el.querySelector('.carga-estado');
      if (t) t.textContent = texto(est[r], conteos && conteos[r]);
    });
    panel.setAttribute('data-fase', fase);
    panel.setAttribute('aria-busy', fase === 'buscando' ? 'true' : 'false');
  }

  function mostrar(visible) {
    var panel = document.getElementById('carga');
    if (panel) panel.hidden = !visible;
    document.body.classList.toggle('cargando', !!visible);
  }

  /** Búsqueda lanzada y sin respuesta todavía. */
  function iniciar(modo) { pintar(modo, 'buscando'); mostrar(true); }
  /** Respuesta recibida: la pantalla de carga desaparece y los resultados ocupan su lugar. */
  function terminar(modo, conteos) { pintar(modo, 'terminada', conteos); mostrar(false); }
  /** Error o búsqueda interrumpida: ya no se está buscando; no se muestra como carga activa. */
  function fallar(modo) { pintar(modo, 'error'); mostrar(false); }
  function ocultar() { mostrar(false); }

  // Con «reducir movimiento» el avión queda quieto a mitad de ruta (las animaciones SMIL no obedecen a CSS).
  function quietoSiReducido() {
    var svg = document.getElementById('carga-svg');
    if (!svg || typeof svg.pauseAnimations !== 'function') return;
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try { svg.setCurrentTime(2.75); svg.pauseAnimations(); } catch (e) { /* sin SMIL: no hay animación que parar */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', quietoSiReducido);
  else quietoSiReducido();

  global.MogavelCarga = {
    iniciar: iniciar, terminar: terminar, fallar: fallar, ocultar: ocultar,
    estadoRecursos: estadoRecursos, recursosDelModo: recursosDelModo
  };
})(window);
