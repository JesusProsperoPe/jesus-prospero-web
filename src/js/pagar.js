// Pago de la suscripción dentro de la web, con el formulario de tarjeta de Mercado Pago (Card Payment Brick).
// La tarjeta se convierte en un token en el navegador; al servidor solo llega ese token.
(function () {
  var caja = document.getElementById("pagar");
  var aviso = document.getElementById("pagar-aviso");
  var planId = new URLSearchParams(location.search).get("plan") || "";
  var plan = null;
  try {
    JSON.parse(caja.dataset.planes).forEach(function (p) {
      if (new URL(p.link).searchParams.get("preapproval_plan_id") === planId) plan = p;
    });
  } catch (e) {}
  if (!plan) { location.replace("/suscribete/"); return; }
  if (!/(?:^|;\s*)jp_hola=/.test(document.cookie)) {
    location.replace("/ingresar/?motivo=suscribirse&volver=" + encodeURIComponent(location.pathname + location.search));
    return;
  }

  document.getElementById("p-plan").textContent = plan.nombre;
  document.getElementById("p-monto").textContent = "S/" + plan.monto + " al mes";
  document.getElementById("pagar-mp").href = plan.link;

  function avisar(t) { aviso.textContent = t || ""; }

  fetch("/api/cuenta/yo").then(function (r) { return r.json(); }).then(function (d) {
    if (!d.cuenta) { location.replace("/ingresar/?motivo=suscribirse&volver=" + encodeURIComponent(location.pathname + location.search)); return; }
    if (d.suscripcion && d.suscripcion.estado === "authorized") {
      avisar("Ya tienes una suscripción activa. Puedes verla en Mi cuenta.");
      document.getElementById("pagar-cargando").hidden = true;
      return;
    }
    if (typeof MercadoPago === "undefined") { avisar("No se pudo cargar el formulario de pago. Recarga la página."); return; }
    var mp = new MercadoPago(caja.dataset.clave, { locale: "es-PE" });
    mp.bricks().create("cardPayment", "brick-tarjeta", {
      initialization: { amount: Number(plan.monto), payer: { email: d.cuenta.correo } },
      customization: {
        paymentMethods: { maxInstallments: 1 },
        visual: {
          texts: { formSubmit: "Suscribirme por S/" + plan.monto + " al mes" },
          style: { customVariables: { baseColor: "#c8102e", baseColorFirstVariant: "#a30c25", baseColorSecondVariant: "#a30c25", borderRadiusLarge: "8px", borderRadiusMedium: "6px", borderRadiusSmall: "4px" } },
        },
      },
      callbacks: {
        onReady: function () { var c = document.getElementById("pagar-cargando"); if (c) c.hidden = true; },
        onError: function (e) { console.error(e); },
        onSubmit: function (datos) {
          avisar("");
          return fetch("/api/suscripcion/crear", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ plan: planId, token: datos.token, email: datos.payer && datos.payer.email }),
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (res) {
              if (!r.ok || !res.id) throw new Error(res.error || "No se pudo completar el pago. Prueba otra vez.");
              location.replace("/aporte/gracias/?preapproval_id=" + encodeURIComponent(res.id));
            });
          }).catch(function (e) {
            avisar(e.message === "Failed to fetch" ? "No hay conexión. Prueba otra vez." : e.message);
            throw e;   // el formulario de Mercado Pago vuelve a habilitar el botón
          });
        },
      },
    });
  }).catch(function () { avisar("No pudimos cargar tu cuenta. Recarga la página."); });
})();
