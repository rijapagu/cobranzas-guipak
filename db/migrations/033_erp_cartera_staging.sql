-- 033: Fase 3 Etapa 2 — staging de cartera importada (adaptador CSV).
-- Empresas sin ERP en vivo suben su cartera (facturas pendientes + clientes)
-- y el csvAdapter (lib/erp/csv.ts) la sirve en el modelo canónico.
-- Cada importación REEMPLAZA el snapshot completo de la empresa.
-- Collation 0900_ai_ci a propósito: igual que las tablas originales del init,
-- para no repetir el "Illegal mix of collations" de las migraciones 010-022.

CREATE TABLE IF NOT EXISTS erp_cartera_clientes (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT           NOT NULL,
  codigo          VARCHAR(40)   NOT NULL,
  nombre          VARCHAR(200)  NOT NULL,
  rnc             VARCHAR(40)   NULL,
  email           VARCHAR(200)  NULL,
  telefono        VARCHAR(40)   NULL,
  telefono2       VARCHAR(40)   NULL,
  contacto_cobros VARCHAR(200)  NULL,
  vendedor        VARCHAR(100)  NULL,
  importado_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empresa_codigo (empresa_id, codigo),
  INDEX idx_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS erp_cartera_facturas (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  empresa_id        INT           NOT NULL,
  numero            BIGINT        NOT NULL,
  ncf               VARCHAR(40)   NULL,
  codigo_cliente    VARCHAR(40)   NOT NULL,
  total             DECIMAL(14,2) NOT NULL,
  saldo_pendiente   DECIMAL(14,2) NOT NULL,
  moneda            VARCHAR(10)   NOT NULL DEFAULT 'DOP',
  fecha_emision     DATE          NULL,
  fecha_vencimiento DATE          NOT NULL,
  importado_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empresa_numero (empresa_id, numero),
  INDEX idx_empresa (empresa_id),
  INDEX idx_empresa_cliente (empresa_id, codigo_cliente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- La empresa 2 de prueba pasa a modo CSV para validar el flujo completo.
UPDATE empresas SET erp_tipo = 'CSV' WHERE id = 2 AND erp_tipo = 'NINGUNO';
