// Backend mínimo de aportes mensuales (Cloudflare Worker).
// - GET  /api/aporte/estado?preapproval_id=…  → consulta a Mercado Pago el estado REAL de una suscripción
//                                               (si está activa, deja al lector con acceso a las notas exclusivas).
// - POST /api/mercadopago/webhook             → recibe notificaciones firmadas de Mercado Pago.
// - GET  /acceso/?t=…                         → enlace personal de acceso del suscriptor.
// - POST /api/acceso/correo                   → envía ese enlace al correo de una suscripción activa.
// - /noticias/…                               → a suscriptores (y a Google) les completa las notas exclusivas.
// Todo lo demás lo sirve el sitio estático (carpeta _site).
//
// Variables secretas (se configuran en Cloudflare, nunca en el código):
//   MP_ACCESS_TOKEN     Access Token de producción de tu aplicación de Mercado Pago.
//   MP_WEBHOOK_SECRET   Clave secreta de las notificaciones (webhooks) de esa aplicación.
//   ACCESO_SECRET       (opcional) Clave para firmar los enlaces de acceso. Si falta, se deriva de MP_ACCESS_TOKEN.
//   RESEND_API_KEY      (opcional) Para enviar el enlace de acceso por correo. Sin ella, ese envío queda apagado.
// Variable normal: CORREO_REMITENTE, por ejemplo "Jesus Prospero <acceso@jesusprospero.pe>".
// Base de datos: D1 con el nombre de enlace DB (ver migrations/0001_aportes.sql).
//
// No se guardan correos, nombres ni datos de tarjeta: solo identificadores, montos, estados y fechas.

import aportes from "../src/_data/aportes.json";

const MP_API = "https://api.mercadopago.com";
const ID_VALIDO = /^[A-Za-z0-9_-]{6,64}$/;

function planIdDe(link) {
  try { return new URL(link).searchParams.get("preapproval_plan_id"); } catch { return null; }
}

