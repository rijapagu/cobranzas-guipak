-- Migración 023: añadir 'SALDO_FAVOR' al ENUM origen de cobranza_tareas
--
-- Nuevo cron de aplicar-anticipos (Asistente Cobros tarea #8) genera tareas
-- semánticamente distintas a las existentes: el equipo debe APLICAR un anticipo
-- existente en Softec, no llamar/correo/seguimiento de cadencia/promesa.
--
-- ALTER MODIFY ENUM con sólo añadir valores es seguro — no afecta datos
-- existentes con valores anteriores. MySQL no rechaza filas existentes.
--
-- Idempotente: si la columna ya tiene 'SALDO_FAVOR' en el ENUM, el ALTER
-- redefine al mismo conjunto y no falla.

ALTER TABLE cobranza_tareas
  MODIFY COLUMN origen ENUM(
    'MANUAL',
    'ACUERDO_PAGO',
    'CADENCIA',
    'SALDO_FAVOR'
  ) NOT NULL DEFAULT 'MANUAL';
