import type { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis/client';

/**
 * Rate limiting por ventana fija en Redis (INCR + EXPIRE).
 *
 * Fail-DEGRADED: si Redis no está disponible, NO se hace fail-open (eso dejaba
 * el login sin protección anti-fuerza-bruta durante un outage de Redis).
 * En su lugar cae a un limitador en memoria del proceso. Es per-réplica (no
 * compartido entre instancias), así que en modo degradado el límite efectivo
 * puede ser hasta maxIntentos × nº de réplicas — aceptable: protege sin tumbar
 * el servicio, y nunca afloja por debajo del límite por réplica.
 */
interface MemBucket {
  count: number;
  resetAt: number;
}
const memBuckets = new Map<string, MemBucket>();

function fallbackEnMemoria(
  key: string,
  maxIntentos: number,
  ventanaSegundos: number
): { permitido: boolean; restantes: number } {
  const ahora = Date.now();
  const actual = memBuckets.get(key);
  if (!actual || actual.resetAt <= ahora) {
    // Limpieza oportunista para que el Map no crezca sin límite.
    if (memBuckets.size > 5000) {
      for (const [k, v] of memBuckets) {
        if (v.resetAt <= ahora) memBuckets.delete(k);
      }
    }
    memBuckets.set(key, { count: 1, resetAt: ahora + ventanaSegundos * 1000 });
    return { permitido: 1 <= maxIntentos, restantes: Math.max(0, maxIntentos - 1) };
  }
  actual.count++;
  return { permitido: actual.count <= maxIntentos, restantes: Math.max(0, maxIntentos - actual.count) };
}

export async function rateLimit(
  clave: string,
  maxIntentos: number,
  ventanaSegundos: number
): Promise<{ permitido: boolean; restantes: number }> {
  const key = `ratelimit:${clave}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ventanaSegundos);
    }
    return { permitido: count <= maxIntentos, restantes: Math.max(0, maxIntentos - count) };
  } catch (err) {
    console.error(
      '[rate-limit] Redis no disponible, usando limitador en memoria (degradado):',
      err instanceof Error ? err.message : err
    );
    return fallbackEnMemoria(key, maxIntentos, ventanaSegundos);
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
