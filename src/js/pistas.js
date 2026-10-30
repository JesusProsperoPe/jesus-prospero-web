// Formulario "¿Escuchaste una mentira del gobierno?": envía la pista a /api/pistas
(function () {
  var form = document.getElementById("pista-form");
  if (!form) return;
  var aviso = document.getElementById("pista-aviso");
  var boton = form.querySelector("button[type=submit]");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var datos = {};
    new FormData(form).forEach(function (v, k) { datos[k] = String(v).trim(); });
    if (datos.que_dijo.length < 15) {
      aviso.textContent = "Cuéntame qué se dijo (al menos una frase).";
      aviso.className = "pista-aviso pista-error";
      return;
    }
    boton.disabled = true;
    aviso.textContent = "Enviando…";
    aviso.className = "pista-aviso";
    fetch("/api/pistas", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(datos),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.j.error || "No se pudo enviar.");
        form.reset();
        aviso.textContent = "¡Gracias! Recibí tu aporte. Lo voy a verificar y, si se comprueba, aparecerá en el contador.";
        aviso.className = "pista-aviso pista-ok";
      })
      .catch(function (err) {
        aviso.textContent = err.message || "No se pudo enviar. Intenta de nuevo.";
        aviso.className = "pista-aviso pista-error";
      })
      .then(function () { boton.disabled = false; });
  });
})();
