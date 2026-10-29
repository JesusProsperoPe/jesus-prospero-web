-- Cuentas de lectores, sesiones y comentarios.
-- Las contraseñas se guardan cifradas (PBKDF2); las sesiones y los enlaces por correo, solo como huella SHA-256.

CREATE TABLE IF NOT EXISTS cuentas (
  id              TEXT PRIMARY KEY,
  correo          TEXT NOT NULL UNIQUE,   -- en minúsculas
  nombre          TEXT NOT NULL,          -- se muestra en los comentarios
  clave           TEXT,                   -- "pbkdf2$iteraciones$sal$hash"; vacío si entra solo con Google
  google_id       TEXT UNIQUE,
  verificada      INTEGER NOT NULL DEFAULT 0,
  intentos        INTEGER NOT NULL DEFAULT 0,  -- contraseñas fallidas seguidas
  bloqueada_hasta TEXT,
  creada_en       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
  id         TEXT PRIMARY KEY,            -- huella de la cookie
  cuenta_id  TEXT NOT NULL,
  expira_en  TEXT NOT NULL,
  creada_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_cuenta ON sesiones (cuenta_id);

-- Enlaces de un solo uso: verificar el correo o cambiar la contraseña
CREATE TABLE IF NOT EXISTS enlaces (
  id         TEXT PRIMARY KEY,            -- huella del enlace
  cuenta_id  TEXT NOT NULL,
  tipo       TEXT NOT NULL,               -- verificar | clave
  expira_en  TEXT NOT NULL,
  creado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_enlaces_cuenta ON enlaces (cuenta_id, tipo);

CREATE TABLE IF NOT EXISTS comentarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nota       TEXT NOT NULL,               -- ruta de la nota, /noticias/…/
  cuenta_id  TEXT NOT NULL,
  texto      TEXT NOT NULL,
  estado     TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobado | rechazado
  creado_en  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comentarios_nota ON comentarios (nota, estado);
CREATE INDEX IF NOT EXISTS idx_comentarios_cuenta ON comentarios (cuenta_id, creado_en);

-- La suscripción queda pegada a la cuenta de quien la pagó
ALTER TABLE suscripciones ADD COLUMN cuenta_id TEXT;
CREATE INDEX IF NOT EXISTS idx_suscripciones_cuenta ON suscripciones (cuenta_id);
