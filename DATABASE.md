# DATABASE.md — Documentación de Base de Datos
> Sistema de Cobranzas Guipak
> Lee CLAUDE.md antes de este documento.

---

## Arquitectura de Datos

```
┌─────────────────────────────┐     ┌──────────────────────────────┐
│   Softec MySQL (GUIPAK)     │     │  Cobranzas MySQL (PROPIA)    │
│   ⚠️  SOLO LECTURA          │     │  ✅ Lectura y escritura       │
│                             │     │                              │
│  ijnl          (facturas)   │     │  cobranza_gestiones          │
│  ijnl_pay      (recibos)    │     │  cobranza_conversaciones     │
│  irjnl         (aplicac.)   │     │  cobranza_acuerdos           │
│  icust         (clientes)   │     │  cobranza_disputas           │
│  icontacts     (contactos)  │     │  cobranza_segmentos_log      │
│  cbmaster      (bancos)     │     │  cobranza_conciliacion       │
│  cbtrans       (trans.)     │     │  cobranza_cuentas_aprendizaje│
└─────────────────────────────┘     │  cobranza_aplicac_pendientes │
                                    │  cobranza_facturas_docs      │
                                    │  cobranza_portal_tokens      │
                                    │  cobranza_clientes_enriq     │
                                    │  cobranza_logs               │
                                    └──────────────────────────────┘
```

---

## PARTE 1 — Tablas de Softec (SOLO LECTURA)

### Tabla `ijnl` — Facturas

**Propósito:** Diario de ventas. Contiene todas las facturas emitidas.

**Campos clave para cobranzas:**

| Campo | Tipo | Descripción |
|---|---|---|
| `IJ_LOCAL` | char(3) | Localidad — parte de PK |
| `IJ_SINORIN` | char(2) | Tipo origen — parte de PK |
| `IJ_INUM` | decimal(8,0) | Número interno — parte de PK |
| `IJ_TYPEDOC` | char(2) | **`'IN'`** = factura (único valor en Guipak) |
| `IJ_INVTORF` | char(1) | **`'T'`**=factura, `'V'`=cancelada, `'C'`=nota crédito |
| `IJ_DATE` | date | Fecha de emisión |
| `IJ_DUEDATE` | date | **Fecha de vencimiento** |
| `IJ_CCODE` | char(12) | **Código del cliente** — FK a `icust.IC_CODE` |
| `IJ_OTHNAME` | char(40) | Nombre del cliente (copia al momento de facturar) |
| `IJ_RNC_ID` | char(11) | RNC del cliente |
| `IJ_TAXSUB` | decimal(15,2) | Subtotal gravable |
| `IJ_TAX` | decimal(15,2) | ITBIS |
| `IJ_TOT` | decimal(15,2) | **Total de la factura** |
| `IJ_DTOT` | decimal(15,2) | Total en DOP (moneda local) |
| `IJ_TOTAPPL` | decimal(15,2) | **Total pagado/aplicado acumulado** |
| `IJ_DTOTAPP` | decimal(15,2) | Total aplicado en DOP |
| `IJ_PAID` | char(1) | **`'F'`**=pendiente, `'T'`=pagada — Softec lo mantiene |
| `IJ_STATUS` | char(1) | `'A'`=aplicada parcialmente, vacío=normal |
| `IJ_CURRENC` | char(3) | Moneda (`DOP`, `USD`) |
| `IJ_EXCHRAT` | decimal(12,6) | Tasa de cambio al momento de facturar |
| `IJ_NET` | decimal(3,0) | Días de crédito (ej: 30) |
| `IJ_TERMS` | char(50) | Términos de pago en texto |
| `IJ_SLSCODE` | char(4) | Código del vendedor |
| `IJ_NCFFIX` | char(11) | Prefijo del NCF fiscal |
| `IJ_NCFNUM` | decimal(10,0) | Número del NCF |

