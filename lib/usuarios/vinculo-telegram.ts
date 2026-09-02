import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

/**
 * Vínculo entre un usuario de la aplicación y su cuenta de Telegram.
 *
 * Son dos identidades distintas: en la app se entra con correo y contraseña,
 * y el bot solo conoce el `telegram_user_id` numérico que manda Telegram en
 * cada mensaje. Sin una fila aquí, el bot responde "no autorizado" aunque la
 * persona ya tenga cuenta en el sistema.
 *
 * El rol de Telegram NO se pide aparte: se deriva del rol de la aplicación,
 * para que nadie termine siendo COBRADOR en la web y supervisor en el chat.
 */

export type RolApp = 'ADMIN' | 'SUPERVISOR' | 'COBRADOR';
export type RolTelegram = 'supervisor' | 'agente_cobros';

export function rolTelegramDesdeApp(rol: RolApp): RolTelegram {
  return rol === 'COBRADOR' ? 'agente_cobros' : 'supervisor';
}

export interface VinculoTelegram {
  telegram_user_id: number;
  telegram_username: string | null;
  rol: RolTelegram;
  activo: number;
}

/** Error de negocio: el id de Telegram ya está tomado por otra persona. */
export class TelegramYaVinculado extends Error {
  constructor(public readonly telegramUserId: number) {
    super(`El id de Telegram ${telegramUserId} ya está vinculado a otro usuario`);
    this.name = 'TelegramYaVinculado';
  }
}

/**
 * Deja el vínculo de Telegram en el estado pedido.
 *
 * - `telegramUserId` con valor → crea o actualiza el vínculo.
 * - `telegramUserId` en null → borra el vínculo si existía.
 *
 * Lanza `TelegramYaVinculado` si ese id pertenece a otro usuario: el bot
 * resuelve por `telegram_user_id`, así que dos filas con el mismo id harían
 * que el permiso dependiera de cuál se lea primero.
 */
export async function sincronizarVinculoTelegram(opciones: {
  usuarioId: number;
  empresaId: number;
  telegramUserId: number | null;
  telegramUsername?: string | null;
  rolApp: RolApp;
  activo: number;
}): Promise<void> {
  const { usuarioId, empresaId, telegramUserId, telegramUsername, rolApp, activo } = opciones;

  if (telegramUserId === null) {
    await cobranzasExecute(
      'DELETE FROM cobranza_telegram_usuarios WHERE usuario_id = ? AND empresa_id = ?',
      [usuarioId, empresaId]
    );
    return;
  }

  const enUso = await cobranzasQuery<{ usuario_id: number }>(
    'SELECT usuario_id FROM cobranza_telegram_usuarios WHERE telegram_user_id = ? LIMIT 1',
    [telegramUserId]
  );
  if (enUso.length > 0 && Number(enUso[0].usuario_id) !== usuarioId) {
    throw new TelegramYaVinculado(telegramUserId);
  }

  const rolTg = rolTelegramDesdeApp(rolApp);
  const username = telegramUsername?.trim().replace(/^@/, '') || null;

  const existente = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_telegram_usuarios WHERE usuario_id = ? AND empresa_id = ? LIMIT 1',
    [usuarioId, empresaId]
  );

  if (existente.length > 0) {
    await cobranzasExecute(
      `UPDATE cobranza_telegram_usuarios
       SET telegram_user_id = ?, telegram_username = ?, rol = ?, activo = ?
       WHERE id = ?`,
      [telegramUserId, username, rolTg, activo, existente[0].id]
    );
    return;
  }

  await cobranzasExecute(
    `INSERT INTO cobranza_telegram_usuarios
       (telegram_user_id, telegram_username, usuario_id, rol, activo, empresa_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [telegramUserId, username, usuarioId, rolTg, activo, empresaId]
  );
}
