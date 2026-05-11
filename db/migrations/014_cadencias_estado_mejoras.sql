-- Fase 10: Mejoras al estado de cadencias (Capa D)
-- Ejecutar en cobranzas_guipak

-- Añade columna para rastrear el último día aplicado sin hacer JOIN a cadencias
ALTER TABLE cobranza_factura_cadencia_estado
  ADD COLUMN IF NOT EXISTS ultimo_dia_aplicado INT NULL
    COMMENT 'Copia del dia_desde_vencimiento del último paso aplicado para queries rápidos',
  ADD COLUMN IF NOT EXISTS omitir_pasos_previos TINYINT(1) DEFAULT 0
    COMMENT '1 = primer run hizo fast-forward; los pasos anteriores no generan gestion';
