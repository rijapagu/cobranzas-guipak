-- 018: Tabla detalle para conciliaciones multi-recibo (libramientos)
-- Un registro bancario puede corresponder a múltiples recibos en Softec
-- (ej: libramiento gubernamental que paga a varios clientes en una transferencia)

CREATE TABLE IF NOT EXISTS cobranza_conciliacion_detalle (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conciliacion_id     BIGINT UNSIGNED NOT NULL,
    ir_recnum           DECIMAL(8,0)    NOT NULL,
    codigo_cliente      CHAR(12)        NOT NULL,
    nombre_cliente      VARCHAR(200),
    monto               DECIMAL(15,2)   NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conciliacion_id) REFERENCES cobranza_conciliacion(id) ON DELETE CASCADE,
    INDEX idx_conciliacion (conciliacion_id),
    INDEX idx_cliente      (codigo_cliente)
);
