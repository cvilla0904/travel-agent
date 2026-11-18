/*
 * Mogavel — indicador discreto «Tu viaje» en la portada.
 *
 * Si hay una selección o una búsqueda guardadas en esta pestaña (sessionStorage), muestra en la barra
 * superior cuántos elementos hay elegidos y permite volver a la propuesta o empezar un viaje nuevo
 * (con confirmación, borrando selección y conversación para no mezclarlas). Solo lee/borra las claves
 * propias de Mogavel; no llama al backend ni a ningún proveedor y no duplica el panel de selección.
 *
 * Script clásico. Expone `MogavelViajeIndicador` { leer, montar, nuevoViaje }.
 */
(function (global) {
  'use strict';

  var CLAVE_SELECCION = 'mogavel:trip-selection:v1';
  var CLAVE_BUSQUEDA = 'mogavel:search:v1';

  function almacen() { try { return global.sessionStorage || null; } catch (_) { return null; } }

  function json(clave, alm) {
    try { var c = alm && alm.getItem(clave); return c ? JSON.parse(c) : null; } catch (_) { return null; }
  }

  /** { elementos, busqueda } a partir del almacén (puede inyectarse en pruebas). */
  function leer(alm) {
    alm = alm || almacen();
    var sel = json(CLAVE_SELECCION, alm) || {};
    var elementos = (sel.flight ? 1 : 0) + (sel.hotel ? 1 : 0) + (Array.isArray(sel.activities) ? sel.activities.length : 0);
    var b = json(CLAVE_BUSQUEDA, alm);
    var busqueda = !!(b && b.v === 1 && typeof b.sessionId === 'string' && (b.respuestas && b.respuestas.length || b.estado === 'en_curso' || b.estado === 'pendiente'));
    return { elementos: elementos, busqueda: busqueda };
  }

  function nuevoViaje(alm) {
    alm = alm || almacen();
    try { if (alm) { alm.removeItem(CLAVE_SELECCION); alm.removeItem(CLAVE_BUSQUEDA); } } catch (_) { /* nada */ }
    try { if (global.MogavelTripBuilder && typeof global.MogavelTripBuilder.reset === 'function') global.MogavelTripBuilder.reset(); } catch (_) { /* nada */ }
  }

  var CSS = '' +
    '.mvi{position:relative;display:inline-flex;margin-left:auto;margin-right:12px}' +
    '.mvi[hidden]{display:none!important}' +
    '.mvi-btn{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:99px;border:1px solid #d9e1ea;background:#fff;color:#142b48;white-space:nowrap;font:700 13px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(20,43,72,.06)}' +
    '.mvi-btn:hover{border-color:#b9c7d6}.mvi-btn:focus-visible{outline:3px solid rgba(32,61,96,.28);outline-offset:2px}' +
    '.mvi-btn .mvi-txt{margin:0 0 0 -1px}.mvi-n{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#13864a;color:#fff;font-size:12px}' +
    '.mvi-n[data-cero="1"]{background:#edf2f7;color:#203d60}' +
    '@media(max-width:420px){.mvi-txt{display:none}.mvi-btn{gap:6px}}' +
    '@media(max-width:340px){header .nav{gap:6px}header .login{padding-left:9px;padding-right:9px;font-size:12px}.mvi{margin-right:0}}' +
    '.mvi-pop{position:absolute;right:0;top:calc(100% + 10px);z-index:60;width:min(320px,calc(100vw - 32px));padding:16px;border-radius:16px;border:1px solid #dfe7ee;background:#fff;color:#142b48;box-shadow:0 18px 44px rgba(20,43,72,.18);font:400 14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;text-align:left}' +
    '.mvi-pop[hidden]{display:none}' +
    '.mvi-pop strong{display:block;font-size:15px;margin-bottom:2px}' +
    '.mvi-pop p{margin:0 0 12px;color:#5d6f84}' +
    '.mvi-acc{display:grid;gap:8px}' +
    '.mvi-acc a,.mvi-acc button{display:block;width:100%;box-sizing:border-box;padding:11px 14px;border-radius:11px;border:1px solid #d9e1ea;background:#fff;color:#142b48;font:700 14px/1.2 inherit;text-align:center;text-decoration:none;cursor:pointer}' +
    '.mvi-acc a.mvi-main{background:#142b48;border-color:#142b48;color:#fff}' +
    '.mvi-acc button.mvi-peligro{color:#8a2c2c;border-color:#f1c4c4;background:#fff}' +
    '.mvi-conf p{color:#8a2c2c;margin-bottom:10px}' +
    '@media(max-width:600px){header .login{white-space:nowrap;padding-left:12px;padding-right:12px;font-size:13px}.mvi{margin-right:4px}.mvi-btn{padding:8px 10px;font-size:12.5px}.mvi-pop{position:fixed;left:16px;right:16px;top:72px;width:auto}}';

  function montar(doc, alm) {
    doc = doc || global.document;
    if (!doc || doc.getElementById('mogavel-viaje-indicador')) return null;
    var nav = doc.querySelector('header .nav');
    if (!nav) return null;
    var st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);

    var cont = doc.createElement('div');
    cont.id = 'mogavel-viaje-indicador'; cont.className = 'mvi'; cont.hidden = true;
    cont.innerHTML = '<button type="button" class="mvi-btn" aria-expanded="false" aria-controls="mvi-pop"><span aria-hidden="true">✦</span><span class="mvi-txt">Tu viaje</span><span class="mvi-n" aria-hidden="true">0</span></button>' +
      '<div class="mvi-pop" id="mvi-pop" role="dialog" aria-label="Tu viaje" hidden></div>';
    var login = nav.querySelector('.login');
    if (login) nav.insertBefore(cont, login); else nav.appendChild(cont);

    var btn = cont.querySelector('.mvi-btn'), pop = cont.querySelector('.mvi-pop'), num = cont.querySelector('.mvi-n');

    function cerrar() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function vistaPrincipal(estado) {
      var t = estado.elementos === 0 ? 'Aún no has elegido nada' : estado.elementos === 1 ? '1 elemento seleccionado' : estado.elementos + ' elementos seleccionados';
      pop.innerHTML = '<strong>' + t + '</strong><p>Tu propuesta sigue guardada en esta pestaña. Puedes retomarla o empezar de cero.</p>' +
        '<div class="mvi-acc"><a class="mvi-main" href="/resultados.html">Recuperar mi propuesta</a><button type="button" class="mvi-peligro" data-accion="nuevo">Empezar un viaje nuevo</button></div>';
    }
    function vistaConfirmar() {
      pop.innerHTML = '<div class="mvi-conf"><strong>¿Empezar un viaje nuevo?</strong><p>Se borrarán la selección y la conversación actuales. No se mezclarán con el viaje nuevo.</p>' +
        '<div class="mvi-acc"><button type="button" class="mvi-peligro" data-accion="confirmar">Sí, empezar de cero</button><button type="button" data-accion="cancelar">Cancelar</button></div></div>';
    }
    function actualizar() {
      var e = leer(alm);
      var visible = e.elementos > 0 || e.busqueda;
      cont.hidden = !visible;
      num.textContent = String(e.elementos);
      num.setAttribute('data-cero', e.elementos === 0 ? '1' : '0');
      btn.setAttribute('aria-label', 'Tu viaje: ' + e.elementos + (e.elementos === 1 ? ' elemento seleccionado' : ' elementos seleccionados'));
      if (!visible) cerrar();
      return e;
    }

    btn.addEventListener('click', function () {
      if (pop.hidden) { vistaPrincipal(actualizar()); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
      else cerrar();
    });
    pop.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('[data-accion]');
      if (!a) return;
      var acc = a.getAttribute('data-accion');
      if (acc === 'nuevo') { vistaConfirmar(); var c = pop.querySelector('[data-accion="cancelar"]'); if (c) c.focus(); }
      else if (acc === 'cancelar') { vistaPrincipal(leer(alm)); btn.focus(); }
      else if (acc === 'confirmar') { nuevoViaje(alm); actualizar(); cerrar(); doc.dispatchEvent(new global.CustomEvent('mogavel:viaje-nuevo')); }
    });
    // Un clic sobre un nodo que ya se retiró del DOM (al cambiar de vista) no cuenta como «fuera».
    doc.addEventListener('click', function (ev) { if (ev.target.isConnected && !cont.contains(ev.target)) cerrar(); });
    doc.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !pop.hidden) { cerrar(); btn.focus(); } });
    global.addEventListener('pageshow', actualizar);   // volver con «Atrás» (bfcache)
    global.addEventListener('storage', actualizar);
    doc.addEventListener('mogavel:seleccion', actualizar);
    actualizar();
    return cont;
  }

  global.MogavelViajeIndicador = { leer: leer, montar: montar, nuevoViaje: nuevoViaje };
  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', function () { montar(); });
    else montar();
  }
})(typeof window !== 'undefined' ? window : globalThis);
