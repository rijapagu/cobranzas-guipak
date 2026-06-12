/**
 * Conexión a la base de datos propia — cobranzas_guipak
 * ✅ Lectura y escritura permitidas
 */

import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_COBRANZAS_HOST || 'localhost',
  port: Number(process.env.DB_COBRANZAS_PORT) || 3307,
  database: process.env.DB_COBRANZAS_NAME || 'cobranzas_guipak',
  user: process.env.DB_COBRANZAS_USER || 'cobranzas_app',
  password: process.env.DB_COBRANZAS_PASS || '',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_COBRANZAS_POOL_SIZE) || 25,
  queueLimit: 0,
  connectTimeout: 10000,
});

/**
 * Ejecuta un query contra la DB propia.
 */
export async function cobranzasQuery<T = Record<string, unknown>>(
  sql: string,
  params?: (string | number | boolean | null | Date)[]
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

/**
 * Ejecuta un INSERT/UPDATE/DELETE y retorna el resultado.
 */
export async function cobranzasExecute(
  sql: string,
  params?: (string | number | boolean | null | Date)[]
): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params);
  return result as mysql.ResultSetHeader;
}

/**
 * Ejecuta SQL crudo SIN protocolo de prepared statements.
 * Útil para DDL (ALTER, TRUNCATE, etc.) que no soporta el protocolo prepared.
 * Solo usar en contextos confiables (migrations) — NO acepta params para evitar SQL injection.
 */
export async function cobranzasQueryRaw(sql: string): Promise<unknown> {
  const [result] = await pool.query(sql);
  return result;
}

/**
 * Registra una acción en cobranza_logs (CP-08).
 */
export async function logAccion(
  usuarioId: string | null,
  accion: string,
  entidad: string,
  entidadId: string,
  detalle: Record<string, unknown>,
  ip?: string,
  empresaId?: number
): Promise<void> {
  // empresaId opcional: los flujos legacy y Guipak caen al DEFAULT 1 de la columna.
  await pool.execute(
    'INSERT INTO cobranza_logs (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [empresaId ?? 1, usuarioId, accion, entidad, entidadId, JSON.stringify(detalle), ip || null]
  );
}

/**
 * Registra un ERROR en cobranza_logs (convención CLAUDE.md: todos los errores
 * van a cobranza_logs) además de la consola. Nunca lanza — loguear no puede
 * tumbar el flujo que falló.
 */
export async function logError(
  origen: string,
  error: unknown,
  contexto?: Record<string, unknown>
): Promise<void> {
  console.error(`[${origen}]`, error);
  try {
    const mensaje =
      error instanceof Error
        ? `${error.message}${error.stack ? `\n${error.stack.substring(0, 500)}` : ''}`
        : String(error);
    await logAccion(null, 'ERROR', origen, '0', {
      mensaje: mensaje.substring(0, 1500),
      ...contexto,
    });
  } catch {
    // la tabla de logs no está disponible — ya quedó en consola
  }
}

/**
 * Verifica la conexión a la DB propia.
 */
export async function testCobranzasConnection(): Promise<boolean> {
  try {
    await pool.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
