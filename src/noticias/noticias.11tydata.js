const path = require("node:path");

// Código corto estable para jesusprospero.pe/n/<código>: sale del nombre del archivo,
// así no cambia aunque luego se corrija el título
function codigoCorto(nombre) {
  let h = 0x811c9dc5;
  for (const c of nombre) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(36).slice(-4).padStart(4, "0");
}

// Valores comunes a todas las noticias de esta carpeta
module.exports = {
  layout: "noticia.njk",
  tags: ["noticia"],
  esNoticia: true,
  tipo: "Columna",   // Columna | Análisis | Opinión | Noticia (se elige en el panel)
  eleventyComputed: {
    permalink: (data) => `/noticias/${path.basename(data.page.inputPath, ".md")}/`,
    // Se puede elegir uno a mano en el panel (por ejemplo "holguin"); si no, se genera solo
    enlaceCorto: (data) => {
      const elegido = String(data.corto || "").toLowerCase().normalize("NFD")
        .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
      return elegido || codigoCorto(path.basename(data.page.inputPath, ".md"));
    },
  },
};
