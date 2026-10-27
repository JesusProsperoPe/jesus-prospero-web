module.exports = function (eleventyConfig) {
  // Archivos que se copian tal cual al sitio final
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/img": "img" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });

  // Todas las noticias, de la más nueva a la más antigua
  eleventyConfig.addCollection("noticias", (api) =>
    api.getFilteredByTag("noticia").sort((a, b) => b.date - a.date)
  );

  const zona = "America/Lima";
  const fmtFecha = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: zona });
  const fmtFechaHora = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: zona });

  eleventyConfig.addFilter("fecha", (d) => fmtFecha.format(new Date(d)));
  eleventyConfig.addFilter("fechaHora", (d) => fmtFechaHora.format(new Date(d)));
  eleventyConfig.addFilter("fechaIso", (d) => new Date(d).toISOString());
  eleventyConfig.addFilter("limite", (lista, n) => (lista || []).slice(0, n));
  eleventyConfig.addFilter("desde", (lista, n) => (lista || []).slice(n));
  eleventyConfig.addFilter("otras", (lista, url, n) => (lista || []).filter((x) => x.url !== url).slice(0, n));
  eleventyConfig.addFilter("soles", (monto) => "S/ " + Number(monto).toFixed(2));
  // "S/1", "S/5", "S/0.50": para textos y botones de aporte
  eleventyConfig.addFilter("solesCorto", (monto) => {
    const n = Number(monto);
    return "S/" + (Number.isInteger(n) ? n : n.toFixed(2));
  });

  // Las fotos ya llegan comprimidas desde el panel (ver src/admin/config.yml).
  // Este filtro queda como punto único por si luego se usa un servicio de imágenes.
  eleventyConfig.addFilter("img", (url) => url);

  eleventyConfig.addShortcode("anio", () => String(new Date().getFullYear()));

  return {
    dir: { input: "src", output: "_site", includes: "_includes", data: "_data" },
    templateFormats: ["md", "njk"],
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
  };
};
