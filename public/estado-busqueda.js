/*
 * Mogavel — estado de la búsqueda entre la portada y /resultados.html.
 *
 * Guarda en sessionStorage (por pestaña del navegador): sessionId, formulario, mensaje enviado
 * al agente y las respuestas recibidas. Las selecciones del viaje las guarda trip-builder.js
 * (clave propia). Nada de esto toca el backend ni los proveedores.
 *
 * Script clásico: expone `MogavelEstado`. También puede usarse con un almacén inyectado
 * (para pruebas): MogavelEstado.crear(almacen).
 */
(function (global) {
  'use strict';

  var CLAVE = 'mogavel:search:v1';
  var MAX_RESPUESTAS = 30;
  var MAX_MENSAJES = 80;

  function almacenPorDefecto() {
    try { return global.sessionStorage || null; } catch (_) { return null; }
  }

  function crear(almacen) {
    function leer() {
      try {
        var crudo = almacen && almacen.getItem(CLAVE);
        if (!crudo) return null;
        var dato = JSON.parse(crudo);
        if (!dato || dato.v !== 1 || typeof dato.sessionId !== 'string' || !Array.isArray(dato.respuestas)) return null;
        // Estados guardados antes de existir `mensajes`: se reconstruye la línea de tiempo desde las respuestas.
        if (!Array.isArray(dato.mensajes)) {
          dato.mensajes = dato.respuestas.map(function (t) { return { tipo: 'agente', texto: t, t: dato.creada || 0 }; });
        }
        return dato;
      } catch (_) { return null; }
    }

    function escribir(dato) {
      try {
        if (!almacen) return false;
        almacen.setItem(CLAVE, JSON.stringify(dato));
        // Comprobación de lectura: en modo privado algunos navegadores no lanzan error pero no guardan.
        return almacen.getItem(CLAVE) !== null;
      } catch (_) { return false; }
    }

    return {
      CLAVE: CLAVE,

      /** Registra una búsqueda nueva (estado "pendiente"). Devuelve false si no se pudo guardar. */
      iniciar: function (datos) {
        if (!datos || typeof datos.sessionId !== 'string' || !datos.sessionId || typeof datos.mensaje !== 'string' || !datos.mensaje) return false;
        return escribir({
          v: 1,
          sessionId: datos.sessionId,
          mensaje: datos.mensaje,
          formulario: datos.formulario || {},
          modo: datos.modo || 'complete',
          estado: 'pendiente',
          error: null,
          respuestas: [],
          mensajes: [],
          creada: Date.now()
        });
      },

      leer: leer,

      /** pendiente → en_curso. Evita relanzar la búsqueda (y gastar créditos) si se recarga la página. */
      marcarEnCurso: function () {
        var d = leer(); if (!d) return false;
        d.estado = 'en_curso'; d.error = null;
        return escribir(d);
      },

      /** Añade una respuesta del agente (la primera o las de seguimiento) y marca la búsqueda como completa. */
      agregarRespuesta: function (texto) {
        var d = leer(); if (!d || typeof texto !== 'string') return false;
        d.respuestas.push(texto);
        if (d.respuestas.length > MAX_RESPUESTAS) d.respuestas = d.respuestas.slice(-MAX_RESPUESTAS);
        d.mensajes.push({ tipo: 'agente', texto: texto, t: Date.now() });
        if (d.mensajes.length > MAX_MENSAJES) d.mensajes = d.mensajes.slice(-MAX_MENSAJES);
        d.estado = 'completa'; d.error = null;
        return escribir(d);
      },

      /** Petición escrita por el usuario en la conversación (va antes de la respuesta del agente). */
      agregarMensajeUsuario: function (texto) {
        var d = leer(); if (!d || typeof texto !== 'string' || !texto.trim()) return false;
        d.mensajes.push({ tipo: 'usuario', texto: texto.trim(), t: Date.now() });
        if (d.mensajes.length > MAX_MENSAJES) d.mensajes = d.mensajes.slice(-MAX_MENSAJES);
        return escribir(d);
      },

      /**
       * Registra la propuesta seleccionada («Un viaje elegido por ti») en su posición cronológica.
       * Si la última propuesta es idéntica no se duplica; si cambió la selección, se añade una nueva.
       * Devuelve { ok, nueva }.
       */
      registrarPropuesta: function (items) {
        var d = leer(); if (!d || !Array.isArray(items)) return { ok: false, nueva: false };
        var firma = JSON.stringify(items);
        var ultima = null;
        for (var i = d.mensajes.length - 1; i >= 0; i--) { if (d.mensajes[i].tipo === 'propuesta') { ultima = d.mensajes[i]; break; } }
        if (ultima && JSON.stringify(ultima.items) === firma) return { ok: true, nueva: false };
        d.mensajes.push({ tipo: 'propuesta', items: items, t: Date.now() });
        if (d.mensajes.length > MAX_MENSAJES) d.mensajes = d.mensajes.slice(-MAX_MENSAJES);
        return { ok: escribir(d), nueva: true };
      },

      marcarError: function (mensaje) {
        var d = leer(); if (!d) return false;
        d.estado = d.respuestas.length ? 'completa' : 'error';
        d.error = String(mensaje || 'Error desconocido');
        return escribir(d);
      },

      limpiar: function () {
        try { if (almacen) almacen.removeItem(CLAVE); } catch (_) { /* nada */ }
      }
    };
  }

  var api = crear(almacenPorDefecto());
  api.crear = crear;
  global.MogavelEstado = api;
})(typeof window !== 'undefined' ? window : globalThis);
