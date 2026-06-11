-- 028: Estado transitorio ENVIANDO para reclamo atómico del envío.
-- Evita el doble envío: el sender hace UPDATE ... WHERE estado IN ('APROBADO','EDITADO')
-- y solo quien logra affectedRows=1 envía. Idempotente (MODIFY repetible).
ALTER TABLE cobranza_gestiones
  MODIFY COLUMN estado ENUM('PENDIENTE','APROBADO','EDITADO','DESCARTADO','ESCALADO','ENVIANDO','ENVIADO','FALLIDO')
  NOT NULL DEFAULT 'PENDIENTE';
