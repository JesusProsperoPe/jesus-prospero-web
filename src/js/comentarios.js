// Comentarios de la nota: se muestran los aprobados y, a su autor, los que esperan revisión.
(function () {
  var caja = document.getElementById("comentarios");
  if (!caja) return;
  var nota = caja.dataset.nota;
  var lista = document.getElementById("comentarios-lista");
  var vacio = document.getElementById("comentarios-vacio");
  var form = document.getElementById("comentarios-form");
  var aviso = document.getElementById("comentario-aviso");
  var hola = document.cookie.match(/(?:^|;\s*)jp_hola=([^;]+)/);

  if (hola) {
    var nombre = "";
    try { nombre = decodeURIComponent(hola[1]); } catch (e) {}
    document.getElementById("comentario-nombre").textContent = nombre;
    document.getElementById("comentarios-ingresa").hidden = true;
    form.hidden = false;
  }

  function fecha(iso) {
    try {
      return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(iso));
    } catch (e) { return ""; }
  }

  function agregar(c) {
    var li = document.createElement("li");
    li.className = "comentario" + (c.pendiente ? " comentario-pendiente" : "");
    var cab = document.createElement("p");
    cab.className = "comentario-cabeza";
    var autor = document.createElement("strong");
    autor.textContent = c.nombre;
    cab.appendChild(autor);
    if (c.suscriptor) {
      var sello = document.createElement("span");
      sello.className = "sello-exclusivo";
      sello.textContent = "Suscriptor";
      cab.appendChild(sello);
    }
    var cuando = document.createElement("time");
    cuando.className = "meta";
    cuando.dateTime = c.fecha;
    cuando.textContent = fecha(c.fecha);
    cab.appendChild(cuando);
    li.appendChild(cab);
    if (c.pendiente) {
      var espera = document.createElement("p");
      espera.className = "comentario-espera";
      espera.textContent = "Solo tú lo ves por ahora: se publicará cuando sea revisado.";
      li.appendChild(espera);
    }
    var texto = document.createElement("p");
    texto.className = "comentario-texto";
    texto.textContent = c.texto;
    li.appendChild(texto);
    lista.appendChild(li);
    vacio.hidden = true;
  }

  fetch("/api/comentarios?nota=" + encodeURIComponent(nota))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      (d.comentarios || []).forEach(agregar);
      vacio.hidden = lista.children.length > 0;
    })
    .catch(function () { vacio.hidden = false; });

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var texto = form.texto.value.trim();
    if (texto.length < 2) { aviso.textContent = "Escribe tu comentario."; return; }
    var b = form.querySelector("button");
    b.disabled = true;
    aviso.textContent = "";
    fetch("/api/comentarios", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nota: nota, texto: texto }),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (r.status === 401) { location.href = "/ingresar/?motivo=comentar&volver=" + encodeURIComponent(nota); return; }
        if (!r.ok) {
          aviso.textContent = d.error || "No pudimos publicar tu comentario.";
          if (d.verificar) {
            var a = document.createElement("a");
            a.href = "/mi-cuenta/";
            a.textContent = " Ir a Mi cuenta";
            aviso.appendChild(a);
          }
          return;
        }
        agregar(d.comentario);
        form.reset();
        aviso.textContent = "¡Gracias! Tu comentario se publicará cuando sea revisado.";
      });
    }).catch(function () { aviso.textContent = "No hay conexión. Prueba otra vez."; })
      .finally(function () { b.disabled = false; });
  });
})();
