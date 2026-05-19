-- Export de queries reales del bot Telegram para evaluación de LLM local.
-- Fase A.1 — migración a Qwen2.5 local.
--
-- USO:
--   En el VPS:
--     mysql -u <usuario> -p <db_cobranzas> < 01_export_queries.sql > queries_export.tsv
--   Pasar queries_export.tsv a Robocop (scp / sftp).
--
-- ESTRATEGIA:
--   - Solo mensajes de rol='usuario' (las queries reales, no las respuestas del bot).
--   - Últimos 45 días (suficiente histórico, no tan viejo que sea irrelevante).
--   - Largo entre 5 y 400 caracteres (descarta typos accidentales y pastes raros).
--   - Categorizado por keywords para muestreo estratificado posterior.
--   - Hash de chat_id y user_id (no PII expuesta en el TSV).
--
-- NO ANONIMIZA NOMBRES DE CLIENTES NI MONTOS aquí — eso lo hace 02_anonimizar.mjs
-- en Robocop antes de cualquier eval. El TSV es de uso interno temporal.

SELECT
  id                                                                                  AS msg_id,
  SHA2(CAST(chat_id AS CHAR), 256)                                                    AS chat_hash,
  SHA2(CAST(telegram_user_id AS CHAR), 256)                                           AS user_hash,
  DATE(created_at)                                                                    AS fecha,
  CASE
    WHEN contenido REGEXP '(?i)(propon|propuesta|redact|correo|email|whats)'          THEN 'propuesta_msg'
    WHEN contenido REGEXP '(?i)(saldo|deuda|debe|cu[aá]nto|aging|factur)'             THEN 'saldo_cliente'
    WHEN contenido REGEXP '(?i)(plantilla|plantillas)'                                THEN 'plantillas'
    WHEN contenido REGEXP '(?i)(estado|c[oó]mo vamos|resumen|hoy|del d[ií]a)'         THEN 'estado_dia'
    WHEN contenido REGEXP '(?i)(pendiente|por aprobar|aprobaci[oó]n)'                 THEN 'pendientes'
    WHEN contenido REGEXP '(?i)(promesa|cumpli|prometi[oó])'                          THEN 'promesas'
    WHEN contenido REGEXP '(?i)(tarea|recu[eé]rda|agenda|an[oó]tame|an[oó]talo)'      THEN 'tareas'
    WHEN contenido REGEXP '(?i)(conciliaci[oó]n|cheque|dep[oó]sito|banco)'            THEN 'conciliacion'
    WHEN contenido REGEXP '(?i)(riesgo|cartera|perfil|cr[eé]dito|vender)'             THEN 'riesgo'
    WHEN contenido REGEXP '(?i)(memoria|recuerda que|sabes que)'                      THEN 'memoria'
    WHEN contenido REGEXP '(?i)(cadencia|autom[aá]ticas)'                             THEN 'cadencias'
    WHEN contenido REGEXP '(?i)(sin email|sin whats|sin datos|falta)'                 THEN 'sin_datos'
    ELSE 'otro'
  END                                                                                 AS categoria,
  CHAR_LENGTH(contenido)                                                              AS chars,
  REPLACE(REPLACE(contenido, CHAR(9), ' '), CHAR(10), ' ')                            AS contenido_oneline
FROM cobranza_telegram_historial
WHERE rol = 'usuario'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 45 DAY)
  AND CHAR_LENGTH(contenido) BETWEEN 5 AND 400
ORDER BY created_at DESC
LIMIT 2000;
