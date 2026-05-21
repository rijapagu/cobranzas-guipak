/**
 * Idempotencia para webhooks de Telegram.
 *
 * Telegram retransmite el mismo `update_id` si el webhook no responde 200 OK
 * en pocos segundos. Cuando el handler bloquea esperando al LLM (que puede
 * tardar 1-3 min), un solo mensaje del usuario se vuelve 4-5 ejecuciones
 * paralelas en el Gateway.
 *
 * Marca cada update_id en Redis con SET NX EX 86400. Si la clave ya existía
 * (NX falla), es un retry y debe descartarse. Si Redis no está disponible,
 * dejamos pasar (preferimos un duplicado ocasional a perder mensajes).
 */
import { getRedis } from '@/lib/redis/client';

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

function idempotencyKey(updateId: number): string {
  return `cobranzas:idempotency:telegram:update:${updateId}`;
}

/**
 * Marca un update_id como visto. Devuelve true si es la primera vez (procesar),
 * false si ya estaba marcado (descartar como retry).
 *
 * En caso de error de Redis, devuelve true — preferimos riesgo de duplicado
 * a perder un mensaje real del usuario.
 */
export async function marcarUpdateVisto(updateId: number): Promise<boolean> {
  try {
    const redis = getRedis();
    const result = await redis.set(
      idempotencyKey(updateId),
      '1',
      'EX',
      IDEMPOTENCY_TTL_SECONDS,
      'NX'
    );
    return result === 'OK';
  } catch (err) {
    console.warn(
      '[idempotency] Redis no disponible, procesando sin chequear:',
      err instanceof Error ? err.message : String(err)
    );
    return true;
  }
}
