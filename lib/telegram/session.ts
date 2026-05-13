/**
 * Capa 1 de la arquitectura de inteligencia:
 * Estado de sesión en Redis — "¿de qué cliente estamos hablando ahora mismo?"
 *
 * TTL: 4 horas. Si el chat lleva 4h inactivo, el contexto se borra solo.
 * Clave: cobranzas:session:chat:{chatId}
 */
import { getRedis } from '@/lib/redis/client';

const SESSION_TTL_SECONDS = 4 * 3600; // 4 horas

export interface SesionChat {
  codigo_cliente: string;
  nombre_cliente: string;
  ultimo_tema?: string;
}

function sessionKey(chatId: number): string {
  return `cobranzas:session:chat:${chatId}`;
}

export async function obtenerSesion(chatId: number): Promise<SesionChat | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(sessionKey(chatId));
    if (!raw) return null;
    return JSON.parse(raw) as SesionChat;
  } catch {
    return null;
  }
}

export async function guardarSesion(chatId: number, sesion: SesionChat): Promise<void> {
  try {
    const redis = getRedis();
    await redis.setex(sessionKey(chatId), SESSION_TTL_SECONDS, JSON.stringify(sesion));
  } catch {
    // sesión es best-effort, nunca bloquea la respuesta
  }
}

export async function limpiarSesion(chatId: number): Promise<void> {
  try {
    const redis = getRedis();
    await redis.del(sessionKey(chatId));
  } catch { /* ignorar */ }
}