**Filtros obligatorios en TODO query sobre esta tabla:**
```sql
WHERE IJ_TYPEDOC = 'IN'       -- solo facturas Guipak
AND   IJ_INVTORF = 'T'        -- excluye canceladas y NC
AND   IJ_PAID    = 'F'        -- solo pendientes
AND   (IJ_TOT - IJ_TOTAPPL) > 0  -- con saldo real
```

---

### Tabla `ijnl_pay` — Recibos de Pago

**Propósito:** Registra cada recibo de caja (pago recibido).

| Campo | Tipo | Descripción |
|---|---|---|
| `IJ_LOCAL` | char(3) | Localidad — PK |
| `IJ_SINORIN` | char(2) | Tipo — PK |
| `IJ_RECNUM` | decimal(8,0) | **Número de recibo — PK** |
| `IJ_TYPEDOC` | char(2) | `'RC'` = Recibo de Caja |
| `IJ_DATE` | date | Fecha del recibo |
| `IJ_CCODE` | char(12) | Código del cliente |
| `IJ_TOT` | decimal(15,2) | Total del recibo |
| `IJ_TOTAPPL` | decimal(15,2) | Monto aplicado a facturas |
| `IJ_PAID` | char(1) | Si el recibo fue totalmente aplicado |
| `IJ_DESCR` | char(65) | **Referencia/descripción del pago** |
| `IJ_INLOCAL` | char(3) | Referencia doc interno |
| `IJ_INSINOR` | char(3) | Tipo doc interno |
| `IJ_ININUM` | decimal(8,0) | Número doc interno |

---

### Tabla `irjnl` — Aplicaciones (Relación Factura ↔ Pago)

**Propósito:** Tabla puente que relaciona cada pago con las facturas a las que se aplicó.

| Campo | Tipo | Descripción |
|---|---|---|
| `IR_CCODE` | char(12) | Código del cliente |
| `IR_LOCAL` | char(3) | Localidad |
| `IR_FLOCAL` | char(3) | Localidad de la **factura** |
| `IR_FTYPDOC` | char(2) | Tipo doc de la **factura** (`'IN'`) |
| `IR_FINUM` | decimal(8,0) | **Número interno de la factura** ← FK a `ijnl.IJ_INUM` |
| `IR_PLOCAL` | char(3) | Localidad del **pago** |
| `IR_PAYDOC` | char(2) | Tipo doc del **pago** (`'RC'`) |
| `IR_RECNUM` | decimal(8,0) | **Número del recibo** ← FK a `ijnl_pay.IJ_RECNUM` |
| `IR_PDATE` | date | **Fecha en que se aplicó el pago** |
| `IR_AMTPAID` | decimal(15,2) | **Monto aplicado en moneda original** |
| `IR_DAMTPAI` | decimal(15,2) | Monto aplicado en DOP |
| `IR_CLOSED` | char(1) | Si la aplicación está cerrada |

**JOIN estándar factura ↔ pagos:**
```sql
LEFT JOIN irjnl r
    ON  r.IR_FLOCAL   = f.IJ_LOCAL
    AND r.IR_FTYPDOC  = f.IJ_TYPEDOC
    AND r.IR_FINUM    = f.IJ_INUM
    AND r.IR_CCODE    = f.IJ_CCODE
```

---

### Tabla `icust` — Maestro de Clientes

**Propósito:** Información maestra de cada cliente.

