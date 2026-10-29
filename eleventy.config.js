const markdownIt = require("markdown-it");
const md = markdownIt({ html: false, linkify: true, typographer: false });

module.exports = function (eleventyConfig) {
  // Para textos largos editados desde el panel (por ejemplo "Mi historia" en Sobre mí)
  eleventyConfig.addFilter("markdown", (texto) => (texto ? md.render(String(texto)) : ""));
  // Primer párrafo de un texto largo, para mostrarlo como resumen (por ejemplo en la portada)
  eleventyConfig.addFilter("primerParrafo", (texto) =>
    texto ? md.renderInline(String(texto).trim().split(/\n\s*\n/)[0]) : ""
  );

  // Una foto sola en su párrafo con título — ![texto](foto.jpg "Fuente: …") —
  // sale como <figure> con ese título como pie (la fuente de la imagen)
  eleventyConfig.amendLibrary("md", (lib) => {
    lib.core.ruler.push("figura_con_fuente", (state) => {
      const t = state.tokens;
      for (let i = 0; i + 2 < t.length; i++) {
        const hijos = t[i + 1].children || [];
        if (t[i].type !== "paragraph_open" || hijos.length !== 1 || hijos[0].type !== "image") continue;
        const fuente = hijos[0].attrGet("title");
        if (!fuente) continue;
        hijos[0].attrs = hijos[0].attrs.filter(([nombre]) => nombre !== "title");
        const pie = new state.Token("html_inline", "", 0);
        pie.content = "<figcaption>" + lib.utils.escapeHtml(fuente) + "</figcaption>";
        hijos.push(pie);
        t[i].tag = t[i + 2].tag = "figure";
        t[i].attrSet("class", "nota-figura");
      }
    });
  });

  // Archivos que se copian tal cual al sitio final
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/img": "img" });
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/ads.txt": "ads.txt" });
  // Verificación de Google Search Console: no borrar
  eleventyConfig.addPassthroughCopy({ "verificacion/google445529f79a18b928.html": "google445529f79a18b928.html" });

  // Todas las noticias, de la más nueva a la más antigua
  eleventyConfig.addCollection("noticias", (api) =>
    api.getFilteredByTag("noticia").sort((a, b) => b.date - a.date)
  );
  eleventyConfig.addCollection("exclusivas", (api) =>
    api.getFilteredByTag("noticia").filter((n) => n.data.exclusivo)
  );

  // Notas exclusivas: la página pública trae solo los primeros párrafos.
  // El resto se publica aparte en /_premium/… y el Worker lo inserta solo para suscriptores (y Google).
  const PARRAFOS_GRATIS = 2;
  const corte = (html) => {
    let i = -1;
    for (let k = 0; k < PARRAFOS_GRATIS; k++) {
      i = html.indexOf("</p>", i + 1);
      if (i < 0) return html.length;
    }
    return i + 4;
  };
  eleventyConfig.addFilter("inicioGratis", (html) => String(html).slice(0, corte(String(html))));
  eleventyConfig.addFilter("restoExclusivo", (html) => String(html).slice(corte(String(html))));

  const zona = "America/Lima";
  const fmtFecha = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric", timeZone: zona });
  const fmtFechaHora = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: zona });

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