// Solo se reconocen suscripciones de los planes publicados en esta web
const PLANES = new Map(
  aportes.planes.map((p) => [planIdDe(p.link), p]).filter(([id]) => id)
);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/aporte/estado") {
      if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);
      return estado(url, env);
    }
    if (url.pathname === "/api/mercadopago/webhook") {
      if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
      return webhook(request, url, env);
    }
    if (url.pathname === "/api/acceso/correo") {
      if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
      return accesoPorCorreo(request, url, env);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);
    if (url.pathname === "/acceso/" || url.pathname === "/acceso") return acceso(url, env);
    // El resto de las notas exclusivas solo sale insertado en la nota, nunca suelto
    if (url.pathname.startsWith("/_premium/")) {
      const p = await env.ASSETS.fetch(new Request(new URL("/404.html", url)));
      return new Response(p.body, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname.startsWith("/noticias/") && url.pathname.endsWith("/") && request.method === "GET") {
      return noticia(request, url, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ───────── Notas exclusivas ─────────

const COOKIE = "jp_acceso";
const UN_ANIO = 60 * 60 * 24 * 365;

async function noticia(request, url, env) {
  const lector = esGoogle(request) ? "google" : await suscriptorDeCookie(request, env);
  if (!lector) return env.ASSETS.fetch(request);

  const resto = await env.ASSETS.fetch(new Request(new URL(`/_premium${url.pathname}resto.html`, url)));
  if (!resto.ok) return env.ASSETS.fetch(request);   // no es una nota exclusiva

  // Sin cabeceras condicionales: el navegador podría tener guardada la versión cortada
  const pagina = await env.ASSETS.fetch(new Request(url, { headers: { accept: "text/html" } }));
  if (!pagina.ok) return pagina;
  const html = `<div class="nota-exclusiva">${await resto.text()}</div>`;

  const r = new HTMLRewriter().on("#muro", { element(el) { el.replace(html, { html: true }); } }).transform(pagina);
  const h = new Headers(r.headers);
  h.set("cache-control", "private, no-store");
  h.set("vary", "Cookie");
  h.delete("etag");
  return new Response(r.body, { status: 200, headers: h });
}

// Google lee la nota completa para indexarla. Se confirma que viene de la red de Google (AS15169),
// no solo por el nombre que dice tener.
function esGoogle(request) {
  const ua = request.headers.get("user-agent") || "";
  return /Googlebot|Google-InspectionTool|Mediapartners-Google|Storebot-Google/i.test(ua) && request.cf?.asn === 15169;
}

async function suscriptorDeCookie(request, env) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const id = m && (await idDeFicha(env, decodeURIComponent(m[1])));
  return id && (await suscripcionActiva(env, id)) ? id : null;
}

// Enlace personal: /acceso/?t=<ficha>&volver=/noticias/…/
async function acceso(url, env) {
  const ficha = url.searchParams.get("t") || "";
  const id = await idDeFicha(env, ficha);
  const volver = rutaSegura(url.searchParams.get("volver"));
  if (!id || !(await suscripcionActiva(env, id))) {
    return Response.redirect(new URL("/acceso/invalido/", url), 302);
  }
  return new Response(null, {
    status: 302,
    headers: { location: volver, "set-cookie": cookieAcceso(ficha), "cache-control": "no-store" },
  });
}

async function accesoPorCorreo(request, url, env) {
  if (!env.RESEND_API_KEY || !env.MP_ACCESS_TOKEN) return json({ ok: false }, 503);
  let datos = {};
  try { datos = await request.json(); } catch { /* cuerpo inválido */ }
  const correo = String(datos.correo || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(correo)) return json({ ok: false }, 400);
  const volver = rutaSegura(datos.volver);

  try {
    const r = await mp(env, `/preapproval/search?status=authorized&payer_email=${encodeURIComponent(correo)}`);
    const s = (r?.results || []).find((x) => PLANES.has(x.preapproval_plan_id) && x.status === "authorized");
    if (s) {
      const enlace = new URL("/acceso/", url);
      enlace.searchParams.set("t", await fichaDe(env, s.id));
      enlace.searchParams.set("volver", volver);
      await enviarCorreo(env, correo, enlace.href);
    }
  } catch (e) {
    console.error(`acceso por correo: ${e.message}`);
    return json({ ok: false }, 502);
  }
  // Misma respuesta haya o no suscripción: así nadie puede averiguar quién está suscrito
  return json({ ok: true });
}

async function enviarCorreo(env, para, enlace) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.CORREO_REMITENTE || "Jesus Prospero <acceso@jesusprospero.pe>",
      to: [para],
      subject: "Tu enlace para leer las notas exclusivas",
      text: `Hola:\n\nEste es tu enlace para leer las notas exclusivas de jesusprospero.pe:\n\n${enlace}\n\nÁbrelo en el celular o la computadora donde quieras leer. Es personal: no lo compartas.\n\nGracias por apoyar este trabajo.\nJesus Prospero`,
    }),
  });
  if (!r.ok) throw new Error(`Resend respondió ${r.status}`);
}

// La suscripción tiene que seguir activa: se mira el registro (al día gracias al webhook)
// y, si no está, se pregunta a Mercado Pago.
async function suscripcionActiva(env, id) {
  if (env.DB) {
    const fila = await env.DB.prepare("SELECT estado FROM suscripciones WHERE id = ?1").bind(id).first();
    if (fila) return fila.estado === "authorized";
  }
  if (!env.MP_ACCESS_TOKEN) return false;
  try {
    const s = await mp(env, `/preapproval/${encodeURIComponent(id)}`);
    if (!s || !PLANES.has(s.preapproval_plan_id)) return false;
    try { await guardarSuscripcion(env, s); } catch { /* se registrará con el webhook */ }
    return s.status === "authorized";
  } catch {
    return false;
  }
}

// Ficha de acceso = id de la suscripción + firma. Sin la clave nadie puede fabricar una.
async function fichaDe(env, id) {
  return `${id}.${await firma(env, id)}`;
}

