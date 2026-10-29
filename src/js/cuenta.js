// Página "Mi cuenta": datos, suscripción y cierre de sesión.
(function () {
  var params = new URLSearchParams(location.search);
  var mensaje = document.getElementById("cuenta-mensaje");
  var correo = "";
  var PLANES = {};
  try {
    JSON.parse(document.getElementById("cuenta").dataset.planes).forEach(function (p) {
      PLANES[new URL(p.link).searchParams.get("preapproval_plan_id")] = p.nombre;
    });
  } catch (e) {}
  var ESTADOS = { authorized: "Activa", pending: "Pendiente", paused: "En pausa", cancelled: "Cancelada" };

  function avisar(texto) { mensaje.textContent = texto; mensaje.hidden = !texto; }

  function fecha(iso) {
    try {
      return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Lima" }).format(new Date(iso));
    } catch (e) { return ""; }
  }

  function post(ruta, datos) {
    return fetch("/api/cuenta/" + ruta, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(datos || {}),
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Algo falló."); return d; }); });
  }

  if (params.get("verificada") === "si") avisar("¡Listo! Tu correo quedó confirmado. Ya puedes comentar en las notas.");
  if (params.get("verificada") === "no") avisar("Ese enlace de confirmación venció o ya se usó. Pide uno nuevo abajo.");

  fetch("/api/cuenta/yo").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.cuenta) { location.replace("/ingresar/?volver=/mi-cuenta/"); return; }
    var c = d.cuenta;
    correo = c.correo;
    document.getElementById("cuenta-nombre").textContent = c.nombre;
    document.getElementById("cuenta-correo").textContent = c.correo;
    document.getElementById(c.verificada ? "verificada" : "sin-verificar").hidden = false;
    document.getElementById("con-google").hidden = !c.google;
    if (!c.clave) document.getElementById("cambiar-clave").textContent = "Crear una contraseña";

    var s = d.suscripcion;
    if (s) {
      document.getElementById("s-plan").textContent = (PLANES[s.plan_id] || "Aporte") + " · S/" + Number(s.monto) + " al mes";
      document.getElementById("s-estado").textContent = ESTADOS[s.estado] || s.estado;
      if (s.estado === "authorized" && s.proximo_cobro) document.getElementById("s-proximo").textContent = fecha(s.proximo_cobro);
      else document.getElementById("s-proximo-fila").hidden = true;
      document.getElementById("con-suscripcion").hidden = false;
      document.getElementById("fila-cancelar").hidden = s.estado !== "authorized";
      if (s.estado !== "authorized") document.getElementById("sin-suscripcion").hidden = false;
    } else {
      document.getElementById("sin-suscripcion").hidden = false;
    }
    document.getElementById("cuenta").hidden = false;
  }).catch(function () { avisar("No pudimos cargar tu cuenta. Recarga la página."); document.getElementById("cuenta").hidden = false; });

  document.getElementById("reenviar").addEventListener("click", function () {
    var b = this;
    b.disabled = true;
    post("verificar/enviar").then(function () { avisar("Te enviamos el correo. Revisa también spam o promociones."); })
      .catch(function (e) { avisar(e.message); }).finally(function () { b.disabled = false; });
  });

  document.getElementById("cambiar-clave").addEventListener("click", function () {
    var b = this;
    b.disabled = true;
    post("olvide", { correo: correo }).then(function () { avisar("Te enviamos un enlace a tu correo para elegir la contraseña nueva."); })
      .catch(function (e) { avisar(e.message); }).finally(function () { b.disabled = false; });
  });

  document.getElementById("cancelar").addEventListener("click", function () {
    if (!confirm("¿Cancelar tu suscripción? No se harán más cobros y dejarás de ver las notas exclusivas desde ahora.")) return;
    var b = this;
    b.disabled = true;
    fetch("/api/suscripcion/cancelar", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "Algo falló."); }); })
      .then(function () { location.replace("/mi-cuenta/?cancelada=si"); })
      .catch(function (e) { avisar(e.message); b.disabled = false; });
  });
  if (params.get("cancelada") === "si") avisar("Listo, tu suscripción quedó cancelada. No se harán más cobros. Puedes volver cuando quieras.");

  document.getElementById("salir").addEventListener("click", function () {
    post("salir").finally(function () { location.replace("/"); });
  });
})();
