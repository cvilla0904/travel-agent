/* Mogavel — constructor de viaje (capa UI aislada, sin llamadas a proveedores). */
(() => {
  const chosen = { flight: null, hotel: null, activities: new Map() };
  const storageKey = 'mogavel:trip-selection:v1';
  const persist = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ flight: chosen.flight, hotel: chosen.hotel, activities: [...chosen.activities.values()] })); } catch (_) {} };
  const restore = () => { try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (saved) { chosen.flight = saved.flight || null; chosen.hotel = saved.hotel || null; chosen.activities = new Map((saved.activities || []).map(item => [item.id, item])); } } catch (_) {} };
  const labels = { flight: 'Vuelo', hotel: 'Alojamiento', activity: 'Experiencia' };
  let panel;

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const titleOf = (card, kind) => {
    const selector = kind === 'flight' ? '.flight-airline' : kind === 'hotel' ? '.hotel-name' : '.activity-name';
    return textOf(card.querySelector(selector)) || textOf(card).slice(0, 110);
  };
  function moneyOf(card, kind) {
    const text = textOf(card);
    if (kind === 'activity') {
      const badge = card.querySelector('.activity-price-badge');
      const label = textOf(badge);
      // Las etiquetas de estado no equivalen a una tarifa. Solo guardamos importes positivos explícitos.
      if (!badge || /GRATUITA|CONSULTAR PRECIO|PRECIO POR CONFIRMAR/i.test(label)) return null;
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
    const token = matches[0][0].match(/EUR|USD|GBP/i)?.[0]?.toUpperCase() || (matches[0][0].includes('$') ? 'USD' : 'EUR');
    return { value, currency: token };
  }
  function setupPanel() {
    if (panel?.isConnected) return;
    panel = document.createElement('aside');
    panel.id = 'mogavel-trip-builder';
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="mtb-head"><div><span class="mtb-kicker">TU VIAJE</span><strong>Tu selección</strong></div><button type="button" class="mtb-close" aria-label="Ocultar resumen">−</button></div><div class="mtb-items"></div><div class="mtb-total"></div><p class="mtb-foot">Estimación orientativa. Confirma el importe y las condiciones en el proveedor.</p><button type="button" class="mtb-continue">Continuar con mi viaje</button>';
    document.body.appendChild(panel);
    panel.querySelector('.mtb-close').addEventListener('click', () => panel.classList.toggle('mtb-collapsed'));
    panel.querySelector('.mtb-continue').addEventListener('click', () => {
      const items = allSelected();
      if (!items.length) { alert('Selecciona al menos una opción para continuar.'); return; }
      const input = document.getElementById('chatMessage');
      const chatBox = document.getElementById('chatBox');
      if (chatBox) {
        let review = document.getElementById('mogavel-trip-review');
        if (!review) {
          review = document.createElement('section');
          review.id = 'mogavel-trip-review';
          review.className = 'mtr-review';
          const composer = chatBox.querySelector('.chat-input');
          if (composer) chatBox.insertBefore(review, composer);
          else chatBox.appendChild(review);
        }
        const money = value => value ? value.value.toLocaleString('es-ES',{style:'currency',currency:value.currency==='USD'?'USD':value.currency==='GBP'?'GBP':'EUR'}) : 'Precio por confirmar';
        const known = items.filter(x => x.price).length;
        review.innerHTML = '<div class="mtr-top"><div><span class="mtr-kicker">TU PROPUESTA</span><h3>Un viaje elegido por ti</h3><p>' + items.length + ' elementos · ' + known + ' con importe identificado</p></div><span class="mtr-stamp">✦ A tu medida</span></div><div class="mtr-grid">' + items.map(x => {
          const ico = x.kind === 'flight' ? '✈' : x.kind === 'hotel' ? '▦' : '◇';
          return '<article class="mtr-card"><span class="mtr-icon" aria-hidden="true">' + ico + '</span><div class="mtr-copy"><small>' + esc(x.type) + '</small><strong>' + esc(x.name) + '</strong><span>' + esc(money(x.price)) + '</span></div><span class="mtr-check" aria-label="Incluido">✓</span></article>';
        }).join('') + '</div><div class="mtr-bottom"><div><small>Estado del viaje</small><strong>Propuesta · Sin reservar</strong></div><span>Los importes pendientes se confirmarán con el proveedor.</span></div>';
        review.scrollIntoView({behavior:'smooth',block:'center'});
      }
      if (input) {
        input.placeholder = '¿Qué quieres ajustar? Ej. Cambiar el hotel, quitar una actividad o completar el itinerario.';
        input.value = '';
        input.focus({preventScroll:true});
      }
    });
    const style = document.createElement('style');
    style.textContent = `      #mogavel-trip-review{margin:22px 0 18px;padding:clamp(18px,3vw,30px);border:1px solid #dfe7ee;border-radius:22px;background:linear-gradient(135deg,#fff 0%,#f5f8fb 100%);box-shadow:0 14px 38px rgba(20,43,72,.07)}
      #mogavel-trip-review .mtr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px}
      #mogavel-trip-review .mtr-kicker{font-size:10px;letter-spacing:1.8px;font-weight:800;color:#d26c49}
      #mogavel-trip-review h3{margin:5px 0 4px;font:700 clamp(21px,2.4vw,29px)/1.15 Georgia,serif;color:#142b48}
      #mogavel-trip-review .mtr-top p{margin:0;color:#687b91;font-size:13px}
      #mogavel-trip-review .mtr-stamp{flex-shrink:0;background:#fff1e5;color:#a85b3a;border-radius:99px;padding:8px 12px;font-size:11px;font-weight:750}
      #mogavel-trip-review .mtr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      #mogavel-trip-review .mtr-card{display:flex;align-items:flex-start;gap:12px;padding:15px;background:#fff;border:1px solid #e4eaf0;border-radius:15px;min-width:0}
      #mogavel-trip-review .mtr-icon{display:grid;place-items:center;flex:0 0 42px;height:42px;border-radius:13px;background:#edf3f7;color:#203d60;font-size:21px}
      #mogavel-trip-review .mtr-copy{display:grid;gap:4px;min-width:0;flex:1}
      #mogavel-trip-review .mtr-copy small{font-size:10px;letter-spacing:.8px;text-transform:uppercase;font-weight:800;color:#78889b}
      #mogavel-trip-review .mtr-copy strong{font-size:14px;line-height:1.35;color:#1e2c3d;overflow-wrap:anywhere}
      #mogavel-trip-review .mtr-copy span{font-size:13px;font-weight:750;color:#203d60}
      #mogavel-trip-review .mtr-check{color:#13864a;font-weight:900}
      #mogavel-trip-review .mtr-bottom{display:flex;align-items:center;justify-content:space-between;gap:18px;border-top:1px solid #e1e8ee;margin-top:16px;padding-top:14px}
      #mogavel-trip-review .mtr-bottom div{display:grid;gap:3px}
      #mogavel-trip-review .mtr-bottom small{color:#78889b;font-size:10px;text-transform:uppercase;letter-spacing:.7px;font-weight:800}
      #mogavel-trip-review .mtr-bottom strong{color:#142b48;font-size:13px}
      #mogavel-trip-review .mtr-bottom>span{max-width:340px;color:#687b91;font-size:12px;text-align:right}
      #chatBox .chat-input{align-items:stretch}
      #chatBox #chatMessage{min-height:100px;max-height:240px;padding:16px 18px;border:1px solid #d9e2eb;border-radius:14px;font:500 15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;resize:vertical;background:#fff;color:#1e2c3d;box-shadow:inset 0 1px 2px rgba(20,43,72,.025)}
      #chatBox #chatMessage:focus{outline:3px solid rgba(32,61,96,.12);border-color:#203d60}
      #chatBox #chatMessage::placeholder{color:#8190a1}
      @media(max-width:700px){#mogavel-trip-review .mtr-grid{grid-template-columns:1fr}#mogavel-trip-review .mtr-top{display:grid}#mogavel-trip-review .mtr-bottom{align-items:flex-start;flex-direction:column}#mogavel-trip-review .mtr-bottom>span{text-align:left}}

      #mogavel-trip-builder{position:fixed;z-index:1000;right:18px;bottom:18px;width:min(460px,calc(100vw - 32px));max-height:min(78vh,850px);overflow:auto;background:#fff;border:1px solid #dce4ea;border-radius:18px;box-shadow:0 14px 50px #142b4828;padding:17px;color:#1e2c3d;font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
      #mogavel-trip-builder[hidden]{display:none!important}
      .flight-card>.mtb-select,.hotel-card>.mtb-select,.activity-card>.mtb-select{display:flex;grid-column:1/-1;grid-row:auto;width:100%;min-height:38px;margin:0;padding:10px 15px;white-space:normal;text-align:center;line-height:1.2;font-size:13px;border-radius:10px}
      .flight-card>.mtb-select{grid-column:1/-1}
      .hotel-card>.mtb-select,.activity-card>.mtb-select{align-self:stretch;justify-self:stretch;flex-basis:100%}
      .mtb-continue:disabled{opacity:.6;cursor:wait}
      .mtb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.mtb-head>div{display:grid;gap:3px}.mtb-head strong{font-size:18px;color:#142b48}.mtb-kicker{font-size:10px;letter-spacing:1.3px;color:#728498;font-weight:700}.mtb-close{border:1px solid #dce4ea;background:#fff;border-radius:8px;width:32px;height:32px;font-size:20px;color:#203d60;cursor:pointer}.mtb-items{display:grid;gap:10px}.mtb-item{display:flex;align-items:center;gap:11px;padding:13px;background:linear-gradient(110deg,#f5f8fa,#fff);border:1px solid #e7edf2;border-radius:13px;box-shadow:0 2px 8px #142b4808}.mtb-item-copy{display:grid;gap:3px}.mtb-item-icon{flex-basis:40px;height:40px;font-size:19px}.mtb-item span{font-size:13px}.mtb-item small{font-size:12px}.mtb-item-copy{flex:1;min-width:0}.mtb-item-icon{display:grid;place-items:center;flex:0 0 34px;height:34px;background:#e8f0f4;border-radius:10px;font-size:16px}.mtb-item b{display:block;font-size:10px;letter-spacing:.35px;color:#718093;text-transform:uppercase}.mtb-item span{display:block;font-size:12px;font-weight:700;overflow-wrap:anywhere;line-height:1.35}.mtb-item small{display:block;color:#536b84;font-size:11px;font-weight:650;margin-top:3px}.mtb-remove{border:0;background:transparent;color:#a33;cursor:pointer;font-size:12px;align-self:center}.mtb-total{margin-top:14px;padding:13px;background:#f2f6f9;border:1px solid #e5ecf2;border-radius:12px;font-size:12px;color:#536b84}.mtb-total strong{display:block;color:#142b48;font-size:24px}.mtb-foot{font-size:10px;color:#778494;margin:8px 0}.mtb-continue{width:100%;padding:12px;border:0;border-radius:10px;background:#142b48;color:#fff;font-weight:700;cursor:pointer}.mtb-select{display:inline-flex;align-items:center;justify-content:center;margin-top:12px;padding:9px 13px;border:1px solid #203d60;border-radius:9px;background:#fff;color:#203d60;font-weight:700;cursor:pointer}.mtb-select[aria-pressed="true"]{background:#203d60;color:#fff}.mtb-collapsed .mtb-items,.mtb-collapsed .mtb-total,.mtb-collapsed .mtb-foot,.mtb-collapsed .mtb-continue{display:none}
      @media(max-width:600px){#mogavel-trip-builder{right:10px;bottom:10px;width:calc(100vw - 20px);max-height:68vh}.mtb-item span{max-width:none}}
    `;
    document.head.appendChild(style);
  }
  function allSelected() {
    return [chosen.flight, chosen.hotel, ...chosen.activities.values()].filter(Boolean);
  }
  function render() {
    setupPanel();
    persist();
    const items = allSelected();
    panel.hidden = items.length === 0;
    panel.querySelector('.mtb-items').innerHTML = items.length ? items.map((x, i) => {
      const icon = x.kind === 'flight' ? '✈️' : x.kind === 'hotel' ? '🏨' : '◇';
      const amount = x.price ? x.price.value.toLocaleString('es-ES',{style:'currency',currency:x.price.currency==='USD'?'USD':x.price.currency==='GBP'?'GBP':'EUR'}) : 'Precio por confirmar';
      return '<div class="mtb-item"><div class="mtb-item-icon" aria-hidden="true">' + icon + '</div><div class="mtb-item-copy"><b>' + x.type + '</b><span>' + esc(x.name) + '</span><small>' + esc(amount) + '</small></div><button type="button" class="mtb-remove" data-i="' + i + '">Quitar</button></div>';
    }).join('') : '<p style="color:#718093;font-size:12px;margin:0">Elige un vuelo, un alojamiento y las experiencias que te interesen.</p>';
    panel.querySelectorAll('.mtb-remove').forEach(btn => btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.i)];
      if (item.kind === 'flight') chosen.flight = null;
      else if (item.kind === 'hotel') chosen.hotel = null;
      else chosen.activities.delete(item.id);
      document.querySelectorAll('.mtb-select').forEach(b => refreshButton(b));
      render();
    }));
    const priced = items.filter(x => x.price);
    const currencies = [...new Set(priced.map(x => x.price.currency))];
    // Los proveedores expresan importes con unidades distintas (por viaje, noche, persona o actividad). No sumarlos sin una base común.
    const complete = false;
    const total = complete ? priced.reduce((sum,x) => sum + x.price.value,0) : null;
    panel.querySelector('.mtb-total').innerHTML = total !== null
      ? 'Total no calculado: los precios pueden corresponder a unidades diferentes.'
      : 'Hay precios pendientes o monedas distintas. Consulta los importes en cada proveedor.';
  }
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function refreshButton(button) {
    const kind=button.dataset.kind, id=button.dataset.id;
    const active=kind==='flight'?chosen.flight?.id===id:kind==='hotel'?chosen.hotel?.id===id:chosen.activities.has(id);
    button.setAttribute('aria-pressed',String(Boolean(active)));
    button.textContent=active?'✓ Seleccionado':'Añadir a mi viaje';
  }
  function decorate() {
    const results=document.getElementById('results'); if(!results) return;
    const categories=[
      ['.flight-card','flight'],['.hotel-card','hotel'],['.activity-card','activity']
    ];
    categories.forEach(([selector,kind])=>{
      results.querySelectorAll(selector).forEach((card,index)=>{
        let button=card.querySelector('.mtb-select'); if(button) return;
        const id=kind+':'+index+':'+titleOf(card,kind);
        const price=moneyOf(card,kind);
        const item={id,kind,type:labels[kind],name:titleOf(card,kind),price};
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
  window.MogavelTripBuilder = {
    snapshot: () => allSelected().map(item => ({ kind: item.kind, type: item.type, name: item.name, price: item.price })),
    reset: () => { chosen.flight = null; chosen.hotel = null; chosen.activities.clear(); try { sessionStorage.removeItem(storageKey); } catch (_) {} document.querySelectorAll('.mtb-select').forEach(refreshButton); render(); }
  };
  restore();
  const observer=new MutationObserver(()=>decorate());
  const start=()=>{const results=document.getElementById('results');if(results)observer.observe(results,{childList:true,subtree:true});decorate();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();