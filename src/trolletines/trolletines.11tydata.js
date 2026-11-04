const path = require("node:path");
// El enlace corto se calcula igual que en las noticias
const { eleventyComputed: { enlaceCorto } } = require("../noticias/noticias.11tydata.js");

// Valores comunes a todos los trolletines (columnas de sátira) de esta carpeta.
// No llevan la etiqueta "noticia": así no entran a Noticias, Columnas ni al mapa de Google Noticias.
module.exports = {
  layout: "trolletin.njk",
  tags: ["trolletin"],
  esNoticia: true,
  tipo: "Trolletín Informativo",
  eleventyComputed: {
    permalink: (data) => `/trolletines/${path.basename(data.page.inputPath, ".md")}/`,
    enlaceCorto,
  },
};
