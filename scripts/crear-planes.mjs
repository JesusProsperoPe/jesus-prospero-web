// Crea (o reutiliza) los 4 planes de aporte mensual en Mercado Pago y muestra
// el contenido listo para src/_data/aportes.json.
//
// Uso (en tu computadora, nunca en el sitio):
//   $env:MP_ACCESS_TOKEN = "<tu Access Token>"   (PowerShell)
//   node scripts/crear-planes.mjs
//
// Si un plan con el mismo nombre ya existe y está activo, se reutiliza: correr el
// script dos veces no crea planes duplicados.

const TOKEN = process.env.MP_ACCESS_TOKEN;
const VOLVER_A = process.env.BACK_URL || "https://jesusprospero.pe/aporte/gracias/";
const API = "https://api.mercadopago.com";

const PLANES = [
  { nombre: "Semilla", monto: 3 },
  { nombre: "Amigo", monto: 5 },
  { nombre: "Impulsor", monto: 10 },
  { nombre: "Mecenas", monto: 20 },
];

if (!TOKEN) {
  console.error("Falta MP_ACCESS_TOKEN. Configúralo antes de ejecutar el script.");
  process.exit(1);
}

async function mp(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status}: ${JSON.stringify(datos)}`);
  return datos;
}

const razon = (p) => `Aporte mensual ${p.nombre} · Jesús Próspero`;

const existentes = (await mp("GET", "/preapproval_plan/search?status=active&limit=100")).results || [];
const salida = { planes: [] };

for (const p of PLANES) {
  let plan = existentes.find((e) => e.reason === razon(p) && e.auto_recurring?.transaction_amount === p.monto);
  if (plan) {
    console.log(`✓ ${p.nombre}: ya existía (${plan.id})`);
  } else {
    plan = await mp("POST", "/preapproval_plan", {
      reason: razon(p),
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: p.monto, currency_id: "PEN" },
      back_url: VOLVER_A,
    });
    console.log(`+ ${p.nombre}: creado (${plan.id})`);
  }
  if (plan.auto_recurring?.currency_id !== "PEN" || plan.auto_recurring?.frequency_type !== "months") {
    console.warn(`  ⚠ Revisa este plan: moneda ${plan.auto_recurring?.currency_id}, frecuencia ${plan.auto_recurring?.frequency} ${plan.auto_recurring?.frequency_type}`);
  }
  salida.planes.push({ nombre: p.nombre, monto: p.monto, link: plan.init_point });
}

console.log("\nPega esto en el panel (Planes de aporte mensual) o en src/_data/aportes.json:\n");
console.log(JSON.stringify(salida, null, 2));
