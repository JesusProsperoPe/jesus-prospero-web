// Cuentas de lectores: correo y contraseña, o Google.
// - POST /api/cuenta/existe            → ¿ese correo ya tiene cuenta? (para el primer paso del ingreso)
// - POST /api/cuenta/crear             → crea la cuenta y deja la sesión iniciada
// - POST /api/cuenta/entrar            → inicia sesión con contraseña
// - POST /api/cuenta/salir             → cierra la sesión
// - GET  /api/cuenta/yo                → datos de la cuenta y de su suscripción
// - POST /api/cuenta/verificar/enviar  → reenvía el correo de verificación
// - GET  /api/cuenta/verificar?t=…     → enlace del correo de verificación
// - POST /api/cuenta/olvide            → envía el enlace para cambiar la contraseña
// - POST /api/cuenta/clave             → cambia la contraseña con ese enlace
// - GET  /api/cuenta/google            → ingreso con Google (y /api/cuenta/google/vuelta)
//
// Variables: GOOGLE_CLIENT_ID (normal) y GOOGLE_CLIENT_SECRET (secreta). Sin ellas, Google queda apagado.

import { json, aleatorio, huella, leerCookie, mismoOrigen, leerJson, enviarCorreo, CORREO_VALIDO, idDeFicha, COOKIE_ACCESO } from "./util.js";

const SESION = "jp_sesion";        // HttpOnly: la sesión de verdad
const HOLA = "jp_hola";            // visible para la página: el nombre, para la cabecera
const SIN_ANUNCIOS = "jp_sin_anuncios";
const DURACION = 60 * 60 * 24 * 180;  // 6 meses
const ITERACIONES = 100000;        // el máximo que permite Cloudflare para PBKDF2
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