| Campo | Tipo | Descripción |
|---|---|---|
| `IC_CODE` | char(12) | **PK — código del cliente** |
| `IC_NAME` | char(50) | **Nombre comercial** |
| `IC_RAZON` | char(60) | Razón social |
| `IC_RNC` | char(9) | RNC fiscal |
| `IC_EMAIL` | char(70) | **Email principal** (frecuentemente vacío) |
| `IC_PHONE` | char(20) | **Teléfono principal** → WhatsApp |
| `IC_PHONE2` | char(20) | Teléfono 2 |
| `IC_PHONE3` | char(20) | Teléfono 3 |
| `IC_PHONE4` | char(20) | Teléfono 4 |
| `IC_CONTACT` | char(35) | Nombre del contacto general |
| `IC_ARCONTC` | char(35) | **Contacto de cuentas por cobrar** ← usar para cobranzas |
| `IC_STATUS` | char(1) | `'A'`=activo, otros=inactivo |
| `IC_CRDLMT` | decimal(15,2) | Límite de crédito |
| `IC_BALANCE` | decimal(15,2) | Balance acumulado |
| `IC_NET` | decimal(3,0) | Días de crédito del cliente |
| `IC_SLSCODE` | char(4) | Vendedor asignado |
| `IC_SOCMED1-9` | char(40) | Redes sociales (posible WhatsApp Business) |

**JOIN estándar con facturas:**
```sql
INNER JOIN icust c ON c.IC_CODE = f.IJ_CCODE
-- Agregar: AND c.IC_STATUS = 'A'  para solo clientes activos
```

---

### Tabla `icontacts` — Contactos Adicionales por Cliente

**Propósito:** Múltiples contactos por cliente (para empresas con varios interlocutores).

| Campo | Tipo | Descripción |
|---|---|---|
| `IC_CODE` | char(12) | FK a `icust.IC_CODE` |
| `ID` | int | ID del contacto |
| `NAME` | char(45) | Nombre del contacto |
| `TITLE` | char(45) | Cargo |
| `DEPT` | char(45) | Departamento |
| `EMAIL` | char(45) | **Email del contacto** |
| `MOBILE` | char(16) | **Móvil del contacto** → WhatsApp |
| `PHONE1` | char(16) | Teléfono fijo |
| `STATUS` | char(1) | `'A'`=activo |

---

## PARTE 2 — Tablas Propias del Sistema (cobranzas_guipak)

### DDL Completo

