// Backend mínimo de aportes mensuales (Cloudflare Worker).
// - GET  /api/aporte/estado?preapproval_id=…  → consulta a Mercado Pago el estado REAL de una suscripción
//                                               (si está activa, deja al lector con acceso a las notas exclusivas).
// - POST /api/mercadopago/webhook             → recibe notificaciones firmadas de Mercado Pago.
// - GET  /acceso/?t=…                         → enlace personal de acceso del suscriptor.
// - /api/cuenta/…                             → cuentas de lectores (ver cuentas.js).
// - /api/comentarios…                         → comentarios moderados (ver comentarios.js).
// - /noticias/…                             → a suscriptores (y a Google) les completa las notas exclusivas.
// Todo lo demás lo sirve el sitio estático (carpeta _site).
//
// Variables secretas (se configuran en Cloudflare, nunca en el código):
//   MP_ACCESS_TOKEN     Access Token de producción de tu aplicación de Mercado Pago.
//   MP_WEBHOOK_SECRET   Clave secreta de las notificaciones (webhooks) de esa aplicación.
//   ACCESO_SECRET       (opcional) Clave para firmar los enlaces de acceso. Si falta, se deriva de MP_ACCESS_TOKEN.
//   RESEND_API_KEY      Para los correos (verificación, contraseña, moderación).
//   GOOGLE_CLIENT_SECRET (opcional) Ingreso con Google, junto con la variable normal GOOGLE_CLIENT_ID.
// Variables normales: CORREO_REMITENTE ("Jesus Prospero <acceso@jesusprospero.pe>") y MODERADOR_CORREO.
// Base de datos: D1 con el nombre de enlace DB (ver migrations/).
//
// Nunca se guardan datos de tarjeta. De los lectores con cuenta: nombre, correo y la contraseña cifrada.