export async function rutasCuenta(request, url, env, ctx) {
  const ruta = url.pathname.replace(/^\/api\/cuenta/, "");
  const metodo = request.method;

  if (metodo === "GET") {
    if (ruta === "/yo") return yo(request, env);
    if (ruta === "/verificar") return verificar(url, env);
    if (ruta === "/google") return google(url, env);
    if (ruta === "/google/vuelta") return googleVuelta(request, url, env);
    return json({ error: "No encontrado" }, 404);
  }
  if (metodo !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido" }, 403);
  if (!env.DB) return json({ error: "Las cuentas no están disponibles por ahora." }, 503);

  const datos = await leerJson(request);
  switch (ruta) {
    case "/existe": return existe(datos, env);
    case "/crear": return crear(request, datos, url, env, ctx);
    case "/entrar": return entrar(request, datos, env);
    case "/salir": return salir(request, env);
    case "/verificar/enviar": return reenviarVerificacion(request, url, env);
    case "/olvide": return olvide(datos, url, env);
    case "/clave": return cambiarClave(request, datos, env);
  }
  return json({ error: "No encontrado" }, 404);
}

// ───────── Sesión ─────────

export async function cuentaDeSesion(request, env) {
  const valor = leerCookie(request, SESION);
  if (!valor || !env.DB) return null;
  return env.DB.prepare(
    `SELECT c.* FROM sesiones s JOIN cuentas c ON c.id = s.cuenta_id WHERE s.id = ?1 AND s.expira_en > ?2`
  ).bind(await huella(valor), new Date().toISOString()).first();
}

export async function cuentaSuscrita(env, cuentaId) {
  const fila = await env.DB.prepare(
    "SELECT 1 FROM suscripciones WHERE cuenta_id = ?1 AND estado = 'authorized' LIMIT 1"
  ).bind(cuentaId).first();
  return Boolean(fila);
}

// La suscripción pagada en este navegador pasa a ser de la cuenta (solo si todavía no es de nadie)
export async function vincularSuscripcion(env, suscripcionId, cuentaId) {
  await env.DB.prepare("UPDATE suscripciones SET cuenta_id = ?1 WHERE id = ?2 AND cuenta_id IS NULL")
    .bind(cuentaId, suscripcionId).run();
}

async function abrirSesion(request, env, cuenta, status = 200, extra = {}) {
  const valor = aleatorio();
  const ahora = new Date();
  await env.DB.prepare("INSERT INTO sesiones (id, cuenta_id, expira_en, creada_en) VALUES (?1, ?2, ?3, ?4)")
    .bind(await huella(valor), cuenta.id, new Date(ahora.getTime() + DURACION * 1000).toISOString(), ahora.toISOString())
    .run();
  // Si en este navegador ya había una suscripción pagada, se guarda en la cuenta
  if (request.vincular) await vincularSuscripcion(env, request.vincular, cuenta.id);
  const suscrita = await cuentaSuscrita(env, cuenta.id);
  const r = json({ ok: true, cuenta: publica(cuenta), suscrita, ...extra }, status);
  for (const c of cookiesSesion(valor, cuenta, suscrita)) r.headers.append("set-cookie", c);
  return r;
}

function cookiesSesion(valor, cuenta, suscrita) {
  const base = `Max-Age=${DURACION}; Path=/; Secure; SameSite=Lax`;
  const lista = [`${HOLA}=${encodeURIComponent(cuenta.nombre)}; ${base}`];
  if (valor) lista.unshift(`${SESION}=${valor}; ${base}; HttpOnly`);
  lista.push(suscrita ? `${SIN_ANUNCIOS}=1; ${base}` : `${SIN_ANUNCIOS}=; Max-Age=0; Path=/`);
  return lista;
}

function cookiesCerradas() {
  return [SESION, HOLA, SIN_ANUNCIOS].map((n) => `${n}=; Max-Age=0; Path=/; Secure; SameSite=Lax`);
}

function publica(c) {
  return { nombre: c.nombre, correo: c.correo, verificada: Boolean(c.verificada), clave: Boolean(c.clave), google: Boolean(c.google_id) };
}

// ───────── Ingreso con correo y contraseña ─────────

function correoDe(datos) {
  const correo = String(datos.correo || "").trim().toLowerCase();
  return CORREO_VALIDO.test(correo) ? correo : null;
}

async function existe(datos, env) {
  const correo = correoDe(datos);
  if (!correo) return json({ error: "Escribe un correo válido." }, 400);
  const c = await env.DB.prepare("SELECT clave, google_id FROM cuentas WHERE correo = ?1").bind(correo).first();
  return json({ existe: Boolean(c), clave: Boolean(c?.clave), google: Boolean(c?.google_id) });
}

async function crear(request, datos, url, env, ctx) {
  const correo = correoDe(datos);
  const nombre = String(datos.nombre || "").trim().replace(/\s+/g, " ");
  const clave = String(datos.clave || "");
  if (!correo) return json({ error: "Escribe un correo válido." }, 400);
  if (nombre.length < 2 || nombre.length > 60) return json({ error: "Tu nombre debe tener entre 2 y 60 letras." }, 400);
  if (clave.length < 8 || clave.length > 200) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);

  const cuenta = { id: crypto.randomUUID(), correo, nombre, clave: await cifrar(clave), google_id: null, verificada: 0 };
  try {
    await env.DB.prepare(
      "INSERT INTO cuentas (id, correo, nombre, clave, verificada, creada_en) VALUES (?1, ?2, ?3, ?4, 0, ?5)"
    ).bind(cuenta.id, correo, nombre, cuenta.clave, new Date().toISOString()).run();
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return json({ error: "Ese correo ya tiene una cuenta. Inicia sesión." }, 409);
    throw e;
  }
  request.vincular = await suscripcionDeNavegador(request, env);
  // El correo de verificación sale aparte, para no hacer esperar a quien se registra
  const envio = enviarVerificacion(env, cuenta, url).catch((e) => console.error(`verificación: ${e.message}`));
  if (ctx) ctx.waitUntil(envio);
  return abrirSesion(request, env, cuenta, 201);
}

