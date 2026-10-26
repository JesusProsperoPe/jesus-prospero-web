const path = require("node:path");

// Valores comunes a todas las noticias de esta carpeta
module.exports = {
  layout: "noticia.njk",
  tags: ["noticia"],
  esNoticia: true,
  eleventyComputed: {
    permalink: (data) => `/noticias/${path.basename(data.page.inputPath, ".md")}/`,
  },
};
