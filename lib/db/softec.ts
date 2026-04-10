/**
 * Conexión a Softec MySQL — SOLO LECTURA
 * ⛔ PROHIBIDO cualquier INSERT, UPDATE, DELETE
 * Ver CRITICAL_POINTS.md CP-01
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
});

const FORBIDDEN_PATTERNS = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE)/i;

/**
 * Ejecuta un query SELECT contra Softec.
 * Rechaza cualquier query que no sea SELECT.
 */
export async function softecQuery<T = Record<string, unknown>>(
  sql: string,
  params?: (string | number | boolean | null | Date)[]
): Promise<T[]> {
  if (FORBIDDEN_PATTERNS.test(sql.trim())) {
    throw new Error(
      '[SOFTEC] OPERACIÓN PROHIBIDA: Solo se permiten queries SELECT en Softec. Ver CP-01.'
    );
  }

  if (!sql.trim().toUpperCase().startsWith('SELECT')) {
    throw new Error(
      '[SOFTEC] Solo se permiten queries SELECT en la base de datos de Softec.'
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
