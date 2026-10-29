const path = require("node:path");

// Valores comunes a todas las noticias de esta carpeta
module.exports = {
  layout: "noticia.njk",
  tags: ["noticia"],
  esNoticia: true,
  tipo: "Columna",   // Columna | Análisis | Opinión | Noticia (se elige en el panel)
  eleventyComputed: {
    permalink: (data) => `/noticias/${path.basename(data.page.inputPath, ".md")}/`,
  },
};