```sql
-- ============================================================
-- BASE DE DATOS: cobranzas_guipak
-- ============================================================

CREATE DATABASE IF NOT EXISTS cobranzas_guipak
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE cobranzas_guipak;

-- ------------------------------------------------------------
-- Gestiones de cobranza
-- ------------------------------------------------------------
CREATE TABLE cobranza_gestiones (
    id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    -- Referencia a Softec (no FK real, DB separada)
    ij_local                CHAR(3)         NOT NULL,
    ij_typedoc              CHAR(2)         NOT NULL DEFAULT 'IN',
    ij_inum                 DECIMAL(8,0)    NOT NULL,
    codigo_cliente          CHAR(12)        NOT NULL,
    -- Snapshot del saldo al momento de la gestión
    total_factura           DECIMAL(15,2)   NOT NULL,
    saldo_pendiente         DECIMAL(15,2)   NOT NULL,
    moneda                  CHAR(3)         NOT NULL DEFAULT 'DOP',
    fecha_vencimiento       DATE            NOT NULL,
    dias_vencido            INT             NOT NULL,
    segmento_riesgo         ENUM('VERDE','AMARILLO','NARANJA','ROJO') NOT NULL,
    -- Canal y mensaje
    canal                   ENUM('WHATSAPP','EMAIL','AMBOS')  NOT NULL,
    mensaje_propuesto_wa    TEXT,
    mensaje_propuesto_email TEXT,
    asunto_email            VARCHAR(200),
    -- Estado del flujo
    estado                  ENUM('PENDIENTE','APROBADO','EDITADO','DESCARTADO','ESCALADO','ENVIADO','FALLIDO')
                            NOT NULL DEFAULT 'PENDIENTE',
    -- Aprobación
    aprobado_por            VARCHAR(50),
    fecha_aprobacion        DATETIME,
    mensaje_final_wa        TEXT,
    mensaje_final_email     TEXT,
    motivo_descarte         TEXT,
    -- Envío
    fecha_envio             DATETIME,
    whatsapp_message_id     VARCHAR(100),
    email_message_id        VARCHAR(200),
    -- Validación de saldo
    ultima_consulta_softec  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Factura documentada
    tiene_pdf               TINYINT(1)      NOT NULL DEFAULT 0,
    url_pdf                 TEXT,
    -- Auditoría
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
CREATE TABLE cobranza_conversaciones (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    gestion_id          BIGINT UNSIGNED,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0),
    canal               ENUM('WHATSAPP','EMAIL') NOT NULL,
    direccion           ENUM('ENVIADO','RECIBIDO') NOT NULL,
    -- Contenido
    contenido           TEXT            NOT NULL,
    asunto              VARCHAR(200),
    -- Metadata WhatsApp
    whatsapp_from       VARCHAR(20),
    whatsapp_message_id VARCHAR(100),
    -- Metadata Email
    email_from          VARCHAR(200),
    email_to            VARCHAR(200),
    email_message_id    VARCHAR(200),
    -- Estado
    estado              ENUM('ENVIADO','ENTREGADO','LEIDO','RESPONDIDO','FALLIDO') DEFAULT 'ENVIADO',
    -- IA
    generado_por_ia     TINYINT(1)      NOT NULL DEFAULT 0,
    aprobado_por        VARCHAR(50),
    -- Auditoría
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (gestion_id) REFERENCES cobranza_gestiones(id) ON DELETE SET NULL,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_canal     (canal),
    INDEX idx_fecha     (created_at)
);

-- ------------------------------------------------------------
-- Acuerdos de pago (promesas capturadas por IA o manualmente)
-- ------------------------------------------------------------
CREATE TABLE cobranza_acuerdos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    conversacion_id     BIGINT UNSIGNED,
    -- Detalles del acuerdo
    monto_prometido     DECIMAL(15,2)   NOT NULL,
    moneda              CHAR(3)         NOT NULL DEFAULT 'DOP',
    fecha_prometida     DATE            NOT NULL,
    descripcion         TEXT,
    -- Seguimiento
    estado              ENUM('PENDIENTE','CUMPLIDO','INCUMPLIDO','CANCELADO') DEFAULT 'PENDIENTE',
    fecha_pago_real     DATE,
    monto_pagado_real   DECIMAL(15,2),
    -- Origen
    capturado_por_ia    TINYINT(1)      NOT NULL DEFAULT 0,
    registrado_por      VARCHAR(50)     NOT NULL,
    -- Auditoría
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cliente   (codigo_cliente),
    INDEX idx_fecha     (fecha_prometida),
    INDEX idx_estado    (estado)
);

-- ------------------------------------------------------------
-- Disputas
-- ------------------------------------------------------------
CREATE TABLE cobranza_disputas (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    -- Disputa
    motivo              TEXT            NOT NULL,
    monto_disputado     DECIMAL(15,2),
    estado              ENUM('ABIERTA','EN_REVISION','RESUELTA','ANULADA') DEFAULT 'ABIERTA',
    -- Resolución
    resolucion          TEXT,
    resuelto_por        VARCHAR(50),
    fecha_resolucion    DATETIME,
    -- Auditoría
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
CREATE TABLE cobranza_conciliacion (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    -- Extracto
    fecha_extracto      DATE            NOT NULL,
    banco               VARCHAR(50)     NOT NULL,
    archivo_origen      VARCHAR(200),
    -- Línea del extracto
    fecha_transaccion   DATE            NOT NULL,
    descripcion         TEXT,
    referencia          VARCHAR(100),
    cuenta_origen       VARCHAR(50),
    monto               DECIMAL(15,2)   NOT NULL,
    moneda              CHAR(3)         NOT NULL DEFAULT 'DOP',
    -- Clasificación
    estado              ENUM('CONCILIADO','POR_APLICAR','DESCONOCIDO') NOT NULL DEFAULT 'DESCONOCIDO',
    -- Match con Softec
    ir_recnum           DECIMAL(8,0),           -- número recibo en Softec si conciliado
    codigo_cliente      CHAR(12),
    -- Aprobación
    aprobado_por        VARCHAR(50),
    fecha_aprobacion    DATETIME,
    notas               TEXT,
    -- Auditoría
    cargado_por         VARCHAR(50)     NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_estado    (estado),
    INDEX idx_fecha     (fecha_transaccion),
    INDEX idx_cliente   (codigo_cliente)
);

-- ------------------------------------------------------------
-- Aprendizaje: cuenta bancaria → cliente
-- ------------------------------------------------------------
CREATE TABLE cobranza_cuentas_aprendizaje (
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
CREATE TABLE cobranza_facturas_documentos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ij_local            CHAR(3)         NOT NULL,
    ij_inum             DECIMAL(8,0)    NOT NULL,
    codigo_cliente      CHAR(12)        NOT NULL,
    -- Google Drive
    google_drive_id     VARCHAR(200)    NOT NULL,
    url_pdf             TEXT            NOT NULL,
    nombre_archivo      VARCHAR(200),
    -- Metadata
    fecha_escaneo       DATETIME        NOT NULL,
    subido_por          VARCHAR(50),
    origen              ENUM('CRM_WEBHOOK','MANUAL') NOT NULL DEFAULT 'CRM_WEBHOOK',
    -- Auditoría
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_factura (ij_local, ij_inum),
    INDEX idx_cliente   (codigo_cliente)
);

-- ------------------------------------------------------------
-- Portal de autogestión: tokens de acceso
-- ------------------------------------------------------------
CREATE TABLE cobranza_portal_tokens (
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
-- Datos enriquecidos de clientes (complemento a Softec)
-- ------------------------------------------------------------
CREATE TABLE cobranza_clientes_enriquecidos (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo_cliente      CHAR(12)        NOT NULL UNIQUE,
    -- Datos adicionales o corregidos
    email               VARCHAR(200),
    whatsapp            VARCHAR(20),
    whatsapp2           VARCHAR(20),
    contacto_cobros     VARCHAR(100),
    notas_cobros        TEXT,
    -- Preferencia de canal
    canal_preferido     ENUM('WHATSAPP','EMAIL','AMBOS') DEFAULT 'WHATSAPP',
    -- Control
    no_contactar        TINYINT(1)      NOT NULL DEFAULT 0,
    motivo_no_contactar TEXT,
    pausa_hasta         DATE,
    -- Auditoría
    actualizado_por     VARCHAR(50),
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------
-- Logs de auditoría (append-only)
-- ------------------------------------------------------------
CREATE TABLE cobranza_logs (
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
```

