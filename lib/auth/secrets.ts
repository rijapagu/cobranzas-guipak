import { timingSafeEqual } from 'crypto';

/**
 * Compara un secreto recibido contra el esperado de forma timing-safe.
 * Fail-closed: si el secreto esperado no está configurado (env var ausente
 * o vacía), SIEMPRE devuelve false — un entorno mal configurado no puede
 * dejar un endpoint abierto.
 */
export function secretoValido(
  recibido: string | null | undefined,
  esperado: string | undefined
): boolean {
  if (!esperado || !recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
