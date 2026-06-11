import type { JwtPayload } from '@/lib/auth/jwt';

/**
 * Resolución de tenant (Fase 3 — SaaS multi-empresa).
 *
 * Guipak es la empresa 1 y el DEFAULT de todas las columnas empresa_id,
 * así que el sistema actual funciona sin cambios. Los tokens emitidos antes
 * de la Fase 3 no traen empresa_id → se interpretan como Guipak.
 */

export const EMPRESA_GUIPAK = 1;

export function empresaIdDeSesion(session: JwtPayload | null | undefined): number {
  const id = session?.empresa_id;
  return typeof id === 'number' && id > 0 ? id : EMPRESA_GUIPAK;
}
