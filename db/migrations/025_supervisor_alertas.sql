-- Migración 025: tabla de alertas del Supervisor Cobros (capa estratégica).
--
-- Contexto: el Supervisor (modelo de razonamiento — deepseek-r1:14b local vía
-- gateway IA) corre por EXCEPCIÓN, no en cada ciclo. Su primer despertador es
-- "top-10 cliente cruza umbral ROJO/CRÍTICO": tras el scoring nocturno, detecta
-- clientes de alta exposición (saldo neto) que escalaron de riesgo y genera una
-- alerta ejecutiva al Telegram privado del CEO.
--
-- Esta tabla es para AUDITORÍA y análisis posterior: qué alertó, con qué datos,
-- qué recomendó el modelo, cuánto costó/tardó, y si el CEO actuó.
--
-- El ENUM `tipo` ya contempla los demás despertadores del Supervisor (#3, #4, #5)
-- para no fragmentar con migraciones futuras.

CREATE TABLE IF NOT EXISTS cobranza_supervisor_alertas (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  tipo ENUM(
    'TOP10_CRUZA_UMBRAL',
    'PROMESA_GRANDE_INCUMPLIDA',
    'CAMBIO_HABITO_CLIENTE',
    'CASHFLOW_ROJO_7D'
  ) NOT NULL DEFAULT 'TOP10_CRUZA_UMBRAL',

  codigo_cliente VARCHAR(10) NOT NULL,
  nombre_cliente VARCHAR(255) NOT NULL DEFAULT '',

  -- Estado de riesgo que disparó la alerta
  risk_level    ENUM('VERDE','AMARILLO','ROJO','CRITICO') NOT NULL DEFAULT 'ROJO',
  score_anterior TINYINT UNSIGNED DEFAULT NULL,   -- score de la corrida previa
  score_nuevo    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  saldo_neto     DECIMAL(15,2) NOT NULL DEFAULT 0,

  -- Contenido
  descripcion   TEXT DEFAULT NULL,   -- contexto/datos que se le pasaron al modelo
  recomendacion TEXT DEFAULT NULL,   -- alerta en prosa generada por el modelo

  -- Auditoría del modelo
  modelo_response JSON DEFAULT NULL,  -- payload completo de la respuesta (debug/análisis)
  model_used      VARCHAR(80) DEFAULT NULL,
  latency_ms      INT UNSIGNED DEFAULT NULL,
  cost_usd        DECIMAL(8,5) NOT NULL DEFAULT 0,  -- 0 con modelo local; útil si migra a Anthropic

  -- Ciclo de vida
  telegram_message_id BIGINT DEFAULT NULL,
  notified_at DATETIME DEFAULT NULL,
  acted_at    DATETIME DEFAULT NULL,
  action_taken VARCHAR(255) DEFAULT NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_cliente_tipo (codigo_cliente, tipo),
  INDEX idx_created (created_at),
  INDEX idx_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