---

## PARTE 3 — Queries Principales

### Query Cartera Vencida (v1.1 — FINAL)

```sql
SELECT
    c.IC_CODE                                           AS codigo_cliente,
    c.IC_NAME                                           AS nombre_cliente,
    c.IC_RAZON                                          AS razon_social,
    c.IC_RNC                                            AS rnc,
    c.IC_EMAIL                                          AS email,
    c.IC_PHONE                                          AS telefono,
    c.IC_PHONE2                                         AS telefono2,
    c.IC_CONTACT                                        AS contacto_general,
    c.IC_ARCONTC                                        AS contacto_cobros,
    c.IC_CRDLMT                                         AS limite_credito,
    f.IJ_LOCAL                                          AS localidad,
    f.IJ_TYPEDOC                                        AS tipo_doc,
    f.IJ_INUM                                           AS numero_interno,
    CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0'))    AS ncf_fiscal,
    f.IJ_DATE                                           AS fecha_emision,
    f.IJ_DUEDATE                                        AS fecha_vencimiento,
    DATEDIFF(CURDATE(), f.IJ_DUEDATE)                   AS dias_vencido,
    f.IJ_TAXSUB                                         AS subtotal_gravable,
    f.IJ_TAX                                            AS itbis,
    f.IJ_TOT                                            AS total_factura,
    f.IJ_TOTAPPL                                        AS total_pagado,
    (f.IJ_TOT - f.IJ_TOTAPPL)                          AS saldo_pendiente,
    f.IJ_DTOT                                           AS total_factura_dop,
    f.IJ_DTOTAPP                                        AS total_pagado_dop,
    (f.IJ_DTOT - f.IJ_DTOTAPP)                         AS saldo_pendiente_dop,
    f.IJ_CURRENC                                        AS moneda,
    f.IJ_EXCHRAT                                        AS tasa_cambio,
    f.IJ_TERMS                                          AS terminos_pago,
    f.IJ_NET                                            AS dias_credito,
    f.IJ_SLSCODE                                        AS vendedor,
    MAX(r.IR_PDATE)                                     AS fecha_ultimo_pago,
    CASE
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN 'AMARILLO'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30              THEN 'ROJO'
        ELSE 'VERDE'
    END                                                 AS segmento_riesgo
FROM ijnl f
INNER JOIN icust c
    ON  c.IC_CODE   = f.IJ_CCODE
    AND c.IC_STATUS = 'A'
LEFT JOIN irjnl r
    ON  r.IR_FLOCAL  = f.IJ_LOCAL
    AND r.IR_FTYPDOC = f.IJ_TYPEDOC
    AND r.IR_FINUM   = f.IJ_INUM
    AND r.IR_CCODE   = f.IJ_CCODE
-- EXCLUIR facturas en disputa activa
LEFT JOIN cobranza_disputas d   -- ⚠️ esta tabla está en otra DB
    ON  d.ij_inum   = f.IJ_INUM
    AND d.estado    IN ('ABIERTA', 'EN_REVISION')
WHERE
    f.IJ_TYPEDOC    = 'IN'
    AND f.IJ_INVTORF = 'T'
    AND f.IJ_PAID    = 'F'
    AND f.IJ_DUEDATE < CURDATE()
    AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    AND d.id IS NULL                -- sin disputa activa
GROUP BY
    c.IC_CODE, c.IC_NAME, c.IC_RAZON, c.IC_RNC,
    c.IC_EMAIL, c.IC_PHONE, c.IC_PHONE2,
    c.IC_CONTACT, c.IC_ARCONTC, c.IC_CRDLMT,
    f.IJ_LOCAL, f.IJ_TYPEDOC, f.IJ_INUM,
    f.IJ_NCFFIX, f.IJ_NCFNUM,
    f.IJ_DATE, f.IJ_DUEDATE,
    f.IJ_TAXSUB, f.IJ_TAX,
    f.IJ_TOT, f.IJ_TOTAPPL,
    f.IJ_DTOT, f.IJ_DTOTAPP,
    f.IJ_CURRENC, f.IJ_EXCHRAT,
    f.IJ_TERMS, f.IJ_NET, f.IJ_SLSCODE
ORDER BY dias_vencido DESC, c.IC_CODE ASC;
```

