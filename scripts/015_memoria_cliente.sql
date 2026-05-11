-- Capa 1: Memoria estructurada por cliente
-- Ejecutar en cobranzas_guipak con: mysql -u ... cobranzas_guipak < scripts/015_memoria_cliente.sql

CREATE TABLE IF NOT EXISTS cobranza_memoria_cliente (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  codigo_cliente   CHAR(12)     NOT NULL,
  patron_pago      TEXT         NULL COMMENT 'Cómo suele pagar: rápido, lento, siempre con recordatorio, etc.',
  canal_efectivo   ENUM('EMAIL','WHATSAPP','LLAMADA','OTRO') NULL COMMENT 'Canal que ha respondido mejor',
  contacto_real    VARCHAR(200) NULL COMMENT 'Nombre real del contacto de cobros',
  mejor_momento    VARCHAR(200) NULL COMMENT 'Cuándo es mejor contactar: lunes AM, etc.',
  notas_daria      TEXT         NULL COMMENT 'Notas libres del equipo de cobros',
  actualizado_por  VARCHAR(100) NULL,
  ultima_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cliente (codigo_cliente),
  INDEX idx_codigo (codigo_cliente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