async function idDeFicha(env, ficha) {
  const [id, f] = String(ficha).split(".");
  if (!id || !f || !ID_VALIDO.test(id)) return null;
  return igualSeguro(await firma(env, id), f) ? id : null;
}

async function firma(env, id) {
  const secreto = env.ACCESO_SECRET || `acceso:${env.MP_ACCESS_TOKEN || ""}`;
  if (secreto === "acceso:") throw new Error("Falta ACCESO_SECRET o MP_ACCESS_TOKEN");
  const clave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const s = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(`acceso:${id}`));
  return hex(s).slice(0, 32);
}

function cookieAcceso(ficha) {
  return `${COOKIE}=${encodeURIComponent(ficha)}; Max-Age=${UN_ANIO}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function rutaSegura(ruta) {
  return typeof ruta === "string" && /^\/noticias\/[a-z0-9-]+\/$/.test(ruta) ? ruta : "/noticias/";
}

// ───────── Estado de una suscripción (página de confirmación) ─────────

async function estado(url, env) {
  const id = url.searchParams.get("preapproval_id") || "";
  if (!ID_VALIDO.test(id)) return json({ estado: "invalido" }, 400);
  if (!env.MP_ACCESS_TOKEN) return json({ estado: "no_configurado" }, 503);

  let s;
  try {
    s = await mp(env, `/preapproval/${encodeURIComponent(id)}`);
  } catch {
    return json({ estado: "error" }, 502);
  }
  const plan = s && PLANES.get(s.preapproval_plan_id);
  if (!plan) return json({ estado: "no_encontrado" }, 404);

  // Si el registro falla, igual se muestra el estado real; el webhook volverá a intentarlo
  try { await guardarSuscripcion(env, s); } catch (e) { console.error(`estado ${id}: no se pudo registrar: ${e.message}`); }

  const datos = {
    estado: s.status,                                   // authorized | pending | paused | cancelled
    plan: plan.nombre,
    monto: s.auto_recurring?.transaction_amount ?? null,
    moneda: s.auto_recurring?.currency_id ?? null,
    frecuencia: s.auto_recurring?.frequency ?? null,
    tipo_frecuencia: s.auto_recurring?.frequency_type ?? null,
    proximo_cobro: s.next_payment_date ?? null,
  };
  if (s.status !== "authorized") return json(datos);

  // Suscripción activa: este navegador queda con acceso y el lector recibe su enlace personal
  const ficha = await fichaDe(env, s.id);
  datos.acceso = new URL(`/acceso/?t=${encodeURIComponent(ficha)}`, url).href;
  const r = json(datos);
  r.headers.append("set-cookie", cookieAcceso(ficha));
  return r;
}

// ───────── Webhook de Mercado Pago ─────────

async function webhook(request, url, env) {
  if (!env.MP_WEBHOOK_SECRET || !env.MP_ACCESS_TOKEN) return json({ ok: false }, 503);

  let body = {};
  try { body = await request.json(); } catch { /* cuerpo vacío o inválido */ }

  const dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "");
  // El tipo del cuerpo es el documentado; la dirección puede traer otro distinto (pasa en las simulaciones)
  const tipo = body?.type ?? url.searchParams.get("type") ?? "";

  if (!ID_VALIDO.test(dataId) || !(await firmaValida(request, dataId, env.MP_WEBHOOK_SECRET))) {
    return json({ ok: false }, 401);
  }

  try {
    if (tipo === "subscription_preapproval") {
      const s = await mp(env, `/preapproval/${encodeURIComponent(dataId)}`);
      if (s && PLANES.has(s.preapproval_plan_id)) await guardarSuscripcion(env, s);
      else console.log(`webhook ${tipo} ${dataId}: no es una suscripción de esta web, se ignora`);
    } else if (tipo === "subscription_authorized_payment") {
      const p = await mp(env, `/authorized_payments/${encodeURIComponent(dataId)}`);
      if (p) await guardarPago(env, p);
      else console.log(`webhook ${tipo} ${dataId}: cobro no encontrado, se ignora`);
    } else {
      console.log(`webhook ${tipo || "(sin tipo)"} ${dataId}: tipo no usado, se ignora`);
    }
  } catch (e) {
    // Error temporal (Mercado Pago caído o base de datos): Mercado Pago reintentará la notificación
    console.error(`webhook ${tipo} ${dataId}: ${e.message}`);
    return json({ ok: false }, 500);
  }
  return json({ ok: true });
}

// Firma de Mercado Pago: HMAC-SHA256 de "id:{data.id};request-id:{x-request-id};ts:{ts};"
async function firmaValida(request, dataId, secreto) {
  const cabecera = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id");
  const partes = {};
  for (const parte of cabecera.split(",")) {
    const [k, v] = parte.split("=").map((x) => x && x.trim());
    if (k && v) partes[k] = v;
  }
  if (!partes.ts || !partes.v1) return false;

  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifiesto = `id:${id};`;
  if (requestId) manifiesto += `request-id:${requestId};`;
  manifiesto += `ts:${partes.ts};`;

  const clave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(manifiesto));
  return igualSeguro(hex(firma), partes.v1.toLowerCase());
}

// ───────── Registro técnico mínimo (D1) ─────────

// Los upsert son idempotentes: la misma notificación repetida no crea duplicados,
// y un evento viejo que llega tarde no pisa un estado más reciente.
async function guardarSuscripcion(env, s) {
  if (!env.DB) return;
  const ahora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO suscripciones (id, plan_id, monto, moneda, estado, proximo_cobro, creada_en, actualizada_en)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(id) DO UPDATE SET
       estado = excluded.estado, monto = excluded.monto, moneda = excluded.moneda,
       proximo_cobro = excluded.proximo_cobro, actualizada_en = excluded.actualizada_en
     WHERE excluded.actualizada_en >= suscripciones.actualizada_en`
  ).bind(
    s.id,
    s.preapproval_plan_id ?? null,
    s.auto_recurring?.transaction_amount ?? null,
    s.auto_recurring?.currency_id ?? null,
    s.status ?? "desconocido",
    s.next_payment_date ?? null,
    s.date_created ?? ahora,
    s.last_modified ?? ahora
  ).run();
}

