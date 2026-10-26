(function () {
  var dlg = document.getElementById("confirmar");
  if (!dlg) return;
  var ir = document.getElementById("ir");
  var acepto = document.getElementById("acepto");
  var aviso = document.getElementById("aviso");
  var resumen = document.getElementById("confirmar-resumen");

  document.querySelectorAll("[data-plan]").forEach(function (b) {
    b.addEventListener("click", function () {
      resumen.textContent = "Plan " + b.dataset.plan + ": " + b.dataset.monto + " cada mes";
      ir.href = b.dataset.link || "#";
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
    if (!acepto.checked) { e.preventDefault(); return; }
    // Los planes sin link de Mercado Pago todavía no se pueden pagar
    if (!/^https:\/\//.test(ir.getAttribute("href"))) { e.preventDefault(); aviso.hidden = false; }
  });

  document.getElementById("volver").addEventListener("click", function () { dlg.close(); });
})();
