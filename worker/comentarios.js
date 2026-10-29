// Comentarios en las notas. Cada comentario espera la aprobación del moderador antes de verse.
// - GET  /api/comentarios?nota=/noticias/…/   → comentarios aprobados (y los propios pendientes)
// - POST /api/comentarios                     → nuevo comentario (cuenta con correo verificado)
// - GET  /api/comentarios/moderar?id=…&f=…    → página para aprobar u ocultar (enlace del correo)
// - POST /api/comentarios/moderar             → aplica la decisión
// El aviso llega a MODERADOR_CORREO (por defecto, el correo del sitio).

import site from "../src/_data/site.json";
import { json, firmar, igualSeguro, mismoOrigen, leerJson, enviarCorreo, escapar, pagina } from "./util.js";
import { cuentaDeSesion } from "./cuentas.js";

const NOTA_VALIDA = /^\/noticias\/[a-z0-9-]+\/$/;
const MAX_TEXTO = 1500;
const MAX_POR_HORA = 10;

export async function rutasComentarios(request, url, env, ctx) {
  if (!env.DB) return json({ error: "Los comentarios no están disponibles por ahora." }, 503);
  const ruta = url.pathname.replace(/^\/api\/comentarios/, "");
  if (ruta === "" || ruta === "/") {
    if (request.method === "GET") return listar(request, url, env);
    if (request.method === "POST") {
      if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido" }, 403);
      return publicar(request, url, env, ctx);
    }
    return json({ error: "Método no permitido" }, 405);
  }
  if (ruta === "/moderar") {
    if (request.method === "GET") return verModeracion(url, env);
    if (request.method === "POST" && mismoOrigen(request, url)) return moderar(request, url, env);
    return json({ error: "Método no permitido" }, 405);
  }
  return json({ error: "No encontrado" }, 404);
}

