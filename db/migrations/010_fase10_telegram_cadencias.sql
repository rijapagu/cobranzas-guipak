-- Fase 10: Agente Proactivo vía Telegram
-- Ejecutar en cobranzas_guipak

-- Mapeo Telegram ↔ usuarios internos
CREATE TABLE IF NOT EXISTS cobranza_telegram_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  telegram_user_id BIGINT UNIQUE NOT NULL,
  telegram_username VARCHAR(64),
  usuario_id BIGINT UNSIGNED NOT NULL,
  rol ENUM('supervisor', 'agente_cobros') NOT NULL DEFAULT 'agente_cobros',
  activo TINYINT(1) DEFAULT 1,
  fecha_alta DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Insertar a Ricardo como supervisor (telegram_user_id confirmado)
-- Reemplazar usuario_id=1 con el id real de Ricardo en tabla usuarios
INSERT IGNORE INTO cobranza_telegram_usuarios
  (telegram_user_id, telegram_username, usuario_id, rol)
VALUES
  (7281538057, 'Ricardo', 1, 'supervisor');

-- Cadencias configurables por segmento
CREATE TABLE IF NOT EXISTS cobranza_cadencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  segmento ENUM('VERDE', 'AMARILLO', 'NARANJA', 'ROJO') NOT NULL,
  dia_desde_vencimiento INT NOT NULL,
  accion ENUM('EMAIL', 'WHATSAPP', 'LLAMADA_TICKET', 'RECLASIFICAR', 'ESCALAR_LEGAL') NOT NULL,
  requiere_aprobacion TINYINT(1) DEFAULT 1,
  plantilla_mensaje_id INT NULL,
  activa TINYINT(1) DEFAULT 1,
  UNIQUE KEY uq_segmento_dia (segmento, dia_desde_vencimiento)
);

-- Cadencias por defecto
INSERT IGNORE INTO cobranza_cadencias
  (segmento, dia_desde_vencimiento, accion, requiere_aprobacion)
VALUES
  ('VERDE',    1,  'EMAIL',          0),
  ('AMARILLO', 7,  'WHATSAPP',       1),
  ('AMARILLO', 15, 'LLAMADA_TICKET', 0),
  ('NARANJA',  30, 'WHATSAPP',       1),
  ('ROJO',     45, 'ESCALAR_LEGAL',  1);

-- Estado de cadencia por factura
CREATE TABLE IF NOT EXISTS cobranza_factura_cadencia_estado (
  factura_id VARCHAR(40) PRIMARY KEY,
  ultimo_paso_id INT NULL,
  fecha_ultimo_paso DATETIME NULL,
  proximo_paso_programado DATETIME NULL,
  pausada_hasta DATETIME NULL,
  motivo_pausa VARCHAR(255) NULL,
  FOREIGN KEY (ultimo_paso_id) REFERENCES cobranza_cadencias(id)
);
