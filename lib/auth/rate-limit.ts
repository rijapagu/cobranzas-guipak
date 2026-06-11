import type { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis/client';

/**
 * Rate limiting simple por ventana fija en Redis (INCR + EXPIRE).
 *
 * Fail-open: si Redis no está disponible, permite el request (preferimos
 * no tumbar el login/portal por una caída de Redis; el evento se loguea).
 */
export async function rateLimit(
  clave: string,
  maxIntentos: number,
  ventanaSegundos: number
): Promise<{ permitido: boolean; restantes: number }> {
  try {
    const redis = getRedis();
    const key = `ratelimit:${clave}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ventanaSegundos);
    }
    return { permitido: count <= maxIntentos, restantes: Math.max(0, maxIntentos - count) };
  } catch (err) {
    console.error(
      '[rate-limit] Redis no disponible, permitiendo request:',
      err instanceof Error ? err.message : err
    );
    return { permitido: true, restantes: 0 };
  }
}

/** IP del cliente detrás del proxy (Traefik/Dokploy setea x-forwarded-for). */
export function ipDeRequest(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'desconocida'
  );
}
