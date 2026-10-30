// Reloj del contador de Keiko: días, horas, minutos y segundos desde el inicio del gobierno
(function () {
  var reloj = document.querySelector(".contador-reloj");
  if (!reloj) return;
  var inicio = new Date(reloj.dataset.inicio).getTime();
  var campos = {};
  reloj.querySelectorAll("[data-u]").forEach(function (el) { campos[el.dataset.u] = el; });
  function dos(n) { return n < 10 ? "0" + n : String(n); }
  function pintar() {
    var s = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
    campos.d.textContent = Math.floor(s / 86400);
    campos.h.textContent = dos(Math.floor(s / 3600) % 24);
    campos.m.textContent = dos(Math.floor(s / 60) % 60);
    campos.s.textContent = dos(s % 60);
  }
  pintar();
  setInterval(pintar, 1000);
})();
