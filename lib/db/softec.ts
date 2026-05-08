/**
 * Conexión a Softec MySQL — SOLO LECTURA
 * ⛔ PROHIBIDO cualquier INSERT, UPDATE, DELETE
 *
 * Defensa en profundidad — tres capas:
 *   1. Usuario MySQL `cobranzas_ro` con GRANT SELECT solo sobre vistas v_cobr_*
 *      (definido en scripts/setup-softec-cobranzas-readonly.sql).
 *   2. multipleStatements: false en el pool (evita inyección de múltiples queries).
 *   3. Guard de regex en este archivo (rechaza todo lo que no sea SELECT).
 *
 * Ver CRITICAL_POINTS.md CP-01.
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_SOFTEC_HOST || '',
  port: Number(process.env.DB_SOFTEC_PORT) || 3306,
  database: process.env.DB_SOFTEC_NAME || 'guipak',
  user: process.env.DB_SOFTEC_USER || '',
  password: process.env.DB_SOFTEC_PASS || '',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000,
  // CP-01: nunca permitir múltiples statements separados por ';'
  multipleStatements: false,
});

/**
 * Quita comentarios SQL para que el guard no se pueda evadir con
 *   /​* INSERT *​/ SELECT ...
 *   -- INSERT
 *   SELECT ...
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // bloque /* ... */
    .replace(/--[^\n]*/g, ' ')          // línea -- ...
    .replace(/#[^\n]*/g, ' ');           // línea # ... (MySQL)
}

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'REPLACE', 'GRANT', 'REVOKE', 'RENAME', 'CALL', 'HANDLER', 'LOAD',
  'LOCK', 'UNLOCK', 'SET', 'DO', 'EXECUTE',
];

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

/**
 * Ejecuta un query SELECT contra Softec.
 * Rechaza cualquier query que no sea SELECT (ver CP-01).
 */
export async function softecQuery<T = Record<string, unknown>>(
  sql: string,
  params?: (string | number | boolean | null | Date)[]
): Promise<T[]> {
  const cleaned = stripSqlComments(sql).trim();

  // Debe empezar por SELECT (o WITH/SHOW/EXPLAIN/DESCRIBE para introspección).
  if (!/^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC)\b/i.test(cleaned)) {
    throw new Error(
      '[SOFTEC] Solo se permiten queries SELECT/WITH/SHOW/EXPLAIN en Softec. Ver CP-01.'
    );
  }

  // No permitir keywords de escritura en ningún punto del query (ni siquiera
  // dentro de subqueries o CTEs).
  if (FORBIDDEN_RE.test(cleaned)) {
    throw new Error(
      '[SOFTEC] OPERACIÓN PROHIBIDA: la query contiene keywords de escritura. Ver CP-01.'
    );
  }

  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

/**
 * Verifica la conexión a Softec.
 * Retorna false si no hay credenciales configuradas.
 */
export async function testSoftecConnection(): Promise<boolean> {
  if (!process.env.DB_SOFTEC_HOST) {
    return false;
  }
  try {
    await pool.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
