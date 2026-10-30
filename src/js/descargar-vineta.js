// Botón "Descargar viñeta": arma una copia con la marca de agua del sitio
// (abajo a la derecha) y la descarga como JPG. Sin JavaScript, baja la imagen tal cual.
(function () {
  var boton = document.getElementById("descargar-vineta");
  if (!boton || !window.HTMLCanvasElement) return;

  var TEXTO_ORIGINAL = boton.innerHTML;

  function cargar(src) {
    return new Promise(function (ok, falla) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = falla;
      img.src = src;
    });
  }

  function conMarca(img, marca) {
    var lienzo = document.createElement("canvas");
    var an = lienzo.width = img.naturalWidth;
    var al = lienzo.height = img.naturalHeight;
    var ctx = lienzo.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // Tamaño proporcional a la imagen, para que se lea igual en cualquier resolución
    var base = Math.min(an, al);
    var letra = Math.max(18, Math.round(base * 0.036));
    var pad = Math.round(letra * 0.55);
    var margen = Math.round(base * 0.025);
    ctx.font = "800 " + letra + "px Archivo, Arial, sans-serif";
    var ancho = ctx.measureText(marca).width;
    var cuadro = Math.round(letra * 0.42);
    var cajaAn = pad + cuadro + pad * 0.7 + ancho + pad;
    var cajaAl = letra + pad * 1.3;
    var x = an - margen - cajaAn;
    var y = al - margen - cajaAl;

    ctx.fillStyle = "rgba(17, 17, 17, 0.78)";
    ctx.fillRect(x, y, cajaAn, cajaAl);
    ctx.fillStyle = "#c8102e";   // el cuadrito rojo de la marca
    ctx.fillRect(x + pad, y + (cajaAl - cuadro) / 2, cuadro, cuadro);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(marca, x + pad + cuadro + pad * 0.7, y + cajaAl / 2 + letra * 0.04);
    return lienzo;
  }

  boton.addEventListener("click", function (e) {
    e.preventDefault();
    boton.setAttribute("aria-disabled", "true");
    boton.textContent = "Preparando…";
    var fuente = document.fonts ? document.fonts.load("800 40px Archivo") : Promise.resolve();
    fuente.catch(function () {})
      .then(function () { return cargar(boton.dataset.imagen); })
      .then(function (img) {
        conMarca(img, boton.dataset.marca).toBlob(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = boton.dataset.archivo;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        }, "image/jpeg", 0.92);
      })
      .catch(function () { window.location.href = boton.dataset.imagen; })
      .then(function () {
        boton.innerHTML = TEXTO_ORIGINAL;
        boton.removeAttribute("aria-disabled");
      });
  });
})();