> **Nota implementación:** El JOIN con `cobranza_disputas` requiere federated tables o ejecutar en dos pasos (query Softec + filtrar con IDs de disputas activas desde la DB propia).

---

### Query Estado de Cuenta por Cliente

```sql
SELECT
    r.IR_PDATE          AS fecha_pago,
    r.IR_PAYDOC         AS tipo_recibo,
    r.IR_RECNUM         AS numero_recibo,
    r.IR_FTYPDOC        AS tipo_factura,
    r.IR_FINUM          AS numero_factura,
    r.IR_AMTPAID        AS monto_aplicado,
    r.IR_DAMTPAI        AS monto_aplicado_dop,
    p.IJ_DATE           AS fecha_recibo,
    p.IJ_TOT            AS total_recibo,
    p.IJ_DESCR          AS referencia_pago
FROM irjnl r
LEFT JOIN ijnl_pay p
    ON  p.IJ_LOCAL  = r.IR_PLOCAL
    AND p.IJ_RECNUM = r.IR_RECNUM
WHERE
    r.IR_CCODE   = :codigo_cliente
    AND r.IR_FINUM = :ij_inum
ORDER BY r.IR_PDATE ASC;
```

---

### Query Resumen por Segmento (para Dashboard)

```sql
SELECT
    CASE
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN 'AMARILLO'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30              THEN 'ROJO'
        ELSE 'VERDE'
    END                             AS segmento,
    COUNT(*)                        AS num_facturas,
    COUNT(DISTINCT f.IJ_CCODE)      AS num_clientes,
    SUM(f.IJ_TOT - f.IJ_TOTAPPL)   AS saldo_total
FROM ijnl f
WHERE
    f.IJ_TYPEDOC  = 'IN'
    AND f.IJ_INVTORF = 'T'
    AND f.IJ_PAID    = 'F'
    AND f.IJ_DUEDATE < CURDATE()
    AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
GROUP BY segmento
ORDER BY FIELD(segmento, 'ROJO', 'NARANJA', 'AMARILLO', 'VERDE');
```

