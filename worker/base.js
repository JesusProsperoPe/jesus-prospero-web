// Prepara la base D1 sola: crea las tablas que falten (las mismas de migrations/).
// Corre una vez por instancia del Worker; si ya están, no cambia nada.

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS cuentas (id TEXT PRIMARY KEY, correo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, clave TEXT,
     google_id TEXT UNIQUE, verificada INTEGER NOT NULL DEFAULT 0, intentos INTEGER NOT NULL DEFAULT 0,
     bloqueada_hasta TEXT, creada_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sesiones (id TEXT PRIMARY KEY, cuenta_id TEXT NOT NULL, expira_en TEXT NOT NULL, creada_en TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sesiones_cuenta ON sesiones (cuenta_id)`,
  `CREATE TABLE IF NOT EXISTS enlaces (id TEXT PRIMARY KEY, cuenta_id TEXT NOT NULL, tipo TEXT NOT NULL, expira_en TEXT NOT NULL, creado_en TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_enlaces_cuenta ON enlaces (cuenta_id, tipo)`,
  `CREATE TABLE IF NOT EXISTS comentarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nota TEXT NOT NULL, cuenta_id TEXT NOT NULL,
     texto TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', creado_en TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_comentarios_nota ON comentarios (nota, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_comentarios_cuenta ON comentarios (cuenta_id, creado_en)`,
  `CREATE TABLE IF NOT EXISTS intentos_pago (id INTEGER PRIMARY KEY AUTOINCREMENT, cuenta_id TEXT NOT NULL, creado_en TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_intentos_pago ON intentos_pago (cuenta_id, creado_en)`,
];

let lista = null;

export function prepararBase(env) {
  if (!env.DB) return Promise.resolve();
  if (!lista) {
    lista = preparar(env.DB).catch((e) => {
      lista = null;   // se reintenta en la próxima visita
      console.error(`preparar base: ${e.message}`);
    });
  }
  return lista;
}

async function preparar(db) {
  await db.batch(TABLAS.map((sql) => db.prepare(sql)));
  const { results } = await db.prepare("PRAGMA table_info(suscripciones)").all();
  if (results.length && !results.some((c) => c.name === "cuenta_id")) {
    await db.batch([
      db.prepare("ALTER TABLE suscripciones ADD COLUMN cuenta_id TEXT"),
      db.prepare("CREATE INDEX IF NOT EXISTS idx_suscripciones_cuenta ON suscripciones (cuenta_id)"),
    ]);
  }
}
