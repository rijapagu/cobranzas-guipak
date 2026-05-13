-- Migration 021: tabla de inteligencia pre-computada por cliente
-- Populada cada noche por el job BullMQ "inteligencia-clientes" (1:00 AM AST)
-- Claude lee de aquí en lugar de calcular — es el cerebro analítico del supervisor

CREATE TABLE IF NOT EXISTS cobranza_cliente_inteligencia (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo_cliente   VARCHAR(10)  NOT NULL,
  nombre_cliente   VARCHAR(255) NOT NULL DEFAULT '',

  -- Scoring (0-100, mayor = peor riesgo)
  risk_score       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  risk_level       ENUM('VERDE','AMARILLO','ROJO','CRITICO') NOT NULL DEFAULT 'VERDE',

  -- Aging
  saldo_pendiente       DECIMAL(15,2) NOT NULL DEFAULT 0,
  saldo_neto            DECIMAL(15,2) NOT NULL DEFAULT 0,
  saldo_a_favor         DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_facturas        INT          NOT NULL DEFAULT 0,
  dias_mora_promedio    DECIMAL(6,1) NOT NULL DEFAULT 0,
  factura_mas_antigua_dias INT       NOT NULL DEFAULT 0,
  monto_bucket_0_15     DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'AMARILLO: 1-15 días',
  monto_bucket_16_30    DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'NARANJA: 16-30 días',
  monto_bucket_31_60    DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'ROJO: 31-60 días',
  monto_bucket_60_plus  DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT 'ROJO+: >60 días',

  -- Tendencia vs cálculo anterior
  tendencia            ENUM('MEJORANDO','ESTABLE','EMPEORANDO') NOT NULL DEFAULT 'ESTABLE',
  score_anterior       TINYINT UNSIGNED DEFAULT NULL,
  saldo_anterior       DECIMAL(15,2)    DEFAULT NULL,

  -- Cumplimiento de promesas de pago
  promesas_total              INT         NOT NULL DEFAULT 0,
  promesas_cumplidas          INT         NOT NULL DEFAULT 0,
  tasa_cumplimiento_promesas  DECIMAL(5,2) NOT NULL DEFAULT 100.00,

  -- Acciones recomendadas (generadas por reglas, no por Claude)
  accion_credito   ENUM('NORMAL','REDUCIR_LIMITE','AUTORIZAR_MANUAL','SUSPENDER')               NOT NULL DEFAULT 'NORMAL',
  accion_ventas    ENUM('NORMAL','SUBIR_MARGEN','REQUIERE_ABONO','NO_VENDER')                   NOT NULL DEFAULT 'NORMAL',
  accion_cobranza  ENUM('CADENCIA_NORMAL','SEGUIMIENTO_INTENSIVO','GESTION_DIRECTA','COBRO_LEGAL') NOT NULL DEFAULT 'CADENCIA_NORMAL',

  -- Síntesis para Claude
  razones  JSON    DEFAULT NULL COMMENT 'Array de strings explicando el score',
  resumen  TEXT    DEFAULT NULL COMMENT 'Párrafo de síntesis listo para inyectar en el prompt',

  -- Metadata
  calculado_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  calculado_por VARCHAR(50) NOT NULL DEFAULT 'sistema',

  UNIQUE KEY uq_codigo (codigo_cliente),
  INDEX idx_risk_level (risk_level),
  INDEX idx_score      (risk_score DESC),
  INDEX idx_calculado  (calculado_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
