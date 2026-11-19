/* Mogavel — carrusel de recomendaciones de la portada: flechas, desplazamiento táctil (scroll-snap) y estado de las flechas. */
(function () {
  'use strict';
  var cont = document.getElementById('carrusel-viajes');
  if (!cont) return;
  var pista = cont.querySelector('.journey-grid');
  var prev = cont.querySelector('.jc-prev');
  var next = cont.querySelector('.jc-next');
  if (!pista || !prev || !next) return;

  function paso() {
    var tarjeta = pista.querySelector('.journey-card');
    if (!tarjeta) return pista.clientWidth;
    var gap = parseFloat(getComputedStyle(pista).columnGap || getComputedStyle(pista).gap) || 0;
    return tarjeta.getBoundingClientRect().width + gap;
  }
  function actualizar() {
    var max = pista.scrollWidth - pista.clientWidth;
    prev.disabled = pista.scrollLeft <= 2;
    next.disabled = pista.scrollLeft >= max - 2;
  }
  function mover(dir) {
    var reducido = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    pista.scrollBy({ left: dir * paso(), behavior: reducido ? 'auto' : 'smooth' });
  }
  prev.addEventListener('click', function () { mover(-1); });
  next.addEventListener('click', function () { mover(1); });
  pista.addEventListener('scroll', actualizar, { passive: true });
  pista.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); mover(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); mover(-1); }
  });
  window.addEventListener('resize', actualizar);
  actualizar();
})();
