-- 019: Ampliar ENUMs de cobranza_tareas para seguimiento de conciliación
-- Tipo CHEQUE_DEVUELTO: seguimiento de cheques devueltos hasta reposición
-- Origen CONCILIACION: tareas creadas automáticamente al cargar extracto bancario

ALTER TABLE cobranza_tareas
  MODIFY COLUMN tipo ENUM('LLAMAR','DEPOSITAR_CHEQUE','SEGUIMIENTO','DOCUMENTO','REUNION','CHEQUE_DEVUELTO','OTRO'),
  MODIFY COLUMN origen ENUM('MANUAL','ACUERDO_PAGO','CADENCIA','CONCILIACION');
