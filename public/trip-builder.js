/* Mogavel — constructor de viaje (capa UI aislada, sin llamadas a proveedores). */
(() => {
  const chosen = { flight: null, hotel: null, activities: new Map() };
  const labels = { flight: 'Vuelo', hotel: 'Alojamiento', activity: 'Experiencia' };
  let panel;

  const textOf = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const titleOf = (card, kind) => {
    const selector = kind === 'flight' ? '.flight-airline' : kind === 'hotel' ? '.hotel-name' : '.activity-name';
    return textOf(card.querySelector(selector)) || textOf(card).slice(0, 110);
  };
  function moneyOf(card) {
    const text = textOf(card);
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
      const brief = items.map(x => '- ' + x.type + ': ' + x.name + (x.price ? ' (' + x.price.value.toLocaleString('es-ES',{style:'currency',currency:x.price.currency==='USD'?'USD':x.price.currency==='GBP'?'GBP':'EUR'}) + ')' : ' (precio por confirmar)')).join('\n');
      const input = document.getElementById('chatMessage');
      if (input) {
        input.value = 'Quiero continuar con este viaje y revisar/modificar mi selección:\n' + brief + '\nAyúdame a completar el itinerario y dime qué cambios puedo pedir.';
        input.focus();
        document.getElementById('chatBox')?.scrollIntoView({behavior:'smooth',block:'center'});
      }
    });
    const style = document.createElement('style');
    style.textContent = `
      #mogavel-trip-builder{position:fixed;z-index:1000;right:18px;bottom:18px;width:min(370px,calc(100vw - 28px));max-height:55vh;overflow:auto;background:#fff;border:1px solid #dce4ea;border-radius:18px;box-shadow:0 14px 50px #142b4828;padding:17px;color:#1e2c3d;font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
      .mtb-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.mtb-head>div{display:grid;gap:3px}.mtb-head strong{font-size:18px;color:#142b48}.mtb-kicker{font-size:10px;letter-spacing:1.3px;color:#728498;font-weight:700}.mtb-close{border:1px solid #dce4ea;background:#fff;border-radius:8px;width:32px;height:32px;font-size:20px;color:#203d60;cursor:pointer}.mtb-items{display:grid;gap:8px}.mtb-item{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;background:#f5f8fa;border-radius:10px}.mtb-item div{min-width:0}.mtb-item b{display:block;font-size:11px;color:#718093;text-transform:uppercase}.mtb-item span{display:block;font-size:12px;font-weight:650;overflow-wrap:anywhere}.mtb-remove{border:0;background:transparent;color:#a33;cursor:pointer;font-size:12px;align-self:center}.mtb-total{margin-top:12px;padding-top:11px;border-top:1px solid #e6eaf0;font-size:12px;color:#64748b}.mtb-total strong{display:block;color:#142b48;font-size:23px}.mtb-foot{font-size:10px;color:#778494;margin:8px 0}.mtb-continue{width:100%;padding:12px;border:0;border-radius:10px;background:#142b48;color:#fff;font-weight:700;cursor:pointer}.mtb-select{display:inline-flex;align-items:center;justify-content:center;margin-top:12px;padding:9px 13px;border:1px solid #203d60;border-radius:9px;background:#fff;color:#203d60;font-weight:700;cursor:pointer}.mtb-select[aria-pressed="true"]{background:#203d60;color:#fff}.mtb-collapsed .mtb-items,.mtb-collapsed .mtb-total,.mtb-collapsed .mtb-foot,.mtb-collapsed .mtb-continue{display:none}
      @media(max-width:600px){#mogavel-trip-builder{right:10px;bottom:10px;max-height:44vh}.mtb-item span{max-width:240px}}
    `;
    document.head.appendChild(style);
  }
  function allSelected() {
    return [chosen.flight, chosen.hotel, ...chosen.activities.values()].filter(Boolean);
  }
  function render() {
    setupPanel();
    const items = allSelected();
    panel.querySelector('.mtb-items').innerHTML = items.length ? items.map((x, i) =>
      '<div class="mtb-item"><div><b>' + x.type + '</b><span>' + esc(x.name) + '</span></div><button type="button" class="mtb-remove" data-i="' + i + '">Quitar</button></div>'
    ).join('') : '<p style="color:#718093;font-size:12px;margin:0">Elige un vuelo, un alojamiento y las experiencias que te interesen.</p>';
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
    const complete = priced.length === items.length && items.length > 0 && currencies.length === 1;
    const total = complete ? priced.reduce((sum,x) => sum + x.price.value,0) : null;
    panel.querySelector('.mtb-total').innerHTML = total !== null
      ? 'Total estimado de los elementos con precio comparable<strong>' + total.toLocaleString('es-ES',{style:'currency',currency:currencies[0]==='USD'?'USD':currencies[0]==='GBP'?'GBP':'EUR'}) + '</strong>'
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
        const price=moneyOf(card);
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
  const observer=new MutationObserver(()=>decorate());
  const start=()=>{const results=document.getElementById('results');if(results)observer.observe(results,{childList:true,subtree:true});decorate();};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();