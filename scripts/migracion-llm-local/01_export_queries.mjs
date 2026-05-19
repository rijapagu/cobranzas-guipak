#!/usr/bin/env node
/**
 * Export de queries reales del bot Telegram para evaluación de LLM local.
 * Fase A.1 — migración a Qwen2.5 local.
 *
 * USO (dentro del contenedor cobranzas-guipak en el VPS):
 *   docker exec -it <container_id> sh
 *   cd /app   # o donde esté el código
 *   node scripts/migracion-llm-local/01_export_queries.mjs > /tmp/queries_export.tsv
 *   exit
 *   docker cp <container_id>:/tmp/queries_export.tsv ./queries_export.tsv
 *
 * Luego pasar queries_export.tsv a Robocop.
 *
 * Usa las mismas env vars que lib/db/cobranzas.ts (ya populadas en el contenedor):
 *   DB_COBRANZAS_HOST, DB_COBRANZAS_PORT, DB_COBRANZAS_NAME,
 *   DB_COBRANZAS_USER, DB_COBRANZAS_PASS
 */

import mysql from 'mysql2/promise';

const SQL = `
SELECT
  id                                                                          AS msg_id,
  SHA2(CAST(chat_id AS CHAR), 256)                                            AS chat_hash,
  SHA2(CAST(telegram_user_id AS CHAR), 256)                                   AS user_hash,
  DATE(created_at)                                                            AS fecha,
  CASE
    WHEN contenido REGEXP '(?i)(propon|propuesta|redact|correo|email|whats)'  THEN 'propuesta_msg'
    WHEN contenido REGEXP '(?i)(saldo|deuda|debe|cu[aá]nto|aging|factur)'     THEN 'saldo_cliente'
    WHEN contenido REGEXP '(?i)(plantilla|plantillas)'                        THEN 'plantillas'
    WHEN contenido REGEXP '(?i)(estado|c[oó]mo vamos|resumen|hoy|del d[ií]a)' THEN 'estado_dia'
    WHEN contenido REGEXP '(?i)(pendiente|por aprobar|aprobaci[oó]n)'         THEN 'pendientes'
    WHEN contenido REGEXP '(?i)(promesa|cumpli|prometi[oó])'                  THEN 'promesas'
    WHEN contenido REGEXP '(?i)(tarea|recu[eé]rda|agenda|an[oó]tame|an[oó]talo)' THEN 'tareas'
    WHEN contenido REGEXP '(?i)(conciliaci[oó]n|cheque|dep[oó]sito|banco)'    THEN 'conciliacion'
    WHEN contenido REGEXP '(?i)(riesgo|cartera|perfil|cr[eé]dito|vender)'     THEN 'riesgo'
    WHEN contenido REGEXP '(?i)(memoria|recuerda que|sabes que)'              THEN 'memoria'
    WHEN contenido REGEXP '(?i)(cadencia|autom[aá]ticas)'                     THEN 'cadencias'
    WHEN contenido REGEXP '(?i)(sin email|sin whats|sin datos|falta)'         THEN 'sin_datos'
    ELSE 'otro'
  END                                                                         AS categoria,
  CHAR_LENGTH(contenido)                                                      AS chars,
  REPLACE(REPLACE(contenido, CHAR(9), ' '), CHAR(10), ' ')                    AS contenido_oneline
FROM cobranza_telegram_historial
WHERE rol = 'usuario'
  AND created_at >= DATE_SUB(NOW(), INTERVAL 45 DAY)
  AND CHAR_LENGTH(contenido) BETWEEN 5 AND 400
ORDER BY created_at DESC
LIMIT 2000
`;

const pool = mysql.createPool({
  host: process.env.DB_COBRANZAS_HOST || 'localhost',
  port: Number(process.env.DB_COBRANZAS_PORT) || 3307,
  database: process.env.DB_COBRANZAS_NAME || 'cobranzas_guipak',
  user: process.env.DB_COBRANZAS_USER || 'cobranzas_app',
  password: process.env.DB_COBRANZAS_PASS || '',
  connectTimeout: 10000,
});

const COLS = ['msg_id', 'chat_hash', 'user_hash', 'fecha', 'categoria', 'chars', 'contenido_oneline'];

function tsvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

try {
  const [rows] = await pool.execute(SQL);
  process.stdout.write(COLS.join('\t') + '\n');
  for (const row of rows) {
    process.stdout.write(COLS.map((c) => tsvEscape(row[c])).join('\t') + '\n');
  }
  process.stderr.write(`[OK] Exportados ${rows.length} mensajes\n`);

  // Resumen por categoría a stderr (no contamina el TSV)
  const buckets = {};
  for (const row of rows) buckets[row.categoria] = (buckets[row.categoria] || 0) + 1;
  process.stderr.write('[Distribución por categoría]\n');
  for (const [cat, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${cat.padEnd(20)} ${n}\n`);
  }
} catch (err) {
  process.stderr.write(`[ERROR] ${err.message}\n`);
  process.exit(1);
} finally {
  await pool.end();
}
