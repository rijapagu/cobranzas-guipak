-- 030: Fase 3 Etapa 0 — multi-tenancy retrocompatible.
-- Tabla de empresas (tenants) + empresa_id DEFAULT 1 en las tablas de negocio.
-- Guipak = empresa 1: ningun dato ni query existente cambia de comportamiento.
-- (Se ejecuta UNA vez via cobranza_migraciones — no necesita ser re-ejecutable.)

CREATE TABLE IF NOT EXISTS empresas (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(200) NOT NULL,
  slug         VARCHAR(60)  NOT NULL UNIQUE,
  rnc          VARCHAR(20)  NULL,
  activa       TINYINT(1)   NOT NULL DEFAULT 1,
  plan         ENUM('ESTANDAR','PREMIUM') NOT NULL DEFAULT 'ESTANDAR',
  -- Hibrido: COMPARTIDA usa la DB comun; DEDICADA (premium) usa su propia DB
  modo_datos   ENUM('COMPARTIDA','DEDICADA') NOT NULL DEFAULT 'COMPARTIDA',
  -- Credenciales de la DB dedicada (cifradas a nivel de aplicacion, Etapa 5)
  db_config    JSON NULL,
  -- Origen de la cartera: adaptador ERP o importacion por archivo
  erp_tipo     ENUM('SOFTEC','CSV','NINGUNO') NOT NULL DEFAULT 'CSV',
  -- Configuracion por empresa (branding, remitentes, prompts...; Etapa 3)
  config       JSON NULL,
  zona_horaria VARCHAR(50) NOT NULL DEFAULT 'America/Santo_Domingo',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO empresas (id, nombre, slug, activa, plan, modo_datos, erp_tipo)
VALUES (1, 'Suministros Guipak, S.R.L.', 'guipak', 1, 'PREMIUM', 'COMPARTIDA', 'SOFTEC');

-- empresa_id en todas las tablas de negocio (DEFAULT 1 = Guipak)
ALTER TABLE usuarios                         ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_gestiones               ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_conversaciones          ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_acuerdos                ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_disputas                ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_conciliacion            ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_conciliacion_detalle    ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_cuentas_aprendizaje     ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_clientes_enriquecidos   ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_contactos_cliente       ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_cliente_inteligencia    ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_memoria_cliente         ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_facturas_documentos     ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_portal_tokens           ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_plantillas_email        ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_cadencias               ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_factura_cadencia_estado ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_tareas                  ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_configuracion           ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_logs                    ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_segmentos_log           ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_supervisor_alertas      ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_telegram_usuarios       ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_telegram_historial      ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
ALTER TABLE cobranza_telegram_memoria_equipo ADD COLUMN empresa_id INT NOT NULL DEFAULT 1, ADD INDEX idx_empresa (empresa_id);
