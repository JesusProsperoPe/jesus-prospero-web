(function () {
  var dlg = document.getElementById("confirmar");
  if (!dlg) return;
  var ir = document.getElementById("ir");
  var acepto = document.getElementById("acepto");
  var aceptoTexto = document.getElementById("acepto-texto");
  var aviso = document.getElementById("aviso");
  var resumen = document.getElementById("confirmar-resumen");
  var textoIr = ir.textContent;

  // Solo se aceptan links de suscripción de Mercado Pago
  function linkValido(href) {
    try {
      var u = new URL(href);
      return u.protocol === "https:" && /(^|\.)mercadopago\.com(\.[a-z]{2})?$/.test(u.hostname);
    } catch (e) { return false; }
  }

  document.querySelectorAll("[data-plan]").forEach(function (b) {
    b.addEventListener("click", function () {
      // La suscripción queda guardada en la cuenta: primero hay que iniciar sesión
      if (!/(?:^|;\s*)jp_hola=/.test(document.cookie)) {
        location.href = "/ingresar/?motivo=suscribirse&volver=/suscribete/";
        return;
      }
      resumen.textContent = "Plan " + b.dataset.plan + ": " + b.dataset.monto + " cada mes";
      aceptoTexto.textContent = "Entiendo que se cobrará " + b.dataset.monto + " cada mes hasta que cancele.";
      ir.href = b.dataset.link || "#";
      ir.textContent = textoIr;
      acepto.checked = false;
      ir.setAttribute("aria-disabled", "true");
      aviso.hidden = true;
      dlg.showModal();
    });
  });

  acepto.addEventListener("change", function () {
    ir.setAttribute("aria-disabled", acepto.checked ? "false" : "true");
  });

  ir.addEventListener("click", function (e) {
    if (!acepto.checked || ir.dataset.enviando) { e.preventDefault(); return; }
    // Los planes sin link de Mercado Pago todavía no se pueden pagar
    if (!linkValido(ir.getAttribute("href"))) { e.preventDefault(); aviso.hidden = false; return; }
    // Evita abrir dos veces el pago por un doble clic
    ir.dataset.enviando = "1";
    ir.setAttribute("aria-disabled", "true");
    ir.textContent = "Abriendo Mercado Pago…";
    setTimeout(function () { delete ir.dataset.enviando; ir.textContent = textoIr; ir.setAttribute("aria-disabled", acepto.checked ? "false" : "true"); }, 8000);
  });

  document.getElementById("volver").addEventListener("click", function () { dlg.close(); });
})();
