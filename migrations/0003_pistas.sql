-- Pistas de lectores para el contador de mentiras del gobierno (ver worker/pistas.js).
-- El Worker también la crea sola al arrancar (worker/base.js).
CREATE TABLE IF NOT EXISTS pistas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  que_dijo TEXT NOT NULL,
  quien TEXT,
  donde TEXT,
  enlace TEXT,
  nombre TEXT,
  contacto TEXT,
  origen TEXT NOT NULL,                     -- huella de la IP (para el límite por hora); nunca la IP
  estado TEXT NOT NULL DEFAULT 'nueva',     -- nueva | en_revision | publicada | descartada
  nota TEXT,                                -- motivo o caso publicado
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pistas_estado ON pistas (estado, creado_en);
CREATE INDEX IF NOT EXISTS idx_pistas_origen ON pistas (origen, creado_en);
