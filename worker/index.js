// Backend mínimo de aportes mensuales (Cloudflare Worker).
// - GET  /api/aporte/estado?preapproval_id=…  → consulta a Mercado Pago el estado REAL de una suscripción.
// - POST /api/mercadopago/webhook             → recibe notificaciones firmadas de Mercado Pago.
// Todo lo demás lo sirve el sitio estático (carpeta _site).
//
// Variables secretas (se configuran en Cloudflare, nunca en el código):
//   MP_ACCESS_TOKEN     Access Token de producción de tu aplicación de Mercado Pago.
//   MP_WEBHOOK_SECRET   Clave secreta de las notificaciones (webhooks) de esa aplicación.
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
    if (url.pathname.startsWith("/api/")) return json({ error: "No encontrado" }, 404);

    return env.ASSETS.fetch(request);
  },
};

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

  return json({
    estado: s.status,                                   // authorized | pending | paused | cancelled
    plan: plan.nombre,
    monto: s.auto_recurring?.transaction_amount ?? null,
    moneda: s.auto_recurring?.currency_id ?? null,
    frecuencia: s.auto_recurring?.frequency ?? null,
    tipo_frecuencia: s.auto_recurring?.frequency_type ?? null,
    proximo_cobro: s.next_payment_date ?? null,
  });
}

// ───────── Webhook de Mercado Pago ─────────

async function webhook(request, url, env) {
  if (!env.MP_WEBHOOK_SECRET || !env.MP_ACCESS_TOKEN) return json({ ok: false }, 503);

  let body = {};
  try { body = await request.json(); } catch { /* cuerpo vacío o inválido */ }

  const dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "");
  const tipo = url.searchParams.get("type") ?? body?.type ?? "";

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

async function llaveValida(env) {
  const r = await fetch(`${env.MP_API_BASE || MP_API}/users/me`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });
  if (!r.ok) console.error(`La llave MP_ACCESS_TOKEN no funciona (Mercado Pago respondió ${r.status} en /users/me)`);
  return r.ok;
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