import aportes from "../src/_data/aportes.json";
import { json, hex, igualSeguro, fichaDe, idDeFicha, leerCookie, COOKIE_ACCESO, mismoOrigen, leerJson, CORREO_VALIDO } from "./util.js";
import { rutasCuenta, cuentaDeSesion, cuentaSuscrita, vincularSuscripcion } from "./cuentas.js";
import { rutasComentarios } from "./comentarios.js";
import { prepararBase } from "./base.js";

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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    await prepararBase(env);

    if (url.pathname === "/api/aporte/estado") {
      if (request.method !== "GET") return json({ error: "Método no permitido" }, 405);
      return estado(request, url, env);
    }
    if (url.pathname === "/api/mercadopago/webhook") {
      if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
      return webhook(request, url, env);
    }
    if (url.pathname === "/api/suscripcion/crear") {
      if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
      return crearSuscripcion(request, url, env);
    }
    if (url.pathname === "/api/suscripcion/cancelar") {
      if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
      return cancelarSuscripcion(request, url, env);
    }
    if (url.pathname.startsWith("/api/cuenta/")) return rutasCuenta(request, url, env, ctx);
    if (url.pathname === "/api/comentarios" || url.pathname.startsWith("/api/comentarios/")) {
      return rutasComentarios(request, url, env, ctx);
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

const UN_ANIO = 60 * 60 * 24 * 365;

async function noticia(request, url, env) {
  const lector = esGoogle(request) ? "google"
    : (await suscriptorDeCookie(request, env)) || (await suscriptorDeCuenta(request, env));
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
  const ficha = leerCookie(request, COOKIE_ACCESO);
  const id = ficha && (await idDeFicha(env, ficha));
  return id && (await suscripcionActiva(env, id)) ? id : null;
}

async function suscriptorDeCuenta(request, env) {
  if (!leerCookie(request, "jp_sesion")) return null;
  const cuenta = await cuentaDeSesion(request, env);
  return cuenta && (await cuentaSuscrita(env, cuenta.id)) ? cuenta.id : null;
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

function cookieAcceso(ficha) {
  return `${COOKIE_ACCESO}=${encodeURIComponent(ficha)}; Max-Age=${UN_ANIO}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function rutaSegura(ruta) {
  return typeof ruta === "string" && /^\/noticias\/[a-z0-9-]+\/$/.test(ruta) ? ruta : "/noticias/";
}

// ───────── Estado de una suscripción (página de confirmación) ─────────

async function estado(request, url, env) {
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
  // Con la sesión iniciada, la suscripción queda guardada en la cuenta
  try {
    const cuenta = await cuentaDeSesion(request, env);
    if (cuenta) {
      await vincularSuscripcion(env, s.id, cuenta.id);
      datos.cuenta = true;
    }
  } catch (e) { console.error(`estado ${id}: no se pudo vincular a la cuenta: ${e.message}`); }

  if (s.status !== "authorized") return json(datos);

  // Suscripción activa: este navegador queda con acceso y el lector recibe su enlace personal
  const ficha = await fichaDe(env, s.id);
  datos.acceso = new URL(`/acceso/?t=${encodeURIComponent(ficha)}`, url).href;
  const r = json(datos);
  r.headers.append("set-cookie", cookieAcceso(ficha));
  if (datos.cuenta) r.headers.append("set-cookie", `jp_sin_anuncios=1; Max-Age=${60 * 60 * 24 * 180}; Path=/; Secure; SameSite=Lax`);
  return r;
}

// ───────── Suscripción pagada dentro de la web (formulario de tarjeta de Mercado Pago) ─────────

const MAX_INTENTOS_PAGO = 5;   // por cuenta y por hora: frena a quien prueba tarjetas robadas

async function crearSuscripcion(request, url, env) {
  if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido" }, 403);
  if (!env.MP_ACCESS_TOKEN || !env.DB) return json({ error: "Los pagos no están disponibles por ahora." }, 503);
  const cuenta = await cuentaDeSesion(request, env);
  if (!cuenta) return json({ error: "Inicia sesión para suscribirte." }, 401);

  const datos = await leerJson(request);
  const planId = String(datos.plan || "");
  const token = String(datos.token || "");
  const correo = String(datos.email || "").trim().toLowerCase();
  if (!PLANES.has(planId)) return json({ error: "Ese plan no existe." }, 400);
  if (!/^[A-Za-z0-9]{10,100}$/.test(token)) return json({ error: "Revisa los datos de tu tarjeta." }, 400);
  if (await cuentaSuscrita(env, cuenta.id)) return json({ error: "Ya tienes una suscripción activa. Puedes verla en Mi cuenta." }, 409);

  const hora = new Date(Date.now() - 3600000).toISOString();
  const previos = await env.DB.prepare("SELECT COUNT(*) AS n FROM intentos_pago WHERE cuenta_id = ?1 AND creado_en > ?2")
    .bind(cuenta.id, hora).first();
  if (previos.n >= MAX_INTENTOS_PAGO) return json({ error: "Hiciste muchos intentos de pago. Espera una hora o paga en la web de Mercado Pago." }, 429);
  await env.DB.prepare("INSERT INTO intentos_pago (cuenta_id, creado_en) VALUES (?1, ?2)").bind(cuenta.id, new Date().toISOString()).run();

  const r = await fetch(`${env.MP_API_BASE || MP_API}/preapproval`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      preapproval_plan_id: planId,
      card_token_id: token,
      payer_email: CORREO_VALIDO.test(correo) ? correo : cuenta.correo,
      external_reference: cuenta.id,
      back_url: new URL("/aporte/gracias/", url).href,
      status: "authorized",
    }),
  });
  const s = await r.json().catch(() => ({}));
  if (!r.ok || !s.id) {
    console.error(`suscripción ${cuenta.id}: Mercado Pago respondió ${r.status}: ${s.message || s.error || ""} ${JSON.stringify(s.cause || "")}`);
    return json({ error: motivoRechazo(s) }, 402);
  }

  await guardarSuscripcion(env, s);
  await vincularSuscripcion(env, s.id, cuenta.id);
  const res = json({ ok: true, id: s.id, estado: s.status });
  if (s.status === "authorized") {
    res.headers.append("set-cookie", cookieAcceso(await fichaDe(env, s.id)));
    res.headers.append("set-cookie", `jp_sin_anuncios=1; Max-Age=${60 * 60 * 24 * 180}; Path=/; Secure; SameSite=Lax`);
  }
  return res;
}

// Cancelar desde Mi cuenta: Mercado Pago deja de cobrar y el acceso exclusivo termina
async function cancelarSuscripcion(request, url, env) {
  if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido" }, 403);
  if (!env.MP_ACCESS_TOKEN || !env.DB) return json({ error: "No se puede cancelar por ahora. Prueba en unos minutos." }, 503);
  const cuenta = await cuentaDeSesion(request, env);
  if (!cuenta) return json({ error: "Inicia sesión otra vez." }, 401);
  const fila = await env.DB.prepare("SELECT id FROM suscripciones WHERE cuenta_id = ?1 AND estado = 'authorized' LIMIT 1")
    .bind(cuenta.id).first();
  if (!fila) return json({ error: "No tienes una suscripción activa." }, 404);

  const r = await fetch(`${env.MP_API_BASE || MP_API}/preapproval/${encodeURIComponent(fila.id)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ status: "cancelled" }),
  });
  const s = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`cancelar ${fila.id}: Mercado Pago respondió ${r.status}: ${s.message || ""}`);
    return json({ error: "Mercado Pago no pudo cancelar la suscripción. Prueba en unos minutos." }, 502);
  }
  // Se guarda el estado devuelto; si no vino completo, se marca cancelada igual
  if (s.id) await guardarSuscripcion(env, s);
  await env.DB.prepare("UPDATE suscripciones SET estado = 'cancelled', actualizada_en = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), fila.id).run();
  const res = json({ ok: true });
  res.headers.append("set-cookie", "jp_sin_anuncios=; Max-Age=0; Path=/");
  res.headers.append("set-cookie", `${COOKIE_ACCESO}=; Max-Age=0; Path=/`);
  return res;
}

