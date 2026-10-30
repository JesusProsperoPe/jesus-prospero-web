// Pistas para el contador de mentiras del gobierno: los lectores cuentan lo que vieron o escucharon.
// - POST /api/pistas → guarda la pista como "nueva". No se publica nada: la revisión diaria
//   (tarea programada de Claude) las lee en D1, las verifica y marca cada una como
//   "publicada", "descartada" o "en_revision" (columna nota: el motivo).
// Para frenar el spam: campo trampa, límite por persona (huella de la IP, nunca la IP) y textos cortos.

import { json, mismoOrigen, leerJson, huella } from "./util.js";

const MAX_POR_HORA = 5;
const LARGO = { que_dijo: 1500, quien: 120, donde: 300, enlace: 500, nombre: 80, contacto: 120 };

export async function rutasPistas(request, url, env) {
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!env.DB) return json({ error: "No disponible por ahora." }, 503);
  if (!mismoOrigen(request, url)) return json({ error: "Origen no permitido" }, 403);

  const d = await leerJson(request);
  // Campo trampa: las personas no lo ven; los robots lo llenan
  if (d.web) return json({ ok: true });

  const campos = {};
  for (const [k, max] of Object.entries(LARGO)) campos[k] = String(d[k] || "").trim().slice(0, max);
  if (campos.que_dijo.length < 15) return json({ error: "Cuéntame qué se dijo (al menos una frase)." }, 400);
  if (campos.enlace && !/^https?:\/\/\S+$/i.test(campos.enlace)) return json({ error: "El enlace debe empezar con http:// o https://" }, 400);

  const origen = await huella(`pista:${request.headers.get("cf-connecting-ip") || ""}`);
  const haceUnaHora = new Date(Date.now() - 3600 * 1000).toISOString();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM pistas WHERE origen = ? AND creado_en > ?")
    .bind(origen, haceUnaHora).first();
  if (n >= MAX_POR_HORA) return json({ error: "Ya enviaste varias pistas. Intenta de nuevo en una hora." }, 429);

  await env.DB.prepare(
    `INSERT INTO pistas (que_dijo, quien, donde, enlace, nombre, contacto, origen, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(campos.que_dijo, campos.quien, campos.donde, campos.enlace, campos.nombre, campos.contacto, origen, new Date().toISOString()).run();

  return json({ ok: true });
}
