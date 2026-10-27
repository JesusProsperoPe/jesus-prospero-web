// Revisa qué medios de pago acepta cada plan de aporte y trata de habilitar
// tarjeta de débito y saldo de Mercado Pago, además de tarjeta de crédito.
//
// Uso (en tu computadora):
//   $env:MP_ACCESS_TOKEN = Read-Host "Pega tu Access Token"
//   node scripts/permitir-debito.mjs
//
// Solo modifica los 4 planes de src/_data/aportes.json. No toca suscripciones existentes.

import { readFileSync } from "node:fs";

const TOKEN = process.env.MP_ACCESS_TOKEN;
const API = "https://api.mercadopago.com";
if (!TOKEN) { console.error("Falta MP_ACCESS_TOKEN."); process.exit(1); }

const aportes = JSON.parse(readFileSync(new URL("../src/_data/aportes.json", import.meta.url), "utf8"));
const planes = aportes.planes
  .map((p) => ({ ...p, id: new URL(p.link).searchParams.get("preapproval_plan_id") }))
  .filter((p) => p.id);

async function mp(metodo, ruta, cuerpo) {
  const r = await fetch(API + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, datos };
}

const tipos = (plan) =>
  (plan.payment_methods_allowed?.payment_types || []).map((t) => t.id).join(", ") || "(sin restricción declarada)";

for (const p of planes) {
  const antes = await mp("GET", `/preapproval_plan/${p.id}`);
  if (!antes.ok) { console.log(`✗ ${p.nombre}: no se pudo leer el plan (${antes.status})`); continue; }
  console.log(`\n${p.nombre} (S/${p.monto})`);
  console.log(`  antes:  ${tipos(antes.datos)}`);

  // Mercado Pago exige enviar los datos principales del plan junto con el cambio
  const a = antes.datos.auto_recurring || {};
  const cambio = await mp("PUT", `/preapproval_plan/${p.id}`, {
    reason: antes.datos.reason,
    back_url: antes.datos.back_url,
    auto_recurring: {
      frequency: a.frequency,
      frequency_type: a.frequency_type,
      transaction_amount: a.transaction_amount,
      currency_id: a.currency_id,
    },
    payment_methods_allowed: {
      payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "account_money" }],
    },
  });
  if (!cambio.ok) {
    console.log(`  ✗ Mercado Pago rechazó el cambio (${cambio.status}): ${cambio.datos.message || JSON.stringify(cambio.datos)}`);
    continue;
  }
  const despues = await mp("GET", `/preapproval_plan/${p.id}`);
  console.log(`  ahora:  ${tipos(despues.datos)}`);
}
console.log("\nListo. Abre el link de un plan y revisa qué medios de pago aparecen.");
