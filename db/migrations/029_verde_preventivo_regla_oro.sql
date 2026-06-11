-- 029: VERDE preventivo + regla de oro en cadencias. Idempotente.

-- Regla de oro (CP-02): ninguna cadencia puede generar gestiones
-- auto-aprobadas. El seed original traia ('VERDE', 1, 'EMAIL', 0).
UPDATE cobranza_cadencias SET requiere_aprobacion = 1 WHERE requiere_aprobacion = 0;

-- Paso preventivo VERDE: recordatorio amistoso 3 dias ANTES del vencimiento
-- (dia_desde_vencimiento negativo = factura por vencer). Las plantillas
-- VERDE preventivas ya existen desde la migracion 012.
INSERT IGNORE INTO cobranza_cadencias
  (segmento, dia_desde_vencimiento, accion, requiere_aprobacion)
VALUES
  ('VERDE', -3, 'EMAIL', 1);
