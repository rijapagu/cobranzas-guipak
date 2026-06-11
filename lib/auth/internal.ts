import type { NextRequest } from 'next/server';
import { secretoValido } from './secrets';

/**
 * Valida el secreto de los endpoints internos (/api/internal/cron/**, etc.).
 * Acepta x-internal-secret (estándar) y x-cron-secret (legado) contra
 * INTERNAL_CRON_SECRET. Timing-safe y fail-closed (env var vacía → rechaza).
 */
export function esRequestInternoValido(req: NextRequest): boolean {
  const recibido =
    req.headers.get('x-internal-secret') ?? req.headers.get('x-cron-secret');
  return secretoValido(recibido, process.env.INTERNAL_CRON_SECRET);
}

/**
 * Valida el secreto DEDICADO de endpoints administrativos peligrosos
 * (/api/internal/admin/migrate). No reusa el secreto de cron a propósito:
 * un secreto filtrado de cron no debe permitir ejecutar SQL.
 */
export function esRequestAdminValido(req: NextRequest): boolean {
  return secretoValido(
    req.headers.get('x-internal-secret'),
    process.env.INTERNAL_ADMIN_SECRET
  );
}