> **Atención CP-15:** `saldo_total` arriba es **bruto** y no es el monto cobrable real. Para reportar a un humano usar el ajuste por saldo a favor del cliente — ver PARTE 4 abajo.

---

## PARTE 4 — Cómo calcular saldos correctamente

> Esta sección consolida la lógica de saldos validada contra producción
> (10-may-2026) y referencia los puntos críticos relevantes. Si vas a
> escribir un endpoint o reporte que muestre saldos a un humano, lee
> todo antes de teclear.

### 4.1 Saldo de una FACTURA

**Fórmula:**

```
saldo_factura = IJ_TOT - IJ_TOTAPPL
```

**Filtros obligatorios (CP-04):**

```sql
WHERE IJ_TYPEDOC = 'IN'
  AND IJ_INVTORF = 'T'
  AND IJ_PAID    = 'F'
  AND (IJ_TOT - IJ_TOTAPPL) > 0
```

**Sigue válido para:**
- Filas individuales en la tabla de cartera (saldo de esa factura).
- DSO y métricas contables estándar (que requieren bruto por convención).
- Snapshot inmutable guardado en `cobranza_gestiones.saldo_pendiente`.

**No usar para:**
- Agregar a nivel cliente (puede haber recibos sin aplicar — ver 4.2).
- Mostrar "saldo total del cliente" al usuario sin ajuste.

### 4.2 Saldo del CLIENTE

> **Punto crítico:** un cliente puede tener recibos en `ijnl_pay` cuyo
> monto NO se aplicó (parcial o totalmente) a sus facturas. Ese remanente
> es **saldo a favor** y debe descontarse del pendiente bruto cuando se
> reporta el saldo del cliente.

**Fórmula consolidada (CP-15):**

```
pendiente_bruto       = SUM(IJ_TOT - IJ_TOTAPPL) por cliente
saldo_a_favor         = SUM(IJ_TOT_recibo - SUM(IR_AMTPAID)) por cliente, solo recibos con sin_aplicar > 0.01
saldo_a_favor_aplicable = MIN(pendiente_bruto, saldo_a_favor)
saldo_neto            = MAX(0, pendiente_bruto - saldo_a_favor)
cubierto_por_anticipo = saldo_a_favor >= pendiente_bruto AND pendiente_bruto > 0
```

**Query del saldo a favor (CP-13 + CP-14):**

```sql
SELECT
  codigo_cliente,
  SUM(sin_aplicar) AS saldo_a_favor
FROM (
  SELECT
    pay.IJ_CCODE                            AS codigo_cliente,
    (pay.IJ_TOT - IFNULL(ap.aplicado, 0))   AS sin_aplicar
  FROM v_cobr_ijnl_pay pay
  LEFT JOIN (
    SELECT
      r.IR_PLOCAL,
      r.IR_PTYPDOC,
      r.IR_RECNUM,
      SUM(r.IR_AMTPAID) AS aplicado
    FROM v_cobr_irjnl r
    GROUP BY r.IR_PLOCAL, r.IR_PTYPDOC, r.IR_RECNUM
  ) ap
    ON  ap.IR_PLOCAL  = pay.IJ_LOCAL
    AND ap.IR_PTYPDOC = pay.IJ_SINORIN
    AND ap.IR_RECNUM  = pay.IJ_RECNUM
  WHERE pay.IJ_CCODE IS NOT NULL
) recibos
WHERE sin_aplicar > 0.01     -- filtrar antes de agregar por cliente
GROUP BY codigo_cliente
HAVING saldo_a_favor > 0.01;
```

