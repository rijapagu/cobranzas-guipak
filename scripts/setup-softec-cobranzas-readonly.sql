-- =============================================================
-- VISTAS Y USUARIO READ-ONLY PARA APP DE COBRANZAS GUIPAK
-- Servidor Softec: 45.32.218.224 (Vultr, MySQL 5.7)
-- Base de datos: guipak
-- Cliente que conecta: VPS srv869155 (31.97.131.17, Dokploy)
-- Ejecutar en el servidor Softec como root o con CREATE VIEW + CREATE USER
-- =============================================================
-- Patrón: igual que el del Agente de Inventario.
--   1) Vistas v_cobr_* exponen SOLO las columnas que la app necesita
--      (proyecciones — no filtran filas para preservar flexibilidad).
--   2) Usuario cobranzas_ro@'31.97.131.17' con SELECT ÚNICAMENTE
--      sobre esas vistas. No tiene acceso a las tablas crudas.
--   3) Si filtra el password: solo sirve desde la IP del VPS.
-- =============================================================
-- IMPORTANTE: Cambiar el password antes de ejecutar.
-- =============================================================


-- -------------------------------------------------------------
-- 1. VISTA: ijnl (journal de facturas y recibos)
--    Usada en: cartera vencida, dashboard, gestiones, alertas,
--              generar-cola, reportes, portal, telegram tools,
--              estado de cuenta (lado pagos via ijnl_pay)
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_cobr_ijnl AS
SELECT
    IJ_LOCAL,
    IJ_TYPEDOC,
    IJ_INUM,
    IJ_CCODE,
    IJ_NCFFIX,
    IJ_NCFNUM,
    IJ_DATE,
    IJ_DUEDATE,
    IJ_TAXSUB,
    IJ_TAX,
    IJ_TOT,
    IJ_TOTAPPL,
    IJ_DTOT,
    IJ_DTOTAPP,
    IJ_CURRENC,
    IJ_EXCHRAT,
    IJ_TERMS,
    IJ_NET,
    IJ_SLSCODE,
    IJ_INVTORF,
    IJ_PAID
FROM ijnl;


-- -------------------------------------------------------------
-- 2. VISTA: icust (clientes)
--    Usada en: clientes, dashboard, gestiones, draft-correo,
--              cartera vencida (JOIN), portal
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_cobr_icust AS
SELECT
    IC_CODE,
    IC_NAME,
    IC_RAZON,
    IC_RNC,
    IC_EMAIL,
    IC_PHONE,
    IC_PHONE2,
    IC_CONTACT,
    IC_ARCONTC,
    IC_CRDLMT,
    IC_STATUS
FROM icust;


-- -------------------------------------------------------------
-- 3. VISTA: irjnl (recibos / pagos aplicados)
--    Usada en: estado de cuenta, conciliación bancaria,
--              cartera vencida (LEFT JOIN para fecha último pago)
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_cobr_irjnl AS
SELECT
    IR_PLOCAL,
    IR_RECNUM,
    IR_CCODE,
    IR_PDATE,
    IR_PAYDOC,
    IR_AMTPAID,
    IR_DAMTPAI,
    IR_FLOCAL,
    IR_FTYPDOC,
    IR_FINUM
FROM irjnl;


-- -------------------------------------------------------------
-- 4. VISTA: ijnl_pay (header de recibos de pago)
--    Usada en: estado de cuenta (LEFT JOIN con irjnl)
--    NOTA: ijnl_pay es la misma tabla ijnl filtrada a recibos —
--    si el ingeniero confirma que basta con la vista v_cobr_ijnl,
--    podemos eliminar esta. Por ahora mantenemos paridad con el
--    código actual para no romper.
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_cobr_ijnl_pay AS
SELECT
    IJ_LOCAL,
    IJ_RECNUM,
    IJ_DATE,
    IJ_TOT,
    IJ_DESCR
FROM ijnl_pay;


-- =============================================================
-- USUARIO READ-ONLY
-- =============================================================
-- Si ya existe el usuario, primero hacer DROP:
--   DROP USER 'cobranzas_ro'@'31.97.131.17';
-- Luego ejecutar:

CREATE USER 'cobranzas_ro'@'31.97.131.17'
    IDENTIFIED BY 'CAMBIAR_ESTE_PASSWORD_ANTES_DE_EJECUTAR';

-- Permisos: SOLO SELECT sobre las vistas. Nada sobre tablas crudas.
GRANT SELECT ON guipak.v_cobr_ijnl       TO 'cobranzas_ro'@'31.97.131.17';
GRANT SELECT ON guipak.v_cobr_icust      TO 'cobranzas_ro'@'31.97.131.17';
GRANT SELECT ON guipak.v_cobr_irjnl      TO 'cobranzas_ro'@'31.97.131.17';
GRANT SELECT ON guipak.v_cobr_ijnl_pay   TO 'cobranzas_ro'@'31.97.131.17';

FLUSH PRIVILEGES;


-- =============================================================
-- VERIFICACIÓN
-- =============================================================
-- 1) Las vistas existen:
--    SHOW FULL TABLES IN guipak WHERE TABLE_TYPE = 'VIEW' AND Tables_in_guipak LIKE 'v_cobr_%';
--
-- 2) El usuario existe y tiene los permisos correctos:
--    SHOW GRANTS FOR 'cobranzas_ro'@'31.97.131.17';
--    -- Debe mostrar SOLO los 4 GRANT SELECT sobre las vistas.
--
-- 3) Probar conexión desde el VPS srv869155:
--    mysql -h 45.32.218.224 -u cobranzas_ro -p guipak \
--          -e "SELECT COUNT(*) FROM v_cobr_ijnl LIMIT 1;"
--
-- 4) Confirmar que NO puede ver tablas crudas:
--    -- Como cobranzas_ro:
--    SELECT COUNT(*) FROM ijnl;       -- Debe fallar: ERROR 1142 SELECT command denied
--    SELECT COUNT(*) FROM icust;      -- Debe fallar
--    INSERT INTO v_cobr_ijnl ...;     -- Debe fallar: privilegio insuficiente
--
-- =============================================================
-- FIN DEL ARCHIVO
-- =============================================================
