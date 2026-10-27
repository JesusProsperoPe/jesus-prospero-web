-- Registro técnico mínimo de aportes mensuales.
-- Sin datos personales: no se guardan correos, nombres ni datos de tarjeta.

CREATE TABLE IF NOT EXISTS suscripciones (
  id              TEXT PRIMARY KEY,   -- preapproval_id de Mercado Pago
  plan_id         TEXT,               -- preapproval_plan_id
  monto           REAL,
  moneda          TEXT,
  estado          TEXT NOT NULL,      -- authorized | pending | paused | cancelled
  proximo_cobro   TEXT,
  creada_en       TEXT NOT NULL,
  actualizada_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suscripciones_estado ON suscripciones (estado);

CREATE TABLE IF NOT EXISTS pagos (
  id              TEXT PRIMARY KEY,   -- id del cobro recurrente (authorized_payment)
  suscripcion_id  TEXT,
  monto           REAL,
  moneda          TEXT,
  estado          TEXT,
  fecha           TEXT,
  actualizado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pagos_suscripcion ON pagos (suscripcion_id);
