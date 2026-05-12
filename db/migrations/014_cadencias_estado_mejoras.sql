-- Fase 10: Mejoras al estado de cadencias (Capa D)
-- Ejecutar en cobranzas_guipak
-- Nota: ADD COLUMN IF NOT EXISTS no soportado en MySQL < 8.0.3
-- Si da "Duplicate column name" las columnas ya existen — es seguro ignorarlo.

ALTER TABLE cobranza_factura_cadencia_estado
  ADD COLUMN ultimo_dia_aplicado INT NULL
    COMMENT 'Copia del dia_desde_vencimiento del último paso aplicado para queries rápidos',
  ADD COLUMN omitir_pasos_previos TINYINT(1) DEFAULT 0
    COMMENT '1 = primer run hizo fast-forward; los pasos anteriores no generan gestion';
