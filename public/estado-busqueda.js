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
        d.estado = 'completa'; d.error = null;
        return escribir(d);
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
