/*
 * Mogavel — precarga del formulario desde las páginas de destino: /index.html?destino=Colombia&dias=14#inicio
 * Rellena «Destino» y la idea de viaje (con la duración). Solo escribe en campos vacíos, nunca pisa lo que haya escrito la persona,
 * y no lanza ninguna búsqueda.
 */
(function () {
  'use strict';
  var q;
  try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
  var destino = (q.get('destino') || '').trim().slice(0, 80);
  var dias = parseInt(q.get('dias') || '', 10);
  if (!destino || /[<>]/.test(destino)) return;
  if (!(dias >= 1 && dias <= 60)) dias = 0;

  function aplicar() {
    var campo = document.getElementById('destino');
    var idea = document.getElementById('ideaViaje');
    if (campo && !campo.value) campo.value = destino;
    if (idea && !idea.value) {
      idea.value = 'Quiero viajar a ' + destino + (dias ? ' durante ' + dias + ' días' : '') + '.';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar);
  else aplicar();
})();
