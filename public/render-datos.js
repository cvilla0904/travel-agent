/*
 * Mogavel — tarjetas de resultados construidas DIRECTAMENTE desde los datos estructurados de /api/chat
 * (`resultados`, contrato versión 1: src/services/resultados-estructurados.ts).
 *
 * No lee ni interpreta el texto del modelo: si el Travel Manager cambia su redacción, las tarjetas no cambian.
 * Reglas:
 *  - Un dato ausente se muestra como ausente («Precio no disponible», «Moneda no confirmada»); nunca se inventa ni se
 *    sustituye por 0 o por una moneda por defecto. No se convierte entre monedas.
 *  - Cada tarjeta lleva data-* con los valores reales (id, título, importe, moneda, base del precio, enlace) para que el
 *    constructor de viaje («Añadir a mi viaje») no tenga que leer texto.
 *  - Un fallo del proveedor se distingue de «sin resultados» y de «resultados parciales».
 * Mismas clases CSS que las tarjetas anteriores (resultados.css).
 */
(function (global) {
  'use strict';

  var TIPOS = ['vuelos', 'hoteles', 'actividades'];

  /* ---------- utilidades ---------- */

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto !== undefined && texto !== null && texto !== '') n.textContent = String(texto);
    return n;
  }
  function urlSegura(u) { return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null; }
  function enlace(clase, href, texto) {
    var a = el('a', clase + ' result-link', texto);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** «240,00 €», «USD 25,00»… con la moneda ISO del dato. Sin moneda: el número y «moneda no confirmada». Sin importe: null. */
  function formatearImporte(importe, moneda) {
    if (num(importe) === null) return null;
    if (typeof moneda === 'string' && /^[A-Z]{3}$/.test(moneda)) {
      try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda }).format(importe); }
      catch (_) { return importe.toLocaleString('es-ES') + ' ' + moneda; }
    }
    return importe.toLocaleString('es-ES') + ' (moneda no confirmada)';
  }
  function duracion(min) {
    min = num(min); if (!min || min <= 0) return null;
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h ? h + ' h ' : '') + (m ? (h ? String(m).padStart(2, '0') : m) + ' min' : '').trim();
  }
  function escalas(n) { n = num(n); return n === null ? null : n === 0 ? 'Directo' : n === 1 ? '1 escala' : n + ' escalas'; }
  function hora(texto) {
    if (typeof texto !== 'string') return '';
    var m = texto.match(/(\d{1,2}:\d{2})/);
    return m ? m[1] : texto;
  }
  function decimal(n) { return n.toLocaleString('es-ES', { maximumFractionDigits: 1 }); }
  function marcar(card, tipo, id, titulo) {
    card.dataset.kind = tipo; card.dataset.id = id; card.dataset.titulo = titulo;
  }
  function marcarPrecio(card, importe, moneda, base) {
    if (num(importe) !== null) { card.dataset.importe = String(importe); card.dataset.base = base; }
    if (moneda) card.dataset.moneda = moneda;
  }

  /* ---------- avisos de estado de un bloque ---------- */

  var ROTULO = { vuelos: 'vuelos', hoteles: 'alojamientos', actividades: 'actividades' };

  /** Distingue fallo del proveedor (no significa que no existan resultados), sin resultados y parcial. */
  function notaEstado(bloque) {
    var notas = [];
    var nombre = bloque.proveedor && bloque.proveedor.nombre ? bloque.proveedor.nombre : 'el proveedor';
    var que = ROTULO[bloque.tipo] || 'resultados';
    var estado = bloque.estado;
    if (estado === 'error_proveedor' || estado === 'error_interno' || estado === 'error_parametros') {
      var detalle = estado === 'error_parametros' ? 'La búsqueda no se pudo lanzar: ' : 'No se han podido consultar los ' + que + ' (' + nombre + '). ';
      var n = el('div', 'search-note estado-bloque estado-error', detalle + (bloque.error || 'Error sin detalle.') + (estado === 'error_parametros' ? '' : ' Esto no significa que no existan; inténtalo de nuevo.'));
      n.setAttribute('role', 'status');
      notas.push(n);
    } else if (estado === 'sin_resultados') {
      var s = el('div', 'search-note estado-bloque estado-vacio', 'Sin ' + que + ': ' + nombre + ' respondió sin opciones para esta búsqueda.');
      s.setAttribute('role', 'status');
      notas.push(s);
    } else if (estado === 'parcial' || bloque.completo === false) {
      var p = el('div', 'search-note estado-bloque estado-parcial', 'Resultados parciales de ' + nombre + ': puede haber más ' + que + ' que no se han podido recoger.');
      p.setAttribute('role', 'status');
      notas.push(p);
    }
    (bloque.avisos || []).forEach(function (a) {
      if (!a) return;
      var x = el('div', 'search-note estado-bloque estado-aviso', a);
      x.setAttribute('role', 'status');
      notas.push(x);
    });
    notas.forEach(function (n) { n.dataset.estado = estado; });
    return notas;
  }

  /* ---------- VUELOS ---------- */

  function tramoDOM(etiqueta, tramo) {
    if (!tramo || !tramo.segmentos || !tramo.segmentos.length) return null;
    var seg = tramo.segmentos, primero = seg[0], ultimo = seg[seg.length - 1];
    var punto = function (p) { return (hora(p.hora) + ' ' + (p.aeropuerto || '') + (p.codigo ? ' (' + p.codigo + ')' : '')).trim(); };
    var leg = el('div', 'flight-leg');
    leg.appendChild(el('span', 'flight-leg-label', etiqueta));
    var ruta = el('div', 'flight-leg-route');
    ruta.appendChild(el('span', null, punto(primero.salida)));
    ruta.appendChild(el('span', 'flight-route-arrow', '→'));
    ruta.appendChild(el('span', null, punto(ultimo.llegada)));
    leg.appendChild(ruta);
    var meta = [tramo.fecha, duracion(tramo.duracionMinutos), escalas(tramo.escalas),
      seg.map(function (s) { return s.numeroVuelo; }).filter(Boolean).join(' + ')].filter(Boolean).join(' · ');
    if (meta) leg.appendChild(el('div', 'flight-leg-meta', meta));
    return leg;
  }

  function tarjetaVuelo(v) {
    var card = el('article', 'flight-card');
    var titulo = (v.aerolineas && v.aerolineas.length ? v.aerolineas.join(' + ') : 'Aerolínea no indicada');
    marcar(card, 'flight', v.id, titulo);
    var main = el('div', 'flight-main');
    var air = el('div', 'flight-airline');
    (v.aerolineas && v.aerolineas.length ? v.aerolineas : ['Aerolínea no indicada']).forEach(function (a) { air.appendChild(el('span', 'flight-carrier', a)); });
    main.appendChild(air);
    var it = el('div', 'flight-itinerary');
    var ida = tramoDOM('IDA', v.ida), vuelta = tramoDOM('VUELTA', v.vuelta);
    if (ida) it.appendChild(ida);
    if (vuelta) it.appendChild(vuelta);
    main.appendChild(it);
    var extra = [v.tipo, v.esDirecto === true ? 'Vuelo directo' : null,
      v.precio && num(v.precio.porPersona) !== null ? formatearImporte(v.precio.porPersona, v.precio.moneda) + ' por persona' : null].filter(Boolean);
    if (extra.length) main.appendChild(el('div', 'flight-extra', extra.join(' · ')));
    card.appendChild(main);
    var precio = el('div', 'flight-price');
    var txt = v.precio && formatearImporte(v.precio.importe, v.precio.moneda);
    precio.appendChild(document.createTextNode(txt || 'Precio no disponible'));
    precio.appendChild(el('small', null, txt ? 'Precio total' : ''));
    card.appendChild(precio);
    marcarPrecio(card, v.precio && v.precio.importe, v.precio && v.precio.moneda, 'total');
    var href = urlSegura(v.enlace);
    if (href) {
      card.dataset.url = href;
      card.appendChild(enlace('flight-select', href, v.enlaceEsBusqueda ? 'Ver búsqueda en Google Flights ↗' : 'Ver oferta de vuelo ↗'));
    } else card.appendChild(el('span', 'flight-no-link', 'Enlace no disponible'));
    return card;
  }

  function seccionVuelos(bloque) {
    var sec = el('section'); sec.dataset.bloque = 'vuelos'; sec.dataset.estado = bloque.estado; sec.dataset.total = String(bloque.total);
    sec.appendChild(el('h3', 'result-section-title flights', 'Vuelos'));
    var c = bloque.consulta || {};
    var ruta = [c.origen && (c.origen.iata || c.origen.texto), c.destino && (c.destino.iata || c.destino.texto)].filter(Boolean).join(' → ');
    if (ruta) sec.appendChild(el('div', 'bloque-consulta', ruta + (c.fechaIda ? ' · ' + c.fechaIda : '') + (c.fechaVuelta ? ' → ' + c.fechaVuelta : '')));
    notaEstado(bloque).forEach(function (n) { sec.appendChild(n); });
    if (bloque.opciones.length) {
      var lista = el('div', 'flight-results');
      bloque.opciones.forEach(function (v) { lista.appendChild(tarjetaVuelo(v)); });
      sec.appendChild(lista);
    }
    return sec;
  }

  /* ---------- HOTELES ---------- */

  function mediana(xs) {
    if (!xs.length) return null;
    var s = xs.slice().sort(function (a, b) { return a - b; }), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function puntuacion(h) {
    return num(h.valoracion) !== null && num(h.valoracionEscala) ? h.valoracion / h.valoracionEscala : null;
  }

  /**
   * Agrupa los alojamientos de un bloque (cada uno en UNA categoría) con una regla determinista sobre los datos:
   * recomendados = buena puntuación (≥ 84 % de la escala) con al menos 100 reseñas; económicos = precio por noche igual o
   * inferior a la mediana de su moneda, puntuación ≥ 76 % y al menos 30 reseñas; el resto, «Otros alojamientos».
   * Solo se comparan precios en la misma moneda.
   */
  function categorizarHoteles(opciones) {
    var porMoneda = {};
    opciones.forEach(function (h) {
      var p = h.precio;
      if (p && p.disponible && num(p.porNoche) !== null && p.moneda) (porMoneda[p.moneda] = porMoneda[p.moneda] || []).push(p.porNoche);
    });
    var med = {}; Object.keys(porMoneda).forEach(function (k) { med[k] = mediana(porMoneda[k]); });
    var rec = [], eco = [], otros = [];
    opciones.forEach(function (h) {
      var r = puntuacion(h), res = num(h.numeroResenas) || 0;
      if (r !== null && r >= 0.84 && res >= 100) { rec.push(h); return; }
      var p = h.precio;
      var barato = p && p.disponible && p.moneda && num(p.porNoche) !== null && med[p.moneda] !== undefined && p.porNoche <= med[p.moneda];
      if (barato && r !== null && r >= 0.76 && res >= 30) eco.push(h); else otros.push(h);
    });
    return [{ titulo: 'Alojamientos recomendados', hoteles: rec }, { titulo: 'Alojamientos económicos', hoteles: eco }, { titulo: 'Otros alojamientos', hoteles: otros }]
      .filter(function (g) { return g.hoteles.length; });
  }

  /** Ofertas de un hotel ordenadas por precio (las sin precio, al final); a igual precio, por proveedor. No se elige ninguna por el usuario. */
  function ofertasOrdenadas(h) {
    return (h.ofertas || []).slice().sort(function (a, b) {
      var pa = num(a.porNocheMostrado) !== null ? a.porNocheMostrado : num(a.totalMostrado), pb = num(b.porNocheMostrado) !== null ? b.porNocheMostrado : num(b.totalMostrado);
      if (pa === null && pb === null) return String(a.proveedor).localeCompare(String(b.proveedor), 'es');
      if (pa === null) return 1; if (pb === null) return -1;
      return pa - pb || String(a.proveedor).localeCompare(String(b.proveedor), 'es');
    });
  }
  function textoImpuestos(inc) { return inc === true ? 'impuestos incluidos' : inc === false ? 'sin impuestos' : null; }

  /** Fila de una oferta de proveedor: proveedor, importes y enlace. El botón de elegirla lo añade trip-builder.js (solo si tiene precio). */
  function filaOferta(h, o, bloque) {
    var li = el('li', 'hotel-offer');
    var moneda = o.moneda || (h.precio && h.precio.moneda) || null;
    var noche = num(o.porNocheMostrado), total = num(o.totalMostrado);
    li.dataset.ofertaId = o.id || '';
    li.dataset.hotelId = h.id;
    li.dataset.proveedor = o.proveedor || '';
    if (noche !== null || total !== null) {
      li.dataset.importe = String(noche !== null ? noche : total);
      li.dataset.base = noche !== null ? 'noche' : 'total';
    }
    if (moneda) li.dataset.moneda = moneda;
    if (total !== null) li.dataset.total = String(total);
    if (noche !== null) li.dataset.porNoche = String(noche);
    if (o.impuestosIncluidos === true || o.impuestosIncluidos === false) li.dataset.impuestos = o.impuestosIncluidos ? 'si' : 'no';
    var href = urlSegura(o.enlace);
    if (href) li.dataset.url = href;

    li.appendChild(el('span', 'hotel-offer-provider', o.proveedor || 'Proveedor'));
    var precio = el('span', 'hotel-offer-price');
    var pn = noche !== null ? formatearImporte(noche, moneda) : null, pt = total !== null ? formatearImporte(total, moneda) : null;
    if (pn || pt) {
      if (pn) precio.appendChild(el('strong', null, pn + ' / noche'));
      if (pt) precio.appendChild(el('small', null, pt + ' total' + (textoImpuestos(o.impuestosIncluidos) ? ' · ' + textoImpuestos(o.impuestosIncluidos) : '')));
    } else precio.appendChild(el('small', null, 'Precio no disponible'));
    li.appendChild(precio);
    li.appendChild(href ? enlace('hotel-offer-link', href, 'Ver oferta ↗') : el('span', 'hotel-no-link', 'Enlace no disponible'));
    return li;
  }

  function tarjetaHotel(h, bloque) {
    var card = el('article', 'hotel-card');
    marcar(card, 'hotel', h.id, h.nombre);
    var consulta = bloque.consulta || {};
    card.dataset.entrada = consulta.fechaEntrada || ''; card.dataset.salida = consulta.fechaSalida || '';

    var top = el('div', 'hotel-top');
    var main = el('div', 'hotel-main');
    main.appendChild(el('div', 'hotel-name', h.nombre));
    // Categoría, estrellas y valoración de usuarios. Sin valoración del proveedor se dice así (nunca se inventa ni se sustituye por estrellas).
    var resenas = num(h.numeroResenas) ? h.numeroResenas.toLocaleString('es-ES') + ' reseñas' : null;
    var meta = [h.tipoAlojamiento, num(h.estrellas) !== null ? '★'.repeat(Math.max(1, Math.min(5, Math.round(h.estrellas)))) : null];
    if (num(h.valoracion) !== null) meta.push(decimal(h.valoracion) + (num(h.valoracionEscala) ? '/' + decimal(h.valoracionEscala) : '') + (resenas ? ' (' + resenas + ')' : ''));
    else meta.push('Sin valoración del proveedor' + (resenas ? ' (' + resenas + ')' : ''));
    main.appendChild(el('div', 'hotel-meta', meta.filter(Boolean).join(' · ')));
    var ubic = [h.zona, h.distanciaCentro && 'a ' + h.distanciaCentro + ' del centro'].filter(Boolean).join(' · ');
    if (ubic) main.appendChild(el('div', 'hotel-loc', ubic));
    var cond = [h.habitacion, h.cancelacionGratuita ? 'Cancelación gratuita' + (h.cancelacionHasta ? ' hasta ' + h.cancelacionHasta : '') : null].filter(Boolean).join(' · ');
    if (cond) main.appendChild(el('div', 'hotel-cond', cond));
    top.appendChild(main);

    // Precio del hotel (de su oferta principal). Con varias ofertas se resume como «desde» la más barata de las mostradas.
    var p = h.precio || {};
    var ofertas = ofertasOrdenadas(h);
    var conPrecio = ofertas.filter(function (o) { return num(o.porNocheMostrado) !== null || num(o.totalMostrado) !== null; });
    var porNoche = p.disponible ? p.porNoche : null, total = p.disponible ? p.total : null, moneda = p.moneda;
    var desde = false;
    if (conPrecio.length) {
      var o0 = conPrecio[0];
      porNoche = num(o0.porNocheMostrado); total = num(o0.totalMostrado); moneda = o0.moneda || moneda;
      desde = conPrecio.length > 1 && conPrecio.some(function (o) { return (o.porNocheMostrado !== o0.porNocheMostrado) || (o.totalMostrado !== o0.totalMostrado); });
    }
    var caja = el('div', 'hotel-price');
    var pn = formatearImporte(porNoche, moneda), pt = formatearImporte(total, moneda);
    if (pn || pt) {
      if (pn) caja.appendChild(el('strong', null, (desde ? 'Desde ' : '') + pn + ' / noche'));
      if (pt) caja.appendChild(el('small', null, pt + ' total de la estancia' + (conPrecio.length ? '' : (textoImpuestos(p.impuestosIncluidos) ? ' · ' + textoImpuestos(p.impuestosIncluidos) : '')) + (p.calculado && !conPrecio.length ? ' · importe calculado' : '')));
    } else caja.appendChild(el('small', null, 'Precio no disponible'));
    top.appendChild(caja);
    card.appendChild(top);
    marcarPrecio(card, num(p.porNoche) !== null && p.disponible ? p.porNoche : (p.disponible ? p.total : null), p.moneda, num(p.porNoche) !== null && p.disponible ? 'noche' : 'total');

    if (ofertas.length) {
      var sec = el('section', 'hotel-compare');
      sec.setAttribute('aria-label', 'Ofertas de ' + h.nombre);
      sec.appendChild(el('h5', 'hotel-compare-title', ofertas.length > 1 ? 'Compara ofertas' : 'Oferta disponible'));
      var lista = el('ul', 'hotel-offers');
      ofertas.forEach(function (o) { lista.appendChild(filaOferta(h, o, bloque)); });
      sec.appendChild(lista);
      card.appendChild(sec);
    } else {
      // Sin ofertas por proveedor: solo el enlace de respaldo (ficha del buscador), sin presentarlo como oferta.
      var href = urlSegura(h.enlace);
      if (href) {
        card.dataset.url = href;
        card.appendChild(enlace('hotel-link', href, h.enlaceEsAlternativo ? 'Ver en ' + (bloque.proveedor.id === 'apify-google-hotels' ? 'Google Hoteles' : bloque.proveedor.nombre) + ' ↗' : 'Ver alojamiento ↗'));
      } else card.appendChild(el('span', 'hotel-no-link', 'Enlace no disponible'));
    }
    return card;
  }

  function seccionHoteles(bloque) {
    var sec = el('section'); sec.dataset.bloque = 'hoteles'; sec.dataset.estado = bloque.estado; sec.dataset.total = String(bloque.total);
    sec.style.marginTop = '24px';
    sec.appendChild(el('h3', 'result-section-title hotels', 'Alojamientos'));
    notaEstado(bloque).forEach(function (n) { sec.appendChild(n); });
    if (bloque.opciones.length) {
      var rejilla = el('div', 'hotel-category-grid');
      categorizarHoteles(bloque.opciones).forEach(function (g) {
        var cat = el('section', 'hotel-category');
        cat.appendChild(el('h4', 'hotel-category-title', g.titulo));
        var lista = el('div', 'hotel-results');
        g.hoteles.forEach(function (h) { lista.appendChild(tarjetaHotel(h, bloque)); });
        cat.appendChild(lista);
        rejilla.appendChild(cat);
      });
      sec.appendChild(rejilla);
    }
    return sec;
  }

  /* ---------- ACTIVIDADES ---------- */

  function tarjetaActividad(a) {
    var card = el('article', 'activity-card');
    marcar(card, 'activity', a.id, a.nombre);
    var main = el('div', 'activity-main');
    main.appendChild(el('div', 'activity-name', a.nombre));
    var det = [a.tipo, a.duracion, num(a.valoracion) !== null ? decimal(a.valoracion) + (num(a.numeroResenas) ? ' (' + a.numeroResenas.toLocaleString('es-ES') + ' reseñas)' : '') : null,
      a.plataforma, a.cancelacionGratuita ? 'Cancelación gratuita' : null].filter(Boolean);
    main.appendChild(el('div', 'activity-detail', det.join(' — ')));
    card.appendChild(main);
    var pr = a.precio || {};
    var badge;
    if (pr.esGratis) { badge = el('div', 'activity-price-badge free', 'GRATUITA'); badge.setAttribute('aria-label', 'Actividad anunciada como gratuita'); card.classList.add('is-free'); card.dataset.base = 'gratis'; }
    else if (num(pr.importe) !== null) {
      badge = el('div', 'activity-price-badge from', 'DESDE ' + formatearImporte(pr.importe, pr.moneda));
      badge.setAttribute('aria-label', 'Precio anunciado'); card.classList.add('is-paid'); marcarPrecio(card, pr.importe, pr.moneda, 'desde');
    } else { badge = el('div', 'activity-price-badge unknown', 'PRECIO NO DISPONIBLE'); badge.setAttribute('aria-label', 'Precio no facilitado por el proveedor'); }
    card.appendChild(badge);
    var href = urlSegura(a.enlace);
    if (href) { card.dataset.url = href; card.appendChild(enlace('activity-link', href, 'Ver actividad ↗')); }
    return card;
  }

  function seccionActividades(bloque) {
    var sec = el('section'); sec.dataset.bloque = 'actividades'; sec.dataset.estado = bloque.estado; sec.dataset.total = String(bloque.total);
    sec.style.marginTop = '24px';
    sec.appendChild(el('h3', 'result-section-title activities', 'Actividades'));
    notaEstado(bloque).forEach(function (n) { sec.appendChild(n); });
    if (bloque.opciones.length) {
      var lista = el('div', 'activity-results');
      bloque.opciones.forEach(function (a) { lista.appendChild(tarjetaActividad(a)); });
      sec.appendChild(lista);
    }
    return sec;
  }

  /* ---------- paneles ---------- */

  var SECCION = { vuelos: seccionVuelos, hoteles: seccionHoteles, actividades: seccionActividades };

  /** Varias secciones del mismo tipo (p. ej. una por ciudad) se agrupan bajo el título de su destino. */
  function nodosDeTipo(tipo, bloques) {
    if (!bloques.length) return [];
    if (tipo === 'vuelos' || bloques.length === 1) return bloques.map(SECCION[tipo]);
    return bloques.map(function (b) {
      var sec = el('section', 'multicity-section'); sec.style.marginTop = '28px';
      sec.appendChild(el('h3', 'multicity-title', (b.consulta && b.consulta.destino) || 'Destino'));
      sec.appendChild(SECCION[tipo](b));
      return sec;
    });
  }

  function hayResultados(r) {
    return !!r && typeof r === 'object' && TIPOS.some(function (t) { return Array.isArray(r[t]) && r[t].length > 0; });
  }

  /** { vuelos:[nodos], hoteles:[nodos], actividades:[nodos], conteos:{…}, bloques:{…} }: solo los tipos con bloques en esta respuesta. */
  function paneles(r) {
    var out = { vuelos: [], hoteles: [], actividades: [], conteos: { vuelos: 0, hoteles: 0, actividades: 0 } };
    if (!r) return out;
    TIPOS.forEach(function (t) {
      var bloques = Array.isArray(r[t]) ? r[t] : [];
      out[t] = nodosDeTipo(t, bloques);
      out.conteos[t] = bloques.reduce(function (n, b) { return n + (b.opciones ? b.opciones.length : 0); }, 0);
    });
    return out;
  }

  /**
   * Para la portada (sin pestañas): cada tipo en su contenedor [data-panel-tipo]. Solo se sustituyen los tipos que trae esta
   * respuesta; un seguimiento sin búsquedas (o solo de hoteles) no borra el resto de tarjetas ya mostradas.
   */
  function renderizar(r, destino) {
    var p = paneles(r);
    TIPOS.forEach(function (t) {
      if (!p[t].length) return;
      Array.prototype.forEach.call(destino.querySelectorAll('[data-panel-tipo="' + t + '"]'), function (n) { n.remove(); });
      var caja = el('div'); caja.dataset.panelTipo = t;
      p[t].forEach(function (n) { caja.appendChild(n); });
      destino.appendChild(caja);
    });
    return p.conteos;
  }

  global.MogavelDatos = {
    hayResultados: hayResultados, paneles: paneles, renderizar: renderizar, categorizarHoteles: categorizarHoteles,
    formatearImporte: formatearImporte, TIPOS: TIPOS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.MogavelDatos;
})(typeof window !== 'undefined' ? window : globalThis);
