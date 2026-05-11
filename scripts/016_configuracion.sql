-- 016: Tabla de configuración del sistema (prompt del agente, etc.)
-- Ejecutar: mysql -u USER -p cobranzas_guipak < scripts/016_configuracion.sql

CREATE TABLE IF NOT EXISTS cobranza_configuracion (
  clave        VARCHAR(100) PRIMARY KEY,
  valor        LONGTEXT     NOT NULL,
  descripcion  VARCHAR(255) DEFAULT NULL,
  actualizado_por VARCHAR(100) DEFAULT NULL,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