async function listar(request, url, env) {
  const nota = url.searchParams.get("nota") || "";
  if (!NOTA_VALIDA.test(nota)) return json({ error: "Nota no válida" }, 400);
  const cuenta = await cuentaDeSesion(request, env);
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.texto, c.estado, c.creado_en, u.nombre,
            EXISTS (SELECT 1 FROM suscripciones s WHERE s.cuenta_id = u.id AND s.estado = 'authorized') AS suscriptor
     FROM comentarios c JOIN cuentas u ON u.id = c.cuenta_id
     WHERE c.nota = ?1 AND (c.estado = 'aprobado' OR (c.estado = 'pendiente' AND c.cuenta_id = ?2))
     ORDER BY c.creado_en ASC LIMIT 300`
  ).bind(nota, cuenta?.id ?? "").all();
  return json({
    comentarios: results.map((c) => ({
      id: c.id, nombre: c.nombre, texto: c.texto, fecha: c.creado_en,
      suscriptor: Boolean(c.suscriptor), pendiente: c.estado === "pendiente",
    })),
  });
}

async function publicar(request, url, env, ctx) {
  const cuenta = await cuentaDeSesion(request, env);
  if (!cuenta) return json({ error: "Inicia sesión para comentar." }, 401);
  if (!cuenta.verificada) return json({ error: "Confirma tu correo para comentar. Revisa tu bandeja de entrada.", verificar: true }, 403);

  const datos = await leerJson(request);
  const nota = String(datos.nota || "");
  const texto = String(datos.texto || "").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!NOTA_VALIDA.test(nota)) return json({ error: "Nota no válida" }, 400);
  if (texto.length < 2) return json({ error: "Escribe tu comentario." }, 400);
  if (texto.length > MAX_TEXTO) return json({ error: `El comentario puede tener hasta ${MAX_TEXTO} caracteres.` }, 400);

  // La nota tiene que existir
  const existe = await env.ASSETS.fetch(new Request(new URL(nota, url), { method: "HEAD" }));
  if (!existe.ok) return json({ error: "Nota no válida" }, 400);

  const hora = new Date(Date.now() - 3600000).toISOString();
  const cuenta1h = await env.DB.prepare("SELECT COUNT(*) AS n FROM comentarios WHERE cuenta_id = ?1 AND creado_en > ?2")
    .bind(cuenta.id, hora).first();
  if (cuenta1h.n >= MAX_POR_HORA) return json({ error: "Escribiste muchos comentarios seguidos. Prueba más tarde." }, 429);

  const ahora = new Date().toISOString();
  const r = await env.DB.prepare(
    "INSERT INTO comentarios (nota, cuenta_id, texto, estado, creado_en) VALUES (?1, ?2, ?3, 'pendiente', ?4)"
  ).bind(nota, cuenta.id, texto, ahora).run();
  const id = r.meta.last_row_id;

  const aviso = avisarModerador(env, url, id, nota, cuenta, texto).catch((e) => console.error(`moderación ${id}: ${e.message}`));
  if (ctx) ctx.waitUntil(aviso);
  return json({ ok: true, comentario: { id, nombre: cuenta.nombre, texto, fecha: ahora, pendiente: true } }, 201);
}

async function avisarModerador(env, url, id, nota, cuenta, texto) {
  const enlace = new URL(`/api/comentarios/moderar?id=${id}&f=${await firmar(env, `comentario:${id}`)}`, url).href;
  await enviarCorreo(env, env.MODERADOR_CORREO || site.correo, `Nuevo comentario de ${cuenta.nombre}`,
    `${cuenta.nombre} (${cuenta.correo}) comentó en ${new URL(nota, url).href}:\n\n${texto}\n\nPara aprobarlo u ocultarlo:\n${enlace}`);
}

async function comentarioDe(url, env, id, f) {
  if (!/^\d{1,12}$/.test(String(id)) || !f || !igualSeguro(await firmar(env, `comentario:${id}`), String(f))) return null;
  return env.DB.prepare(
    `SELECT c.*, u.nombre, u.correo FROM comentarios c JOIN cuentas u ON u.id = c.cuenta_id WHERE c.id = ?1`
  ).bind(Number(id)).first();
}

const ESTADOS = { pendiente: "Esperando tu decisión", aprobado: "Publicado", rechazado: "Oculto" };

function vistaModeracion(c, f, mensaje = "") {
  return pagina("Moderar comentario", `
<div class="estado-caja moderar-caja">
  <p class="etiqueta">Moderar comentario</p>
  ${mensaje ? `<p class="moderar-mensaje">${escapar(mensaje)}</p>` : ""}
  <p><strong>${escapar(c.nombre)}</strong> · ${escapar(c.correo)}</p>
  <p class="meta">En <a href="${escapar(c.nota)}">${escapar(c.nota)}</a> · Estado: <strong>${ESTADOS[c.estado] || c.estado}</strong></p>
  <blockquote class="moderar-texto">${escapar(c.texto)}</blockquote>
  <form method="post" action="/api/comentarios/moderar" class="botones">
    <input type="hidden" name="id" value="${c.id}"><input type="hidden" name="f" value="${escapar(f)}">
    <button class="boton" name="accion" value="aprobar"${c.estado === "aprobado" ? " disabled" : ""}>Publicar</button>
    <button class="boton boton-secundario" name="accion" value="ocultar"${c.estado === "rechazado" ? " disabled" : ""}>Ocultar</button>
  </form>
</div>`);
}

async function verModeracion(url, env) {
  const f = url.searchParams.get("f");
  const c = await comentarioDe(url, env, url.searchParams.get("id"), f);
  if (!c) return pagina("Enlace no válido", `<div class="vacio"><h1>Este enlace no es válido</h1></div>`, 404);
  return vistaModeracion(c, f);
}

async function moderar(request, url, env) {
  const form = await request.formData();
  const f = form.get("f");
  const c = await comentarioDe(url, env, form.get("id"), f);
  if (!c) return pagina("Enlace no válido", `<div class="vacio"><h1>Este enlace no es válido</h1></div>`, 404);
  const estado = form.get("accion") === "aprobar" ? "aprobado" : "rechazado";
  await env.DB.prepare("UPDATE comentarios SET estado = ?1 WHERE id = ?2").bind(estado, c.id).run();
  c.estado = estado;
  return vistaModeracion(c, f, estado === "aprobado" ? "Listo, el comentario ya se ve en la nota." : "Listo, el comentario quedó oculto.");
}
