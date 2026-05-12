-- ============================================================
-- BASE DE DATOS: cobranzas_guipak
-- Inicialización automática via Docker
-- ============================================================

USE cobranzas_guipak;

-- ------------------------------------------------------------
-- Usuarios del sistema (autenticación)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email               VARCHAR(200)    NOT NULL UNIQUE,
    nombre              VARCHAR(100)    NOT NULL,
    password_hash       VARCHAR(255)    NOT NULL,
    rol                 ENUM('ADMIN','SUPERVISOR','COBRADOR') NOT NULL DEFAULT 'COBRADOR',
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    ultimo_login        DATETIME,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Gestiones de cobranza
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_gestiones (
    id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ij_local                CHAR(3)         NOT NULL,
    ij_typedoc              CHAR(2)         NOT NULL DEFAULT 'IN',
    ij_inum                 DECIMAL(8,0)    NOT NULL,
    codigo_cliente          CHAR(12)        NOT NULL,
    total_factura           DECIMAL(15,2)   NOT NULL,
    saldo_pendiente         DECIMAL(15,2)   NOT NULL,
    moneda                  CHAR(3)         NOT NULL DEFAULT 'DOP',
    fecha_vencimiento       DATE            NOT NULL,
    dias_vencido            INT             NOT NULL,
    segmento_riesgo         ENUM('VERDE','AMARILLO','NARANJA','ROJO') NOT NULL,
    canal                   ENUM('WHATSAPP','EMAIL','AMBOS')  NOT NULL,
    mensaje_propuesto_wa    TEXT,
    mensaje_propuesto_email TEXT,
    asunto_email            VARCHAR(200),
    estado                  ENUM('PENDIENTE','APROBADO','EDITADO','DESCARTADO','ESCALADO','ENVIADO','FALLIDO')
                            NOT NULL DEFAULT 'PENDIENTE',
    aprobado_por            VARCHAR(50),
    fecha_aprobacion        DATETIME,
    mensaje_final_wa        TEXT,
    mensaje_final_email     TEXT,
    motivo_descarte         TEXT,
    fecha_envio             DATETIME,
    whatsapp_message_id     VARCHAR(100),
    email_message_id        VARCHAR(200),
    ultima_consulta_softec  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tiene_pdf               TINYINT(1)      NOT NULL DEFAULT 0,
    url_pdf                 TEXT,
    creado_por              VARCHAR(50)     NOT NULL,
    created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cliente       (codigo_cliente),
    INDEX idx_factura       (ij_inum),
    INDEX idx_estado        (estado),
    INDEX idx_fecha         (created_at)
);

-- ------------------------------------------------------------
-- Conversaciones (mensajes enviados y recibidos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_conversaciones (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    gestion_id          BIGINT UNSIGNED,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0),
    canal               ENUM('WHATSAPP','EMAIL') NOT NULL,
    direccion           ENUM('ENVIADO','RECIBIDO') NOT NULL,
    contenido           TEXT            NOT NULL,
    asunto              VARCHAR(200),
    whatsapp_from       VARCHAR(20),
    whatsapp_message_id VARCHAR(100),
    email_from          VARCHAR(200),
    email_to            VARCHAR(200),
    email_message_id    VARCHAR(200),
    estado              ENUM('ENVIADO','ENTREGADO','LEIDO','RESPONDIDO','FALLIDO') DEFAULT 'ENVIADO',
    generado_por_ia     TINYINT(1)      NOT NULL DEFAULT 0,
    aprobado_por        VARCHAR(50),
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gestion_id) REFERENCES cobranza_gestiones(id) ON DELETE SET NULL,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_canal     (canal),
    INDEX idx_fecha     (created_at)
);

-- ------------------------------------------------------------
-- Acuerdos de pago
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_acuerdos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    conversacion_id     BIGINT UNSIGNED,
    monto_prometido     DECIMAL(15,2)   NOT NULL,
    moneda              CHAR(3)         NOT NULL DEFAULT 'DOP',
    fecha_prometida     DATE            NOT NULL,
    descripcion         TEXT,
    estado              ENUM('PENDIENTE','CUMPLIDO','INCUMPLIDO','CANCELADO') DEFAULT 'PENDIENTE',
    fecha_pago_real     DATE,
    monto_pagado_real   DECIMAL(15,2),
    capturado_por_ia    TINYINT(1)      NOT NULL DEFAULT 0,
    registrado_por      VARCHAR(50)     NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_fecha     (fecha_prometida),
    INDEX idx_estado    (estado)
);

-- ------------------------------------------------------------
-- Disputas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_disputas (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    motivo              TEXT            NOT NULL,
    monto_disputado     DECIMAL(15,2),
    estado              ENUM('ABIERTA','EN_REVISION','RESUELTA','ANULADA') DEFAULT 'ABIERTA',
    resolucion          TEXT,
    resuelto_por        VARCHAR(50),
    fecha_resolucion    DATETIME,
    registrado_por      VARCHAR(50)     NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_factura   (ij_inum),
    INDEX idx_estado    (estado)
);