async function entrar(request, datos, env) {
  const correo = correoDe(datos);
  const clave = String(datos.clave || "");
  const mal = json({ error: "El correo o la contraseña no son correctos." }, 401);
  if (!correo || !clave) return mal;

  const c = await env.DB.prepare("SELECT * FROM cuentas WHERE correo = ?1").bind(correo).first();
  if (!c || !c.clave) return mal;
  const ahora = new Date();
  if (c.bloqueada_hasta && c.bloqueada_hasta > ahora.toISOString()) {
    return json({ error: `Demasiados intentos. Espera ${BLOQUEO_MIN} minutos o cambia tu contraseña.` }, 429);
  }
  if (!(await claveCorrecta(clave, c.clave))) {
    const intentos = c.intentos + 1;
    const bloqueo = intentos >= MAX_INTENTOS ? new Date(ahora.getTime() + BLOQUEO_MIN * 60000).toISOString() : null;
    await env.DB.prepare("UPDATE cuentas SET intentos = ?1, bloqueada_hasta = ?2 WHERE id = ?3")
      .bind(bloqueo ? 0 : intentos, bloqueo, c.id).run();
    return mal;
  }
  if (c.intentos || c.bloqueada_hasta) {
    await env.DB.prepare("UPDATE cuentas SET intentos = 0, bloqueada_hasta = NULL WHERE id = ?1").bind(c.id).run();
  }
  request.vincular = await suscripcionDeNavegador(request, env);
  return abrirSesion(request, env, c);
}

async function salir(request, env) {
  const valor = leerCookie(request, SESION);
  if (valor) await env.DB.prepare("DELETE FROM sesiones WHERE id = ?1").bind(await huella(valor)).run();
  const r = json({ ok: true });
  for (const c of cookiesCerradas()) r.headers.append("set-cookie", c);
  return r;
}

async function yo(request, env) {
  const google = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const cuenta = await cuentaDeSesion(request, env);
  if (!cuenta) {
    const r = json({ cuenta: null, google });
    // Si la sesión venció, la cabecera deja de saludar
    if (leerCookie(request, HOLA)) for (const c of cookiesCerradas()) r.headers.append("set-cookie", c);
    return r;
  }
  const s = await env.DB.prepare(
    `SELECT plan_id, monto, moneda, estado, proximo_cobro FROM suscripciones
     WHERE cuenta_id = ?1 ORDER BY (estado = 'authorized') DESC, actualizada_en DESC LIMIT 1`
  ).bind(cuenta.id).first();
  const r = json({ cuenta: publica(cuenta), suscripcion: s || null, google });
  // Mantiene al día el saludo y los anuncios (por si la suscripción cambió)
  for (const c of cookiesSesion(null, cuenta, s?.estado === "authorized")) r.headers.append("set-cookie", c);
  return r;
}

// ───────── Correos: verificar y cambiar contraseña ─────────

const VIGENCIA = { verificar: 7 * 24 * 60, clave: 60 };   // minutos
const ESPERA_REENVIO = 2;                                 // minutos entre correos del mismo tipo

