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
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });

  // Todas las noticias, de la más nueva a la más antigua
  eleventyConfig.addCollection("noticias", (api) =>
    api.getFilteredByTag("noticia").sort((a, b) => b.date - a.date)
  );
  // Secciones del menú: "Noticias" solo lleva las de tipo Noticia; "Columnas", todo lo de opinión
  // (Columna, Análisis, Opinión). Las direcciones siguen siendo /noticias/… para no romper enlaces.
  eleventyConfig.addCollection("soloNoticias", (api) =>
    api.getFilteredByTag("noticia").filter((n) => n.data.tipo === "Noticia").sort((a, b) => b.date - a.date)
  );
  eleventyConfig.addCollection("columnas", (api) =>
    api.getFilteredByTag("noticia").filter((n) => n.data.tipo !== "Noticia").sort((a, b) => b.date - a.date)
  );
  // Viñetas (humor gráfico), de la más nueva a la más antigua
  eleventyConfig.addCollection("vinetas", (api) =>
    api.getFilteredByTag("vineta").sort((a, b) => b.date - a.date)
  );
  // Enlaces cortos jesusprospero.pe/n/<código>: dos notas o viñetas no pueden compartir código
  eleventyConfig.addCollection("cortos", (api) => {
    const vistos = new Map();
    for (const n of [...api.getFilteredByTag("noticia"), ...api.getFilteredByTag("vineta")]) {
      const c = n.data.enlaceCorto;
      if (vistos.has(c)) throw new Error(`El enlace corto "${c}" se repite en ${vistos.get(c)} y ${n.url}`);
      vistos.set(c, n.url);
    }
    return [...vistos].map(([codigo, url]) => ({ codigo, url }));
  });
  // Páginas por tema (/temas/<tema>/): solo los temas con 2 o más publicaciones,
  // para no crear páginas casi vacías
  eleventyConfig.addCollection("temas", (api) => {
    const slugify = eleventyConfig.getFilter("slugify");
    const temas = new Map();
    for (const item of [...api.getFilteredByTag("noticia"), ...api.getFilteredByTag("vineta")]) {
      for (const nombre of item.data.temas || []) {
        const slug = slugify(nombre);
        if (!temas.has(slug)) temas.set(slug, { nombre, slug, items: [] });
        temas.get(slug).items.push(item);
      }
    }
    return [...temas.values()]
      .filter((t) => t.items.length >= 2)
      .map((t) => ({ ...t, items: t.items.sort((a, b) => b.date - a.date) }))
      .sort((a, b) => b.items.length - a.items.length || a.nombre.localeCompare(b.nombre, "es"));
  });
  // Casos del contador de Keiko, del más nuevo al más antiguo
  eleventyConfig.addCollection("mentiras", (api) =>
    api.getFilteredByTag("mentira").sort((a, b) => b.date - a.date)
  );
  // Publicaciones de las últimas 48 horas, para el mapa de Google Noticias
  eleventyConfig.addCollection("recientes", (api) => {
    const limite = Date.now() - 48 * 3600 * 1000;
    return [...api.getFilteredByTag("noticia"), ...api.getFilteredByTag("vineta")]
      .filter((n) => n.date.getTime() >= limite)
      .sort((a, b) => b.date - a.date);
  });
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
  // Casos del contador de una categoría ("Falso", "Engañoso", …)
  eleventyConfig.addFilter("porCategoria", (casos, categoria) =>
    (casos || []).filter((c) => c.data.categoria === categoria)
  );
  eleventyConfig.addFilter("combinar", (a, b) => ({ ...a, ...b }));
  // Temas de una nota que tienen página propia: [{ nombre, slug }]
  eleventyConfig.addFilter("temasConPagina", (nombres, todos) => {
    const slugify = eleventyConfig.getFilter("slugify");
    const conPagina = new Set((todos || []).map((t) => t.slug));
    return (nombres || []).map((nombre) => ({ nombre, slug: slugify(nombre) })).filter((t) => conPagina.has(t.slug));
  });
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