// Mensajes de Mercado Pago traducidos a algo que el lector entienda
function motivoRechazo(s) {
  const t = `${s.message || ""} ${JSON.stringify(s.cause || "")}`.toLowerCase();
  if (/high_risk|fraud|blacklist/.test(t)) return "Mercado Pago rechazó el pago por seguridad. Prueba con otra tarjeta o paga en la web de Mercado Pago.";
  if (/insufficient/.test(t)) return "La tarjeta no tiene fondos suficientes.";
  if (/security_code|cvv/.test(t)) return "El código de seguridad (CVV) no es correcto.";
  if (/expir|date/.test(t)) return "Revisa la fecha de vencimiento de la tarjeta.";
  if (/call_for_authorize|authorize/.test(t)) return "Tu banco pide que autorices este pago. Llama a tu banco y vuelve a intentarlo.";
  if (/disabled|card_disabled/.test(t)) return "Esa tarjeta está desactivada. Prueba con otra.";
  return "No se pudo completar el pago. Revisa los datos de tu tarjeta o prueba con otra.";
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
    `INSERT INTO suscripciones (id, plan_id, monto, moneda, estado, proximo_cobro, creada_en, actualizada_en, cuenta_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET
       estado = excluded.estado, monto = excluded.monto, moneda = excluded.moneda,
       proximo_cobro = excluded.proximo_cobro, actualizada_en = excluded.actualizada_en,
       cuenta_id = COALESCE(suscripciones.cuenta_id, excluded.cuenta_id)
     WHERE excluded.actualizada_en >= suscripciones.actualizada_en`
  ).bind(
    s.id,
    s.preapproval_plan_id ?? null,
    s.auto_recurring?.transaction_amount ?? null,
    s.auto_recurring?.currency_id ?? null,
    s.status ?? "desconocido",
    s.next_payment_date ?? null,
    s.date_created ?? ahora,
    s.last_modified ?? ahora,
    // Las suscripciones pagadas dentro de la web llevan el id de la cuenta
    /^[0-9a-f-]{36}$/.test(s.external_reference || "") ? s.external_reference : null
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
