// Ingreso en dos pasos: primero el correo; luego la contraseña (si ya tiene cuenta) o el registro.
(function () {
  var params = new URLSearchParams(location.search);
  var pedido = params.get("volver") || "";
  var volver = /^\/[a-z0-9\-\/]*$/.test(pedido) && pedido.indexOf("//") !== 0 ? pedido : "";
  var motivo = params.get("motivo");
  var aviso = document.getElementById("ingreso-aviso");
  var correo = "";

  if (motivo === "suscribirse") {
    document.getElementById("ingreso-motivo").textContent =
      "Para suscribirte necesitas una cuenta. Así tu suscripción queda guardada y lees las notas exclusivas desde cualquier celular o computadora.";
  } else if (motivo === "comentar") {
    document.getElementById("ingreso-motivo").textContent = "Para comentar en las notas necesitas una cuenta. Es gratis.";
  }
  if (params.get("error") === "google") avisar("No pudimos entrar con Google. Prueba otra vez o usa tu correo.");

  var google = "/api/cuenta/google" + (volver ? "?volver=" + encodeURIComponent(volver) : "");
  document.querySelectorAll("#boton-google, [data-google]").forEach(function (a) { a.href = google; });

  fetch("/api/cuenta/yo").then(function (r) { return r.json(); }).then(function (d) {
    if (d.cuenta) { location.replace(volver || "/mi-cuenta/"); return; }
    if (d.google) document.getElementById("bloque-google").hidden = false;
  }).catch(function () {});

  function avisar(texto) { aviso.textContent = texto || ""; }

  function mostrar(id) {
    document.querySelectorAll(".ingreso-paso").forEach(function (p) { p.hidden = p.id !== id; });
    document.querySelectorAll(".ingreso-correo").forEach(function (s) { s.textContent = correo; });
    avisar("");
    var campo = document.querySelector("#" + id + " input:not([type=checkbox])");
    if (campo) campo.focus();
    window.scrollTo(0, 0);
  }

  function enviar(ruta, datos, boton) {
    boton.disabled = true;
    avisar("");
    return fetch("/api/cuenta/" + ruta, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(datos),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Algo falló. Prueba otra vez.");
        return d;
      });
    }).catch(function (e) {
      avisar(e.message === "Failed to fetch" ? "No hay conexión. Prueba otra vez." : e.message);
      throw e;
    }).finally(function () { boton.disabled = false; });
  }

  document.getElementById("form-correo").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var valor = this.correo.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor)) { avisar("Escribe un correo válido."); return; }
    correo = valor;
    enviar("existe", { correo: correo }, this.querySelector("button")).then(function (d) {
      mostrar(!d.existe ? "paso-crear" : d.clave ? "paso-entrar" : "paso-solo-google");
    }).catch(function () {});
  });

  document.getElementById("form-entrar").addEventListener("submit", function (ev) {
    ev.preventDefault();
    enviar("entrar", { correo: correo, clave: this.clave.value }, this.querySelector("button")).then(function () {
      location.replace(volver || "/mi-cuenta/");
    }).catch(function () {});
  });

  document.getElementById("form-crear").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = this;
    if (f.nombre.value.trim().length < 2) { avisar("Escribe tu nombre."); return; }
    if (f.clave.value.length < 8) { avisar("La contraseña debe tener al menos 8 caracteres."); return; }
    if (!f.acepto.checked) { avisar("Para crear la cuenta acepta la política de privacidad."); return; }
    enviar("crear", { correo: correo, nombre: f.nombre.value, clave: f.clave.value }, f.querySelector("button")).then(function (d) {
      // Quien venía a suscribirse sigue con su pago; los demás ven la bienvenida
      if (motivo === "suscribirse" || d.suscrita) { location.replace(volver || "/mi-cuenta/"); return; }
      document.getElementById("seguir-navegando").href = volver || "/";
      var menu = document.getElementById("menu-cuenta");
      menu.href = "/mi-cuenta/";
      menu.setAttribute("aria-label", "Mi cuenta");
      document.getElementById("menu-cuenta-texto").textContent = "Mi cuenta";
      mostrar("paso-bienvenida");
    }).catch(function () {});
  });

  document.querySelectorAll("[data-olvide]").forEach(function (b) {
    b.addEventListener("click", function () {
      enviar("olvide", { correo: correo }, b).then(function () { mostrar("paso-olvide"); }).catch(function () {});
    });
  });

  document.querySelectorAll("[data-otro-correo]").forEach(function (b) {
    b.addEventListener("click", function () { mostrar("paso-correo"); });
  });
})();