**Tres notas críticas del JOIN:**

1. **CP-13**: el JOIN se hace por `IR_PLOCAL / IR_PTYPDOC / IR_RECNUM` (que apuntan al recibo). **No** usar `IR_F*` (factura) — en Guipak vienen vacías a nivel de pago.
2. **CP-14**: no usar `IJ_ONLPAID` ni desglosados de `ijnl_pay`. Suma siempre `IR_AMTPAID` agregado de `irjnl`.
3. Filtrar `sin_aplicar > 0.01` ANTES de agrupar por cliente — un recibo sobre-aplicado (raro, viene de ajustes contables) no debe restar del saldo a favor del cliente.

**Tabla "Usar / No usar":**

| Necesitas... | Usa | NO uses |
|---|---|---|
| Saldo de UNA factura para mostrarlo en su fila | `IJ_TOT - IJ_TOTAPPL` | — |
| Saldo TOTAL de un cliente para presentar al usuario | `obtenerSaldoAFavorPorCliente()` + `ajustarSaldoCliente()` | `SUM(IJ_TOT - IJ_TOTAPPL)` solo |
| Decidir si un cliente debe recibir cobranza | `ajuste.cubierto_por_anticipo === false` | comparar saldo bruto contra 0 |
| Cartera total agregada (dashboard, reporte global) | bruto + a favor + neto (mostrar los tres) | solo bruto |
| Cuántos pagos aplicó un recibo | `SUM(IR_AMTPAID)` con JOIN por `IR_PLOCAL/IR_PTYPDOC/IR_RECNUM` (CP-13) | `IJ_ONLPAID` (CP-14) ni `IR_F*` |
| DSO o métricas contables externas | bruto (estándar de la disciplina) | neto |

**Helper canónico:** `lib/cobranzas/saldo-favor.ts`

```typescript
// 1) Pedir el mapa de saldo a favor (un solo query agregado)
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';

const saldosFavor = await obtenerSaldoAFavorPorCliente([codigo]);
const favor = saldosFavor.get(codigo) ?? 0;

// 2) Ajustar contra el pendiente bruto que ya tienes
const ajuste = ajustarSaldoCliente(saldoBruto, favor);

// ajuste === {
//   saldo_pendiente: <bruto>,
//   saldo_a_favor:   <favor>,
//   saldo_neto:      <max(0, bruto - favor)>,
//   cubierto_por_anticipo: <favor >= bruto && bruto > 0>
// }
```

**Decisiones de producto (10-may-2026):**

- Los clientes con `cubierto_por_anticipo === true` quedan **excluidos** de la cola de cobranza (opción B del CP-15). Sus facturas siguen visibles en cartera, marcadas con badge "Cubierta por anticipo".
- El bot bloquea la generación de drafts de correo cuando el cliente está cubierto, con motivo `CLIENTE_CUBIERTO_POR_ANTICIPO`.
- El portal cliente muestra un Alert success con mensaje pre-formateado cuando el cliente está cubierto ("No tienes pagos pendientes...").

**Enlaces cruzados:**
- CP-13 (JOIN recibo↔aplicación) — `CRITICAL_POINTS.md`
- CP-14 (no `IJ_ONLPAID`) — `CRITICAL_POINTS.md`
- CP-15 (restar saldo a favor) — `CRITICAL_POINTS.md`
- Smoke tests: `scripts/test-saldo-favor.ts`, `scripts/test-saldo-favor-telegram.ts`

---

*Versión: 1.2 — 11 Mayo 2026*
