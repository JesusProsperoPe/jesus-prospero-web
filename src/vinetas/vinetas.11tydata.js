const path = require("node:path");
// El enlace corto se calcula igual que en las noticias
const { eleventyComputed: { enlaceCorto } } = require("../noticias/noticias.11tydata.js");

// Valores comunes a todas las viñetas de esta carpeta
module.exports = {
  layout: "vineta.njk",
  tags: ["vineta"],
  esNoticia: true,
  eleventyComputed: {
    permalink: (data) => `/vinetas/${path.basename(data.page.inputPath, ".md")}/`,
    enlaceCorto,
  },
};