async function crearEnlace(env, cuentaId, tipo) {
  const reciente = await env.DB.prepare(
    "SELECT 1 FROM enlaces WHERE cuenta_id = ?1 AND tipo = ?2 AND creado_en > ?3"
  ).bind(cuentaId, tipo, new Date(Date.now() - ESPERA_REENVIO * 60000).toISOString()).first();
  if (reciente) return null;
  const valor = aleatorio();
  const ahora = new Date();
  await env.DB.prepare("INSERT INTO enlaces (id, cuenta_id, tipo, expira_en, creado_en) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(await huella(valor), cuentaId, tipo, new Date(ahora.getTime() + VIGENCIA[tipo] * 60000).toISOString(), ahora.toISOString())
    .run();
  return valor;
}

async function usarEnlace(env, valor, tipo) {
  if (!valor || valor.length > 100) return null;
  const id = await huella(valor);
  const fila = await env.DB.prepare("SELECT cuenta_id FROM enlaces WHERE id = ?1 AND tipo = ?2 AND expira_en > ?3")
    .bind(id, tipo, new Date().toISOString()).first();
  if (!fila) return null;
  await env.DB.prepare("DELETE FROM enlaces WHERE cuenta_id = ?1 AND tipo = ?2").bind(fila.cuenta_id, tipo).run();
  return fila.cuenta_id;
}

async function enviarVerificacion(env, cuenta, url) {
  const valor = await crearEnlace(env, cuenta.id, "verificar");
  if (!valor) return false;
  const enlace = new URL(`/api/cuenta/verificar?t=${valor}`, url).href;
  await enviarCorreo(env, cuenta.correo, "Confirma tu correo en jesusprospero.pe",
    `Hola, ${cuenta.nombre}:\n\nGracias por crear tu cuenta en jesusprospero.pe. Confirma tu correo con este enlace:\n\n${enlace}\n\nCon tu correo confirmado ya puedes comentar en las notas.\n\nSi no creaste esta cuenta, ignora este mensaje.\n\nJesus Prospero`);
  return true;
}

async function reenviarVerificacion(request, url, env) {
  const cuenta = await cuentaDeSesion(request, env);
  if (!cuenta) return json({ error: "Inicia sesión otra vez." }, 401);
  if (cuenta.verificada) return json({ ok: true, verificada: true });
  try {
    const enviado = await enviarVerificacion(env, cuenta, url);
    if (!enviado) return json({ error: `Ya te enviamos un correo. Espera ${ESPERA_REENVIO} minutos para pedir otro.` }, 429);
  } catch (e) {
    console.error(`verificación: ${e.message}`);
    return json({ error: "No pudimos enviar el correo. Prueba en unos minutos." }, 502);
  }
  return json({ ok: true });
}

async function verificar(url, env) {
  const cuentaId = env.DB && (await usarEnlace(env, url.searchParams.get("t"), "verificar"));
  if (!cuentaId) return Response.redirect(new URL("/mi-cuenta/?verificada=no", url), 302);
  await env.DB.prepare("UPDATE cuentas SET verificada = 1 WHERE id = ?1").bind(cuentaId).run();
  return Response.redirect(new URL("/mi-cuenta/?verificada=si", url), 302);
}

async function olvide(datos, url, env) {
  const correo = correoDe(datos);
  if (!correo) return json({ error: "Escribe un correo válido." }, 400);
  const c = await env.DB.prepare("SELECT id, nombre, correo FROM cuentas WHERE correo = ?1").bind(correo).first();
  if (c) {
    try {
      const valor = await crearEnlace(env, c.id, "clave");
      if (valor) {
        const enlace = new URL(`/cuenta/clave/?t=${valor}`, url).href;
        await enviarCorreo(env, c.correo, "Cambia tu contraseña de jesusprospero.pe",
          `Hola, ${c.nombre}:\n\nPara crear una contraseña nueva, abre este enlace (vence en una hora):\n\n${enlace}\n\nSi no lo pediste, ignora este mensaje: tu contraseña sigue igual.\n\nJesus Prospero`);
      }
    } catch (e) {
      console.error(`olvidé: ${e.message}`);
      return json({ error: "No pudimos enviar el correo. Prueba en unos minutos." }, 502);
    }
  }
  return json({ ok: true });
}

async function cambiarClave(request, datos, env) {
  const clave = String(datos.clave || "");
  if (clave.length < 8 || clave.length > 200) return json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  const cuentaId = await usarEnlace(env, String(datos.t || ""), "clave");
  if (!cuentaId) return json({ error: "El enlace venció o ya se usó. Pide uno nuevo." }, 400);
  // Quien abre el enlace demuestra que el correo es suyo: queda verificado, desbloqueado y con sesiones nuevas
  await env.DB.batch([
    env.DB.prepare("UPDATE cuentas SET clave = ?1, verificada = 1, intentos = 0, bloqueada_hasta = NULL WHERE id = ?2")
      .bind(await cifrar(clave), cuentaId),
    env.DB.prepare("DELETE FROM sesiones WHERE cuenta_id = ?1").bind(cuentaId),
  ]);
  const c = await env.DB.prepare("SELECT * FROM cuentas WHERE id = ?1").bind(cuentaId).first();
  return abrirSesion(request, env, c);
}

// ───────── Google ─────────

const ESTADO_GOOGLE = "jp_google";

function volverSeguro(ruta) {
  return typeof ruta === "string" && /^\/[a-z0-9\-/]*$/.test(ruta) && !ruta.startsWith("//") ? ruta : "/mi-cuenta/";
}

function google(url, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return Response.redirect(new URL("/ingresar/?error=google", url), 302);
  const estado = aleatorio(16);
  const destino = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  destino.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL("/api/cuenta/google/vuelta", url).href,
    response_type: "code",
    scope: "openid email profile",
    state: estado,
    prompt: "select_account",
  });
  const volver = volverSeguro(url.searchParams.get("volver"));
  return new Response(null, {
    status: 302,
    headers: {
      location: destino.href,
      "set-cookie": `${ESTADO_GOOGLE}=${estado}|${encodeURIComponent(volver)}; Max-Age=600; Path=/api/cuenta/google; HttpOnly; Secure; SameSite=Lax`,
      "cache-control": "no-store",
    },
  });
}

