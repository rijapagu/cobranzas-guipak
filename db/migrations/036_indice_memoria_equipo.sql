-- 036: Termina el ultimo paso de 034_memoria_equipo_por_usuario.sql, que en
-- produccion (2026-09-03) se detuvo justo aqui: intentaba DROP INDEX
-- uq_user_clave, pero 031_saas_uniques_compuestos.sql ya lo habia renombrado
-- a uq_empresa_user_clave al agregar soporte multi-tenant. El ADD COLUMN y
-- los backfills de 034 ya habian corrido bien; esa migracion se registro
-- como aplicada por separado (POST /api/internal/admin/migrate baseline)
-- una vez confirmado que su unico paso pendiente era este.
ALTER TABLE cobranza_telegram_memoria_equipo
  DROP INDEX uq_empresa_user_clave,
  ADD UNIQUE KEY uq_empresa_usuario_clave (empresa_id, usuario_id, clave(100));
