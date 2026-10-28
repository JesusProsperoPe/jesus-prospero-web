// Muestra el estado REAL de la suscripción consultando al backend, que a su vez consulta a Mercado Pago.
// Volver a esta página no basta para marcar un aporte como activo.
(function () {
  var caja = document.getElementById("estado");
  var titulo = document.getElementById("estado-titulo");
  var texto = document.getElementById("estado-texto");
  var detalle = document.getElementById("estado-detalle");
  var params = new URLSearchParams(location.search);
  var id = params.get("preapproval_id") || params.get("id") || "";
  var intentos = 0;

  function mostrar(estado, t, p) {
    caja.dataset.estado = estado;
    titulo.textContent = t;
    texto.textContent = p;
  }

  function soles(monto) {
    var n = Number(monto);
    return "S/" + (Number.isInteger(n) ? n : n.toFixed(2));
  }

  function fecha(iso) {
    try {
      return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Lima" }).format(new Date(iso));
    } catch (e) { return ""; }
  }

  function sinVerificar() {
    mostrar("desconocido", "No pudimos verificar tu suscripción",
      "Si completaste el pago, Mercado Pago te enviará la confirmación a tu correo. También puedes revisarla en tu cuenta de Mercado Pago.");
  }

  // Enlace personal para las notas exclusivas y, si venía de una, el botón para volver a ella
  function mostrarAcceso(enlace) {
    var campo = document.getElementById("acceso-enlace");
    var copiar = document.getElementById("acceso-copiar");
    campo.value = enlace;
    copiar.addEventListener("click", function () {
      navigator.clipboard.writeText(enlace).then(function () {
        copiar.textContent = "Enlace copiado";
        setTimeout(function () { copiar.textContent = "Copiar enlace"; }, 2000);
      }).catch(function () { campo.select(); });
    });
    var volver = null;
    try { volver = localStorage.getItem("jp-volver"); localStorage.removeItem("jp-volver"); } catch (e) {}
    if (volver && /^\/noticias\/[a-z0-9-]+\/$/.test(volver)) {
      var boton = document.getElementById("acceso-volver");
      boton.href = volver;
      boton.hidden = false;
    }
    document.getElementById("estado-acceso").hidden = false;
  }

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) { sinVerificar(); return; }

  function consultar() {
    intentos++;
    fetch("/api/aporte/estado?preapproval_id=" + encodeURIComponent(id), { headers: { accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.estado === "authorized") {
          mostrar("activo", "¡Gracias! Tu aporte mensual está activo",
            "Tu apoyo me ayuda a seguir informando. Mercado Pago te enviará el detalle a tu correo.");
          document.getElementById("d-monto").textContent = soles(d.monto) + " al mes (plan " + d.plan + ")";
          var proximo = d.proximo_cobro ? fecha(d.proximo_cobro) : "";
          if (proximo) document.getElementById("d-proximo").textContent = proximo;
          else document.getElementById("d-proximo-fila").hidden = true;
          detalle.hidden = false;
          if (d.acceso) mostrarAcceso(d.acceso);
        } else if (d.estado === "pending") {
          if (intentos < 4) {
            mostrar("verificando", "Mercado Pago está procesando tu suscripción…", "Esto puede tardar unos segundos.");
            setTimeout(consultar, 4000);
          } else {
            mostrar("pendiente", "Tu suscripción está pendiente",
              "Mercado Pago todavía no la confirmó. Te avisará por correo cuando esté activa. No hace falta que vuelvas a pagar.");
          }
        } else if (d.estado === "cancelled") {
          mostrar("cancelado", "Esta suscripción está cancelada", "No se harán más cobros de esta suscripción.");
        } else if (d.estado === "paused") {
          mostrar("pausado", "Esta suscripción está en pausa", "Mientras esté en pausa no se harán cobros.");
        } else {
          sinVerificar();
        }
      })
      .catch(sinVerificar);
  }
  consultar();
})();
