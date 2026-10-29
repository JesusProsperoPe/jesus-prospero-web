// Utilidades compartidas por el Worker.

export function json(datos, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function hex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function igualSeguro(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

// Texto al azar apto para cookies y enlaces
export function aleatorio(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Lo que se guarda de una cookie o un enlace: su huella, nunca el valor
export async function huella(texto) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
}

// Firma corta con la clave del sitio (enlaces de acceso y de moderación)
export async function firmar(env, texto) {
  const secreto = env.ACCESO_SECRET || `acceso:${env.MP_ACCESS_TOKEN || ""}`;
  if (secreto === "acceso:") throw new Error("Falta ACCESO_SECRET o MP_ACCESS_TOKEN");
  const clave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(texto))).slice(0, 32);
}

// Ficha de acceso = id de la suscripción + firma. Sin la clave nadie puede fabricar una.
export const COOKIE_ACCESO = "jp_acceso";
const ID_FICHA = /^[A-Za-z0-9_-]{6,64}$/;

export async function fichaDe(env, id) {
  return `${id}.${await firmar(env, `acceso:${id}`)}`;
}

export async function idDeFicha(env, ficha) {
  const [id, f] = String(ficha).split(".");
  if (!id || !f || !ID_FICHA.test(id)) return null;
  return igualSeguro(await firmar(env, `acceso:${id}`), f) ? id : null;
}

export function leerCookie(request, nombre) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]*)`));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

// Los formularios solo se aceptan desde esta misma web
export function mismoOrigen(request, url) {
  return request.headers.get("origin") === url.origin;
}

export async function leerJson(request) {
  try { return (await request.json()) || {}; } catch { return {}; }
}

export const CORREO_VALIDO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function enviarCorreo(env, para, asunto, texto) {
  if (!env.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.CORREO_REMITENTE || "Jesus Prospero <acceso@jesusprospero.pe>",
      to: [para],
      subject: asunto,
      text: texto,
    }),
  });
  if (!r.ok) throw new Error(`Resend respondió ${r.status}`);
}

export function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Página sencilla con el estilo del sitio, para respuestas del Worker (moderación)
export function pagina(titulo, cuerpo, status = 200) {
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapar(titulo)} · Jesus Prospero</title><link rel="stylesheet" href="/css/estilo.css"></head>
<body><main class="contenedor moderar">${cuerpo}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}
