-- Migration 022 — Tabla de contactos múltiples por cliente
-- Permite guardar N emails, WhatsApp y teléfonos por cliente
-- en nuestra propia BD (sin tocar Softec — CP-01).
-- Reemplaza progresivamente los campos email/whatsapp de
-- cobranza_clientes_enriquecidos como fuente primaria de contacto.

CREATE TABLE IF NOT EXISTS cobranza_contactos_cliente (
  id            INT           NOT NULL AUTO_INCREMENT,
  codigo_cliente VARCHAR(20)  NOT NULL,
  tipo          ENUM('EMAIL','WHATSAPP','TELEFONO','OTRO') NOT NULL,
  valor         VARCHAR(255)  NOT NULL COMMENT 'Dirección email, número WA, teléfono, etc.',
  nombre_contacto VARCHAR(200) NULL    COMMENT 'Nombre de la persona (ej: Dpto. CxP)',
  es_principal  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = preferido para este tipo de canal',
  notas         VARCHAR(500)  NULL,
  origen        ENUM('MANUAL','TELEGRAM','PORTAL') NOT NULL DEFAULT 'MANUAL',
  creado_por    VARCHAR(100)  NULL,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_codigo_tipo  (codigo_cliente, tipo),
  INDEX idx_codigo       (codigo_cliente),
  INDEX idx_principal    (codigo_cliente, tipo, es_principal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
