import { cobranzasQuery } from '@/lib/db/cobranzas';

export interface TelegramUserAuth {
  id: number;
  telegram_user_id: number;
  telegram_username: string | null;
  usuario_id: number;
  rol: 'supervisor' | 'agente_cobros';
  activo: number;
}

/**
 * Resuelve un telegram_user_id a un usuario interno autorizado.
 * Retorna null si no está autorizado o está inactivo.
 */
export async function resolverUsuarioTelegram(
  telegramUserId: number
): Promise<TelegramUserAuth | null> {
  const rows = await cobranzasQuery<TelegramUserAuth>(
    'SELECT id, telegram_user_id, telegram_username, usuario_id, rol, activo FROM cobranza_telegram_usuarios WHERE telegram_user_id = ? AND activo = 1 LIMIT 1',
    [telegramUserId]
  );
  return rows[0] || null;
}

export function esSupervisor(auth: TelegramUserAuth): boolean {
  return auth.rol === 'supervisor';
}
