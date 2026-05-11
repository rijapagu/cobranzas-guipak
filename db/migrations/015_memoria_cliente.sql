CREATE TABLE IF NOT EXISTS cobranza_memoria_cliente (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  codigo_cliente   VARCHAR(20) NOT NULL,
  patron_pago      VARCHAR(255) DEFAULT NULL,
  canal_efectivo   VARCHAR(50)  DEFAULT NULL,
  contacto_real    VARCHAR(255) DEFAULT NULL,
  mejor_momento    VARCHAR(255) DEFAULT NULL,
  notas_daria      TEXT         DEFAULT NULL,
  actualizado_por  VARCHAR(100) DEFAULT NULL,
  updated_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_codigo_cliente (codigo_cliente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
