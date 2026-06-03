-- Migración 026: añade `origen_ref` a cobranza_supervisor_alertas.
--
-- Permite idempotencia POR ENTIDAD (no solo por cliente). El despertador #3
-- (promesa grande incumplida) necesita rastrear el acuerdo específico que alertó
-- (origen_ref = 'acuerdo:{id}') para no re-alertar la misma promesa y sí permitir
-- alertar promesas distintas del mismo cliente.
--
-- El #2 (top-10) puede poblarla con 'cliente:{codigo}' por consistencia, aunque
-- su cooldown sigue siendo por cliente+score.

ALTER TABLE cobranza_supervisor_alertas
  ADD COLUMN origen_ref VARCHAR(64) DEFAULT NULL AFTER tipo,
  ADD INDEX idx_tipo_ref (tipo, origen_ref);
