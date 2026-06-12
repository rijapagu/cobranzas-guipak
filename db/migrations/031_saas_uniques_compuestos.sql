-- 031: Fase 3 Etapa 1 (cierre) — UNIQUE compuestos por empresa.
-- Los UNIQUE por clave natural (codigo_cliente, segmento+dia, factura_id...)
-- impedirian que una empresa 2 tenga sus propios registros. Se convierten a
-- (empresa_id, clave natural). Todo el dato existente es empresa 1, asi que
-- ningun ADD puede chocar: la unicidad vieja garantiza la compuesta.
--
-- NO se tocan los UNIQUE que deben seguir siendo globales:
--   - cobranza_portal_tokens.token (el portal resuelve la empresa DESDE el token)
--   - cobranza_telegram_usuarios.telegram_user_id (el bot identifica al usuario
--     sin contexto de empresa; Etapa 4 lo parametrizara)
--   - empresas.slug

-- ------------------------------------------------------------------
-- 1. Tablas con UNIQUE inline (nombre de indice = nombre de columna).
--    Van PRIMERO: si el nombre no coincide en produccion, la migracion
--    falla sin haber aplicado nada y se corrige el archivo.
-- ------------------------------------------------------------------

ALTER TABLE cobranza_clientes_enriquecidos
  DROP INDEX codigo_cliente,
  ADD UNIQUE KEY uq_empresa_codigo (empresa_id, codigo_cliente);

ALTER TABLE cobranza_cuentas_aprendizaje
  DROP INDEX cuenta_origen,
  ADD UNIQUE KEY uq_empresa_cuenta (empresa_id, cuenta_origen);

-- ------------------------------------------------------------------
-- 2. Tablas con UNIQUE nombrados en sus migraciones (nombres ciertos).
-- ------------------------------------------------------------------

ALTER TABLE cobranza_cadencias
  DROP INDEX uq_segmento_dia,
  ADD UNIQUE KEY uq_empresa_segmento_dia (empresa_id, segmento, dia_desde_vencimiento);

ALTER TABLE cobranza_cliente_inteligencia
  DROP INDEX uq_codigo,
  ADD UNIQUE KEY uq_empresa_codigo (empresa_id, codigo_cliente);

ALTER TABLE cobranza_memoria_cliente
  DROP INDEX uq_codigo_cliente,
  ADD UNIQUE KEY uq_empresa_codigo (empresa_id, codigo_cliente);

ALTER TABLE cobranza_telegram_memoria_equipo
  DROP INDEX uq_user_clave,
  ADD UNIQUE KEY uq_empresa_user_clave (empresa_id, telegram_user_id, clave(100));

ALTER TABLE cobranza_facturas_documentos
  DROP INDEX uk_factura,
  ADD UNIQUE KEY uq_empresa_factura (empresa_id, ij_local, ij_inum);

-- ------------------------------------------------------------------
-- 3. PKs naturales → PKs compuestas con empresa_id.
-- ------------------------------------------------------------------

-- PK era factura_id VARCHAR(40); el upsert del job de cadencias
-- (ON DUPLICATE KEY) pasa a operar por (empresa_id, factura_id).
ALTER TABLE cobranza_factura_cadencia_estado
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (empresa_id, factura_id);

-- PK era clave VARCHAR(100); cada empresa tendra sus propias claves
-- (prompt_agente, etc.).
ALTER TABLE cobranza_configuracion
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (empresa_id, clave);
