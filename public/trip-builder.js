/* Mogavel — constructor de viaje (capa UI aislada, sin llamadas a proveedores). */
(() => {
  const chosen = { flight: null, hotel: null, activities: new Map() };
  const storageKey = 'mogavel:trip-selection:v1';
  const persist = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ flight: chosen.flight, hotel: chosen.hotel, activities: [...chosen.activities.values()] })); } catch (_) {} };
  const restore = () => { try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved) { chosen.flight = saved.flight || null; chosen.hotel = saved.hotel || null; chosen.activities = new Map((saved.activities || []).map(item => [item.id, item])); } } catch (_) {} };
  const labels = { flight: 'Vuelo', hotel: 'Alojamiento', activity: 'Experiencia' };
  let panel;
  // Importe mostrado al usuario: conserva la naturaleza "desde" y distingue gratuita de pendiente.
  // La moneda es la del dato (ISO 4217); si no se conoce se dice, nunca se asume EUR.
  const formatMoney = (value, currency) => {
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      try { return value.toLocaleString('es-ES', { style: 'currency', currency }); } catch (_) { return value.toLocaleString('es-ES') + ' ' + currency; }
    }
    return value.toLocaleString('es-ES') + ' (moneda no confirmada)';
  };
  const amountLabel = price => {
    if (!price) return 'Precio por confirmar';
    if (price.free) return 'Gratuita';
    const text = formatMoney(price.value, price.currency);
    return price.basis === 'desde' ? 'Desde ' + text : price.basis === 'noche' ? text + ' por noche' : price.basis === 'total' ? text + ' total' : text;
  };

  // Total comparable de la selección. Solo se suma cuando TODOS los importes son del mismo concepto («total», «por noche» o
  // «desde») y de la misma moneda confirmada; las actividades gratuitas aportan 0 y no cambian el concepto. Nunca se suman
  // precios por noche con totales de estancia ni monedas distintas, y un elemento sin importe impide el total.
  // Devuelve { total: {value, currency, basis} | null, motivos: [...], aviso: string | null }; cada elemento conserva su importe individual.
  const MOTIVOS = {
    sin_importe: 'Hay elementos sin importe confirmado.',
    moneda_no_confirmada: 'Algún importe no tiene moneda confirmada.',
    monedas_distintas: 'Los importes están en monedas distintas.',
    conceptos_distintos: 'Los importes son de conceptos distintos (por noche, total o precio «desde»).'
  };
  function resumenPrecios(items) {
    const lista = (items || []).filter(Boolean);
    if (!lista.length) return { total: null, motivos: [], aviso: null };
    const motivos = [];
    if (lista.some(x => !x.price)) motivos.push('sin_importe');
    const pagados = lista.filter(x => x.price && !x.price.free);
    if (pagados.some(x => !(x.price.currency && /^[A-Z]{3}$/.test(x.price.currency)))) motivos.push('moneda_no_confirmada');
    else if (new Set(pagados.map(x => x.price.currency)).size > 1) motivos.push('monedas_distintas');
    if (new Set(pagados.map(x => x.price.basis || 'total')).size > 1) motivos.push('conceptos_distintos');
    if (motivos.length) {
      return { total: null, motivos, aviso: motivos.map(m => MOTIVOS[m]).join(' ') + ' No se calcula un total conjunto: consulta los importes en cada proveedor.' };
    }
    const value = Math.round(pagados.reduce((suma, x) => suma + x.price.value, 0) * 100) / 100;
    const currency = pagados.length ? pagados[0].price.currency : null;
    const basis = pagados.length ? (pagados[0].price.basis || 'total') : 'gratuita';
    return { total: { value, currency, basis }, motivos: [], aviso: null };
  }
  const totalLabel = total => {
    if (total.basis === 'gratuita') return 'Gratuita';
    const text = formatMoney(total.value, total.currency);
    if (total.basis === 'noche') return text + ' / noche';
    if (total.basis === 'desde') return 'Desde ' + text;
    return text;
  };

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const titleOf = (card, kind) => {
    if (card.dataset && card.dataset.titulo) return card.dataset.titulo;
    const selector = kind === 'flight' ? '.flight-airline' : kind === 'hotel' ? '.hotel-name' : '.activity-name';
    return textOf(card.querySelector(selector)) || textOf(card).slice(0, 110);
  };
  function moneyOf(card, kind) {
    // Tarjetas construidas desde datos estructurados (render-datos.js): importe, moneda y base vienen en data-*.
    if (card.dataset && card.dataset.kind) {
      if (card.dataset.base === 'gratis') return { value: 0, currency: null, basis: 'gratuita', free: true };
      const value = Number(card.dataset.importe);
      if (card.dataset.importe === undefined || !Number.isFinite(value) || value <= 0) return null;
      return { value, currency: card.dataset.moneda || null, basis: card.dataset.base || 'total' };
    }
    // Tarjetas antiguas (estados guardados por versiones anteriores, sin data-*): lectura del texto.
    const text = textOf(card);
    if (kind === 'activity') {
      const badge = card.querySelector('.activity-price-badge');
      const label = textOf(badge);
      if (badge && /^GRATUITA$/i.test(label)) return { value: 0, currency: null, basis: 'gratuita', free: true };
      if (!badge || /CONSULTAR PRECIO|PRECIO POR CONFIRMAR/i.test(label)) return null;
      const m = label.match(/(?:DESDE\s*)?(\d[\d.,]*)\s*€/i);
      if (!m) return null;
      const value = Number(m[1].replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(value) && value > 0 ? { value, currency: 'EUR', basis: 'desde' } : null;
    }
    const matches = [...text.matchAll(/(?:€\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|EUR|USD|GBP))/gi)];
    if (!matches.length) return null;
    const raw = matches[0][0].replace(/EUR|USD|GBP|€/gi, '').trim().replace(/\./g, '').replace(',', '.');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    const token = matches[0][0].match(/EUR|USD|GBP/i)?.[0]?.toUpperCase() || (matches[0][0].includes('€') ? 'EUR' : null);
    return { value, currency: token };
  }
  // Pinta la propuesta («Un viaje elegido por ti») en el elemento dado. Misma salida que antes de extraerla.
  function fillReview(review, items) {
    const money = amountLabel;
    const known = items.filter(x => x.price).length;
    review.innerHTML = '<div class="mtr-top"><div><span class="mtr-kicker">TU PROPUESTA</span><h3>Un viaje elegido por ti</h3><p>' + items.length + ' elementos · ' + known + ' con importe identificado</p></div><span class="mtr-stamp">✦ A tu medida</span></div><div class="mtr-grid">' + items.map(x => {
      const ico = x.kind === 'flight' ? '✈' : x.kind === 'hotel' ? '▦' : '◇';
          return '<article class="mtr-card"><span class="mtr-icon" aria-hidden="true">' + ico + '</span><div class="mtr-copy"><small>' + esc(x.type) + '</small><strong>' + esc(x.name) + '</strong><span>' + esc(money(x.price)) + '</span></div><span class="mtr-check" aria-label="Incluido">✓</span></article>';
        }).join('') + '</div><div class="mtr-bottom"><div><small>Estado del viaje</small><strong>Propuesta · Sin reservar</strong></div><span>Los importes pendientes se confirmarán con el proveedor.</span></div>';
  }
  function setupPanel() {
    if (panel?.isConnected) return;
    panel = document.createElement('aside');
    panel.id = 'mogavel-trip-builder';
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="mtb-head"><div><span class="mtb-kicker">TU VIAJE</span><strong>Tu selección</strong></div><button type="button" class="mtb-close" aria-label="Plegar o desplegar Tu viaje" aria-expanded="true">−</button></div><div class="mtb-items"></div><div class="mtb-total"></div><p class="mtb-foot">Estimación orientativa. Confirma el importe y las condiciones en el proveedor.</p><button type="button" class="mtb-continue">Continuar con mi viaje</button>';
    document.body.appendChild(panel);
    const closeBtn = panel.querySelector('.mtb-close');
    const syncCollapsed = () => { const c = panel.classList.contains('mtb-collapsed'); closeBtn.setAttribute('aria-expanded', String(!c)); closeBtn.textContent = c ? '+' : '−'; };
    const toggle = () => { panel.classList.toggle('mtb-collapsed'); syncCollapsed(); };
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    panel.querySelector('.mtb-head').addEventListener('click', toggle);
    panel.querySelector('.mtb-head').style.cursor = 'pointer';
    // En móvil el panel es un desplegable inferior: empieza plegado para no tapar los resultados.
    try { if (window.matchMedia('(max-width:700px)').matches) panel.classList.add('mtb-collapsed'); } catch (_) {}
    syncCollapsed();
    panel.querySelector('.mtb-continue').addEventListener('click', () => {
      const items = allSelected();
      if (!items.length) { alert('Selecciona al menos una opción para continuar.'); return; }
      const input = document.getElementById('chatMessage');
      const chatBox = document.getElementById('chatBox');
      // En /resultados.html la propuesta se inserta en su posición cronológica dentro de la conversación.
      const mostrarPropuesta = window.MogavelResultados && window.MogavelResultados.mostrarPropuesta;
      if (typeof mostrarPropuesta === 'function') {
        mostrarPropuesta(items.map(x => ({ kind: x.kind, type: x.type, name: x.name, price: x.price, proveedor: x.proveedor || null })));
      } else if (chatBox) {
        let review = document.getElementById('mogavel-trip-review');
        if (!review) {
          review = document.createElement('section');
          review.id = 'mogavel-trip-review';
          review.className = 'mtr-review';
          const composer = chatBox.querySelector('.chat-input');
          if (composer) chatBox.insertBefore(review, composer);
          else chatBox.appendChild(review);
        }
        fillReview(review, items);
        review.scrollIntoView({behavior:'smooth',block:'center'});
      }
      if (input) {
        input.placeholder = '¿Qué quieres ajustar? Ej. Cambiar el hotel, quitar una actividad o completar el itinerario.';
        input.value = '';
        input.focus({preventScroll:true});
      }
    });
    const style = document.createElement('style');
    style.textContent = `      .mtr-review{margin:22px 0 18px;padding:clamp(18px,3vw,30px);border:1px solid #dfe7ee;border-radius:22px;background:linear-gradient(135deg,#fff 0%,#f5f8fb 100%);box-shadow:0 14px 38px rgba(20,43,72,.07)}
      .mtr-review .mtr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px}
      .mtr-review .mtr-kicker{font-size:10px;letter-spacing:1.8px;font-weight:800;color:#d26c49}
      .mtr-review h3{margin:5px 0 4px;font:700 clamp(21px,2.4vw,29px)/1.15 Georgia,serif;color:#142b48}
      .mtr-review .mtr-top p{margin:0;color:#687b91;font-size:13px}
      .mtr-review .mtr-stamp{flex-shrink:0;background:#fff1e5;color:#a85b3a;border-radius:99px;padding:8px 12px;font-size:11px;font-weight:750}
      .mtr-review .mtr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .mtr-review .mtr-card{display:flex;align-items:flex-start;gap:12px;padding:15px;background:#fff;border:1px solid #e4eaf0;border-radius:15px;min-width:0}
      .mtr-review .mtr-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:13px;background:#edf3f7;color:#203d60;font-size:21px}
      .mtr-review .mtr-copy{display:grid;gap:4px;min-width:0;flex:1}
      .mtr-review .mtr-copy small{font-size:10px;letter-spacing:.8px;text-transform:uppercase;font-weight:800;color:#78889b}
      .mtr-review .mtr-copy strong{font-size:14px;line-height:1.35;color:#1e2c3d;overflow-wrap:anywhere}
      .mtr-review .mtr-copy span{font-size:13px;font-weight:750;color:#203d60}
      .mtr-review .mtr-check{color:#13864a;font-weight:900}
      .mtr-review .mtr-bottom{display:flex;align-items:center;justify-content:space-between;gap:18px;border-top:1px solid #e1e8ee;margin-top:16px;padding-top:14px}
      .mtr-review .mtr-bottom div{display:grid;gap:3px}
      .mtr-review .mtr-bottom small{color:#78889b;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:800}
      .mtr-review .mtr-bottom strong{color:#142b48;font-size:13px}
      .mtr-review .mtr-bottom>span{max-width:340px;color:#687b91;font-size:12px;text-align:right}
      #chatBox .chat-input{align-items:stretch}
      #chatBox #chatMessage{min-height:100px;max-height:240px;padding:16px 18px;border:1px solid #d9e2eb;border-radius:14px;font:500 15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;resize:vertical;background:#fff;color:#1e2c3d;box-shadow:inset 0 1px 2px rgba(20,43,72,.025)}
      #chatBox #chatMessage:focus{outline:3px solid rgba(32,61,96,.12);border-color:#203d60}
      #chatBox #chatMessage::placeholder{color:#8190a1}
      @media(max-width:700px){.mtr-review .mtr-grid{grid-template-columns:1fr}.mtr-review .mtr-top{display:grid}.mtr-review .mtr-bottom{align-items:flex-start;flex-direction:column}.mtr-review .mtr-bottom>span{text-align:left}}

      #mogavel-trip-builder{position:fixed;z-index:1000;right:18px;bottom:18px;width:min(460px,calc(100vw - 32px));max-height:min(78vh,850px);overflow:auto;background:#fff;border:1px solid #dce4ea;border-radius:18px;box-shadow:0 14px 50px #142b4828;padding:17px;color:#1e2c3d;font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
      #mogavel-trip-builder[hidden]{display:none!important}
      .flight-card>.mtb-select,.hotel-card>.mtb-select,.activity-card>.mtb-select{display:flex;grid-column:1/-1;grid-row:auto;width:100%;min-height:38px;margin:0;padding:10px 15px;white-space:normal;text-align:center;line-height:1.2;font-size:13px;border-radius:10px}
      .flight-card>.mtb-select{grid-column:1/-1}
      .hotel-card>.mtb-select,.activity-card>.mtb-select{align-self:stretch;justify-self:stretch;flex-basis:100%}
      .mtb-continue:disabled{opacity:.6;cursor:wait}
      .mtb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.mtb-head>div{display:grid;gap:3px}.mtb-head strong{font-size:18px;color:#142b48}.mtb-kicker{font-size:10px;letter-spacing:1.3px;color:#728498;font-weight:700}.mtb-close{border:1px solid #dce4ea;background:#fff;border-radius:8px;width:32px;height:32px;font-size:20px;color:#203d60;cursor:pointer}.mtb-items{display:grid;gap:10px}.mtb-item{display:flex;align-items:center;gap:11px;padding:13px;background:linear-gradient(110deg,#f5f8fa,#fff);border:1px solid #e7edf2;border-radius:13px;box-shadow:0 2px 8px #142b4808}.mtb-item-copy{display:grid;gap:3px}.mtb-item-icon{flex-basis:40px;height:40px;font-size:19px}.mtb-item span{font-size:13px}.mtb-item small{font-size:12px}.mtb-item-copy{flex:1;min-width:0}.mtb-item-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;background:#e8f0f4;border-radius:10px;font-size:16px}.mtb-item b{display:block;font-size:10px;letter-spacing:.35px;color:#718093;text-transform:uppercase}.mtb-item span{display:block;font-size:12px;font-weight:700;overflow-wrap:anywhere;line-height:1.35}.mtb-item small{display:block;color:#536b84;font-size:11px;font-weight:650;margin-top:3px}.mtb-remove{border:0;background:transparent;color:#a33;cursor:pointer;font-size:12px;align-self:center}.mtb-total{margin-top:14px;padding:13px;background:#f2f6f9;border:1px solid #e5ecf2;border-radius:12px;font-size:12px;color:#536b84}.mtb-total strong{display:block;color:#142b48;font-size:24px}.mtb-foot{font-size:10px;color:#778494;margin:8px 0}.mtb-continue{width:100%;padding:12px;border:0;border-radius:10px;background:#142b48;color:#fff;font-weight:700;cursor:pointer}.mtb-select{display:inline-flex;align-items:center;justify-content:center;margin-top:12px;padding:9px 13px;border:1px solid #203d60;border-radius:9px;background:#fff;color:#203d60;font-weight:700;cursor:pointer}.mtb-select[aria-pressed="true"]{background:#203d60;color:#fff}.mtb-collapsed .mtb-items,.mtb-collapsed .mtb-total,.mtb-collapsed .mtb-foot,.mtb-collapsed .mtb-continue{display:none}
      @media(max-width:700px){#mogavel-trip-builder{left:0;right:0;bottom:0;width:100%;max-height:72vh;border-radius:18px 18px 0 0;border-bottom:0;padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 34px #142b4824}.mtb-collapsed .mtb-head{margin-bottom:0}.mtb-item span{max-width:none}}
    `;
    document.head.appendChild(style);
  }
  // Alojamiento elegido: proveedor, total de la estancia, fechas y condiciones tal como se mostraron en la oferta.
  const fechaCorta = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '';
  function detalleHotel(x) {
    if (x.kind !== 'hotel' || !x.proveedor) return '';
    const partes = ['Proveedor: ' + x.proveedor];
    if (x.precioTotal) partes.push(formatMoney(x.precioTotal, x.moneda) + ' total' + (x.impuestosIncluidos === true ? ' (impuestos incluidos)' : x.impuestosIncluidos === false ? ' (sin impuestos)' : ''));
    if (x.entrada && x.salida) partes.push(fechaCorta(x.entrada) + ' → ' + fechaCorta(x.salida));
    if (x.condiciones) partes.push(x.condiciones);
    return '<small class="mtb-detalle" data-proveedor="' + esc(x.proveedor) + '">' + esc(partes.join(' · ')) + '</small>';
  }
  function allSelected() {
    return [chosen.flight, chosen.hotel, ...chosen.activities.values()].filter(Boolean);
  }
  function render() {
    setupPanel();
    persist();
    const items = allSelected();
    panel.hidden = items.length === 0;
    panel.querySelector('.mtb-kicker').textContent = items.length ? 'TU VIAJE · ' + items.length + (items.length === 1 ? ' ELEMENTO' : ' ELEMENTOS') : 'TU VIAJE';
    try { document.dispatchEvent(new CustomEvent('mogavel:seleccion')); } catch (_) {}
    panel.querySelector('.mtb-items').innerHTML = items.length ? items.map((x, i) => {
      const icon = x.kind === 'flight' ? '✈️' : x.kind === 'hotel' ? '🏨' : '◇';
      const amount = amountLabel(x.price);
      return '<div class="mtb-item"><div class="mtb-item-icon" aria-hidden="true">' + icon + '</div><div class="mtb-item-copy"><b>' + x.type + '</b><span>' + esc(x.name) + '</span><small>' + esc(amount) + '</small>' + detalleHotel(x) + '</div><button type="button" class="mtb-remove" data-i="' + i + '">Quitar</button></div>';
    }).join('') : '<p style="color:#718093;font-size:12px;margin:0">Elige un vuelo, un alojamiento y las experiencias que te interesen.</p>';
    panel.querySelectorAll('.mtb-remove').forEach(btn => btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.i)];
      if (item.kind === 'flight') chosen.flight = null;
      else if (item.kind === 'hotel') chosen.hotel = null;
      else chosen.activities.delete(item.id);
      document.querySelectorAll('.mtb-select').forEach(b => refreshButton(b));
      render();
    }));
    // El total solo se calcula si los importes son comparables (resumenPrecios); si no, se dice la causa concreta.
    const resumen = resumenPrecios(items);
    const totalEl = panel.querySelector('.mtb-total');
    totalEl.dataset.estado = !items.length ? 'vacio' : resumen.total ? 'total' : 'aviso';
    totalEl.innerHTML = !items.length ? ''
      : resumen.total
        ? '<small>' + (items.length > 1 ? 'Total estimado' : 'Importe') + '</small><strong>' + esc(totalLabel(resumen.total)) + '</strong>'
        : esc(resumen.aviso);
  }
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function refreshButton(button) {
    const kind=button.dataset.kind, id=button.dataset.id, oferta=button.dataset.oferta;
    const active=kind==='flight'?chosen.flight?.id===id:kind==='hotel'?(chosen.hotel?.id===id && (!oferta || chosen.hotel?.offerId===oferta)):chosen.activities.has(id);
    button.setAttribute('aria-pressed',String(Boolean(active)));
    button.textContent=oferta?(active?'✓ Oferta elegida':'Elegir esta oferta'):(active?'✓ Seleccionado':'Añadir a mi viaje');
    const fila=button.closest('.hotel-offer'); if(fila) fila.dataset.elegida=String(Boolean(active));
  }
  // Identificador estable: no depende del orden de las tarjetas ni de si su pestaña está visible.
  // Se calcula con título + enlace + importe; si dos tarjetas son idénticas se distinguen con un sufijo.
  const hashText = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const externalUrlOf = card => { if (card.dataset && card.dataset.url) return card.dataset.url; const a = card.querySelector('a[href^="http"]'); return a ? a.getAttribute('href') : ''; };
  function stableId(card, kind, price, vistos) {
    if (card.dataset && card.dataset.id) {
      const base0 = kind + ':' + card.dataset.id;
      const n0 = (vistos.get(base0) || 0) + 1;
      vistos.set(base0, n0);
      return n0 > 1 ? base0 + '#' + n0 : base0;
    }
    const clave = [titleOf(card, kind), externalUrlOf(card), price ? [price.value, price.currency, price.basis || ''].join('/') : ''].join('|').toLowerCase().replace(/\s+/g, ' ');
    const base = kind + ':' + hashText(clave);
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return n > 1 ? base + '#' + n : base;
  }
  function decorate() {
    const results=document.getElementById('results'); if(!results) return;
    const categories=[
      ['.flight-card','flight'],['.hotel-card','hotel'],['.activity-card','activity']
    ];
    categories.forEach(([selector,kind])=>{
      const vistos=new Map();
      results.querySelectorAll(selector).forEach((card)=>{
        const price=moneyOf(card,kind);
        const id=stableId(card,kind,price,vistos);
        // Hotel con ofertas de proveedores: se elige UNA oferta concreta (proveedor, importe, moneda y enlace), nunca la primera ni la más barata por defecto.
        const filas=kind==='hotel'?[...card.querySelectorAll('.hotel-offer')]:[];
        if(filas.length){
          filas.forEach(fila=>{
            if(fila.querySelector('.mtb-select')||fila.dataset.importe===undefined) return; // sin precio: no se ofrece elegirla
            const d=fila.dataset;
            const valor=Number(d.importe);
            const item={id,kind,type:labels[kind],name:titleOf(card,kind),
              price:Number.isFinite(valor)&&valor>0?{value:valor,currency:d.moneda||null,basis:d.base||'total'}:null,
              url:d.url||'',offerId:d.ofertaId||'',proveedor:d.proveedor||'',
              precioNoche:d.porNoche?Number(d.porNoche):null,precioTotal:d.total?Number(d.total):null,moneda:d.moneda||null,
              impuestosIncluidos:d.impuestos==='si'?true:d.impuestos==='no'?false:null,
              entrada:card.dataset.entrada||'',salida:card.dataset.salida||'',condiciones:(c=>c?textOf(c):'')(card.querySelector('.hotel-cond'))||null};
            const boton=document.createElement('button');boton.type='button';boton.className='mtb-select mtb-select-oferta';
            boton.dataset.kind='hotel';boton.dataset.id=id;boton.dataset.oferta=item.offerId;
            fila.appendChild(boton);refreshButton(boton);
            boton.addEventListener('click',()=>{
              chosen.hotel=(chosen.hotel?.id===id&&chosen.hotel.offerId===item.offerId)?null:item;
              document.querySelectorAll('.mtb-select').forEach(refreshButton);render();
            });
          });
          return;
        }
        let button=card.querySelector('.mtb-select'); if(button) return;
        const item={id,kind,type:labels[kind],name:titleOf(card,kind),price,url:externalUrlOf(card)};
        button=document.createElement('button');button.type='button';button.className='mtb-select';button.dataset.kind=kind;button.dataset.id=id;
        card.appendChild(button);
        refreshButton(button);
        button.addEventListener('click',()=>{
          if(kind==='flight') chosen.flight=chosen.flight?.id===id?null:item;
          else if(kind==='hotel') chosen.hotel=chosen.hotel?.id===id?null:item;
          else if(chosen.activities.has(id)) chosen.activities.delete(id); else chosen.activities.set(id,item);
          document.querySelectorAll('.mtb-select').forEach(refreshButton);render();
        });
      });
    });
    if(results.querySelector('.flight-card,.hotel-card,.activity-card')) {setupPanel();render();}
  }
  // Texto de contexto que se añade al mensaje enviado al agente. Mismo formato que usa index.html.
  function contextoSeleccion(message) {
    const selected = window.MogavelTripBuilder.snapshot();
    if (!selected.length) return message;
    const selection = selected.map(item => '- ' + item.type + ': ' + item.name + (item.price ? (item.price.free ? ' (gratuita según el proveedor)' : item.price.basis === 'desde' ? ' (precio orientativo "desde" del proveedor: ' + item.price.value + ' ' + (item.price.currency || 'moneda no confirmada') + '; no es un precio final garantizado)' : ' (importe mostrado: ' + item.price.value + ' ' + (item.price.currency || 'moneda no confirmada') + (item.price.basis === 'noche' ? ' por noche' : '') + ')') : ' (importe no identificado)') + (item.proveedor ? ' [proveedor elegido: ' + item.proveedor + (item.precioTotal ? '; total de la estancia ' + item.precioTotal + ' ' + (item.moneda || 'moneda no confirmada') : '') + ']' : '')).join('\n');
    return message + '\n\n[Selección actual del viaje en la web; úsala como contexto. Si pido cambiar o quitar un elemento, actualiza la propuesta y confirma claramente el cambio. No inventes precios ni des por reservados los elementos.]\n' + selection;
  }
  window.MogavelTripBuilder = {
    contexto: contextoSeleccion,
    resumenPrecios,
    rellenarPropuesta: fillReview,
    snapshot: () => allSelected().map(item => Object.assign({ kind: item.kind, type: item.type, name: item.name, price: item.price },
      item.kind === 'hotel' && item.proveedor ? { proveedor: item.proveedor, offerId: item.offerId, precioNoche: item.precioNoche, precioTotal: item.precioTotal, moneda: item.moneda, impuestosIncluidos: item.impuestosIncluidos, enlace: item.url || null, entrada: item.entrada, salida: item.salida, condiciones: item.condiciones } : {})),
    reset: () => { chosen.flight = null; chosen.hotel = null; chosen.activities.clear(); try { sessionStorage.removeItem(storageKey); } catch (_) {} document.querySelectorAll('.mtb-select').forEach(refreshButton); render(); }
  };
  restore();
  const observer=new MutationObserver(()=>decorate());
  const start=()=>{const results=document.getElementById('results');if(results)observer.observe(results,{childList:true,subtree:true});decorate();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();