-- ------------------------------------------------------------
-- Conciliación bancaria
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_conciliacion (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha_extracto      DATE            NOT NULL,
    banco               VARCHAR(50)     NOT NULL,
    archivo_origen      VARCHAR(200),
    fecha_transaccion   DATE            NOT NULL,
    descripcion         TEXT,
    referencia          VARCHAR(100),
    cuenta_origen       VARCHAR(50),
    monto               DECIMAL(15,2)   NOT NULL,
    moneda              CHAR(3)         NOT NULL DEFAULT 'DOP',
    estado              ENUM('CONCILIADO','POR_APLICAR','DESCONOCIDO','CHEQUE_DEVUELTO') NOT NULL DEFAULT 'DESCONOCIDO',
    ir_recnum           DECIMAL(8,0),
    codigo_cliente      CHAR(12),
    aprobado_por        VARCHAR(50),
    fecha_aprobacion    DATETIME,
    notas               TEXT,
    cargado_por         VARCHAR(50)     NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_estado    (estado),
    INDEX idx_fecha     (fecha_transaccion),
    INDEX idx_cliente   (codigo_cliente)
);

-- ------------------------------------------------------------
-- Conciliación detalle: desglose multi-recibo (libramientos)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Aprendizaje: cuenta bancaria → cliente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_cuentas_aprendizaje (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cuenta_origen       VARCHAR(100)    NOT NULL UNIQUE,
    nombre_origen       VARCHAR(200),
    codigo_cliente      CHAR(12)        NOT NULL,
    nombre_cliente      VARCHAR(100),
    confianza           ENUM('MANUAL','AUTO') NOT NULL DEFAULT 'MANUAL',
    veces_usado         INT             NOT NULL DEFAULT 1,
    primera_deteccion   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultima_vez_visto    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmado_por      VARCHAR(50)     NOT NULL,
    INDEX idx_cuenta    (cuenta_origen),
    INDEX idx_cliente   (codigo_cliente)
);

-- ------------------------------------------------------------
-- Documentación: factura → PDF en Google Drive
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_facturas_documentos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ij_local            CHAR(3)         NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    codigo_cliente      CHAR(12)        NOT NULL,
    google_drive_id     VARCHAR(200)    NOT NULL,
    url_pdf             TEXT            NOT NULL,
    nombre_archivo      VARCHAR(200),
    fecha_escaneo       DATETIME        NOT NULL,
    subido_por          VARCHAR(50),
    origen              ENUM('CRM_WEBHOOK','MANUAL') NOT NULL DEFAULT 'CRM_WEBHOOK',
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_factura (ij_local, ij_inum),
    INDEX idx_cliente   (codigo_cliente)
);

-- ------------------------------------------------------------
-- Portal de autogestión: tokens de acceso
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_portal_tokens (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    token               VARCHAR(100)    NOT NULL UNIQUE,
    fecha_expiracion    DATETIME        NOT NULL,
    activo              TINYINT(1)      NOT NULL DEFAULT 1,
    ultimo_acceso       DATETIME,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_token     (token)
);

-- ------------------------------------------------------------
-- Datos enriquecidos de clientes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_clientes_enriquecidos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL UNIQUE,
    email               VARCHAR(200),
    whatsapp            VARCHAR(20),
    whatsapp2           VARCHAR(20),
    contacto_cobros     VARCHAR(100),
    notas_cobros        TEXT,
    canal_preferido     ENUM('WHATSAPP','EMAIL','AMBOS') DEFAULT 'WHATSAPP',
    no_contactar        TINYINT(1)      NOT NULL DEFAULT 0,
    motivo_no_contactar TEXT,
    pausa_hasta         DATE,
    actualizado_por     VARCHAR(50),
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Logs de auditoría (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_logs (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id          VARCHAR(50),
    accion              VARCHAR(100)    NOT NULL,
    entidad             VARCHAR(50),
    entidad_id          VARCHAR(50),
    detalle             JSON,
    ip                  VARCHAR(45),
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_accion    (accion),
    INDEX idx_usuario   (usuario_id),
    INDEX idx_fecha     (created_at)
);

-- ------------------------------------------------------------
-- Segmentos log (historial de cambios de segmento)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cobranza_segmentos_log (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    segmento_anterior   ENUM('VERDE','AMARILLO','NARANJA','ROJO'),
    segmento_nuevo      ENUM('VERDE','AMARILLO','NARANJA','ROJO') NOT NULL,
    motivo              VARCHAR(200),
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_fecha     (created_at)
);

-- ------------------------------------------------------------
-- Seed: usuario admin por defecto
-- Password: Admin2026! (bcrypt hash)
-- ------------------------------------------------------------
INSERT INTO usuarios (email, nombre, password_hash, rol) VALUES
('admin@guipak.com', 'Administrador', '$2b$10$fSxSLwxTXSoE/8VxW227..IZS/uQpmzhiEn/6D/.3EdHK1qSg.x1u', 'ADMIN');