async function guardarPago(env, p) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO pagos (id, suscripcion_id, monto, moneda, estado, fecha, actualizado_en)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET estado = excluded.estado, actualizado_en = excluded.actualizado_en`
  ).bind(
    String(p.id),
    p.preapproval_id ?? null,
    p.transaction_amount ?? null,
    p.currency_id ?? null,
    p.payment?.status ?? p.status ?? null,
    p.debit_date ?? p.date_created ?? null,
    new Date().toISOString()
  ).run();
}

// ───────── Utilidades ─────────

async function mp(env, ruta) {
  const r = await fetch(`${env.MP_API_BASE || MP_API}${ruta}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  // 400/404: el recurso no existe o el id no es válido (por ejemplo, en las simulaciones de Mercado Pago)
  if (r.status === 400 || r.status === 404) return null;
  // 401/403: Mercado Pago también responde así cuando el recurso no pertenece a esta cuenta.
  // Se confirma que la llave sigue funcionando; si funciona, el recurso es ajeno y se ignora.
  if ((r.status === 401 || r.status === 403) && (await llaveValida(env))) return null;
  if (!r.ok) throw new Error(`Mercado Pago respondió ${r.status} en ${ruta}`);
  return r.json();
}

// Consulta los propios planes de suscripción: una llave de suscripciones siempre tiene permiso para esto
async function llaveValida(env) {
  const estados = [];
  for (const ruta of ["/preapproval_plan/search?limit=1", "/preapproval/search?limit=1"]) {
    const r = await fetch(`${env.MP_API_BASE || MP_API}${ruta}`, {
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
    });
    if (r.ok) return true;
    estados.push(`${r.status} en ${ruta}`);
  }
  console.error(`La llave MP_ACCESS_TOKEN no funciona (Mercado Pago respondió ${estados.join(", ")})`);
  return false;
}

function json(datos, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function igualSeguro(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}
