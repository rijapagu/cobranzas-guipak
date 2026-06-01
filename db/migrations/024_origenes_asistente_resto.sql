-- Migración 024: añadir los 3 origenes restantes del Asistente Cobros
--
-- Tareas del Asistente acordadas con Ricardo 2026-06-01 que aun no tienen
-- origen propio en cobranza_tareas:
--
--   DATO_FALTANTE      (tarea #9)  — cliente vencido sin email/WhatsApp
--   RESPUESTA_CLIENTE  (tarea #5)  — entrante de cliente esperando respuesta
--   SIN_RESPUESTA      (tarea #11) — correo enviado hace N dias sin retorno
--
-- Idempotente: ALTER MODIFY ENUM con sólo añadir valores es seguro — no
-- afecta datos existentes con valores anteriores.

ALTER TABLE cobranza_tareas
  MODIFY COLUMN origen ENUM(
    'MANUAL',
    'ACUERDO_PAGO',
    'CADENCIA',
    'SALDO_FAVOR',
    'DATO_FALTANTE',
    'RESPUESTA_CLIENTE',
    'SIN_RESPUESTA'
  ) NOT NULL DEFAULT 'MANUAL';
