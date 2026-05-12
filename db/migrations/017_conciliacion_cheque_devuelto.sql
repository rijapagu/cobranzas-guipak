-- 017: Agregar estado CHEQUE_DEVUELTO a conciliación bancaria
-- Los cheques devueltos representan pagos que no se pudieron cobrar.
-- El supervisor debe desaplicar el pago correspondiente en Softec.

ALTER TABLE cobranza_conciliacion
  MODIFY COLUMN estado ENUM('CONCILIADO','POR_APLICAR','DESCONOCIDO','CHEQUE_DEVUELTO') NOT NULL DEFAULT 'DESCONOCIDO';