async function googleVuelta(request, url, env) {
  const fallo = (motivo) => {
    console.error(`google: ${motivo}`);
    return Response.redirect(new URL("/ingresar/?error=google", url), 302);
  };
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.DB) return fallo("no configurado");
  const [estado, volverCod] = (leerCookie(request, ESTADO_GOOGLE) || "").split("|");
  const code = url.searchParams.get("code");
  if (!estado || !code || estado !== url.searchParams.get("state")) return fallo("estado inválido o ingreso cancelado");

  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: new URL("/api/cuenta/google/vuelta", url).href,
      grant_type: "authorization_code",
    }),
  });
  if (!t.ok) return fallo(`token ${t.status}`);
  const { access_token } = await t.json();
  const u = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${access_token}` } });
  if (!u.ok) return fallo(`userinfo ${u.status}`);
  const g = await u.json();
  const correo = String(g.email || "").toLowerCase();
  if (!g.sub || !g.email_verified || !CORREO_VALIDO.test(correo)) return fallo("correo no verificado por Google");

  let c = await env.DB.prepare("SELECT * FROM cuentas WHERE google_id = ?1").bind(g.sub).first();
  if (!c) {
    c = await env.DB.prepare("SELECT * FROM cuentas WHERE correo = ?1").bind(correo).first();
    if (c) {
      // Misma persona: Google confirma que el correo es suyo
      await env.DB.prepare("UPDATE cuentas SET google_id = ?1, verificada = 1 WHERE id = ?2").bind(g.sub, c.id).run();
      c.google_id = g.sub;
      c.verificada = 1;
    } else {
      const nombre = String(g.name || correo.split("@")[0]).trim().slice(0, 60) || "Lector";
      c = { id: crypto.randomUUID(), correo, nombre, clave: null, google_id: g.sub, verificada: 1 };
      await env.DB.prepare(
        "INSERT INTO cuentas (id, correo, nombre, google_id, verificada, creada_en) VALUES (?1, ?2, ?3, ?4, 1, ?5)"
      ).bind(c.id, correo, nombre, g.sub, new Date().toISOString()).run();
    }
  }
  request.vincular = await suscripcionDeNavegador(request, env);
  const sesion = await abrirSesion(request, env, c);
  const r = new Response(null, { status: 302, headers: { location: volverSeguro(decodeURIComponent(volverCod || "")), "cache-control": "no-store" } });
  for (const [k, v] of sesion.headers) if (k === "set-cookie") r.headers.append("set-cookie", v);
  r.headers.append("set-cookie", `${ESTADO_GOOGLE}=; Max-Age=0; Path=/api/cuenta/google`);
  return r;
}

// ───────── Contraseñas ─────────

async function derivar(clave, sal, iteraciones) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: iteraciones }, base, 256));
}

const b64 = (b) => btoa(String.fromCharCode(...b));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function cifrar(clave) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERACIONES}$${b64(sal)}$${b64(await derivar(clave, sal, ITERACIONES))}`;
}

async function claveCorrecta(clave, guardada) {
  const [tipo, it, sal, hash] = String(guardada).split("$");
  if (tipo !== "pbkdf2") return false;
  const calculada = b64(await derivar(clave, deB64(sal), Number(it)));
  let dif = calculada.length ^ hash.length;
  for (let i = 0; i < Math.min(calculada.length, hash.length); i++) dif |= calculada.charCodeAt(i) ^ hash.charCodeAt(i);
  return dif === 0;
}

// La cookie de acceso que queda al volver de pagar en Mercado Pago
async function suscripcionDeNavegador(request, env) {
  try { return await idDeFicha(env, leerCookie(request, COOKIE_ACCESO) || ""); } catch { return null; }
}
