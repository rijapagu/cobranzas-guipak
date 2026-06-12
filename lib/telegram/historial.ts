import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

export interface MensajeHistorial {
  rol: 'usuario' | 'asistente';
  contenido: string;
}

export async function guardarMensaje(
  chatId: number,
  telegramUserId: number,
  rol: 'usuario' | 'asistente',
  contenido: string
): Promise<void> {
  await cobranzasExecute(
    'INSERT INTO cobranza_telegram_historial (empresa_id, chat_id, telegram_user_id, rol, contenido) VALUES (1, ?, ?, ?, ?)',
    [chatId, telegramUserId, rol, contenido]
  );
}

export async function cargarHistorial(chatId: number, limite = 30): Promise<MensajeHistorial[]> {
  // Carga los últimos N mensajes ordenados por fecha DESC, luego invierte para Claude
  const rows = await cobranzasQuery<{ rol: string; contenido: string }>(
    `SELECT rol, contenido FROM (
       SELECT rol, contenido, created_at
         FROM cobranza_telegram_historial
        WHERE empresa_id = 1 AND chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?
     ) sub ORDER BY created_at ASC`,
    [chatId, limite]
  );
  return rows.map((r) => ({
    rol: r.rol as 'usuario' | 'asistente',
    contenido: r.contenido,
  }));
}

export async function cargarMemoriaEquipo(
  telegramUserId: number
): Promise<{ clave: string; valor: string }[]> {
  return cobranzasQuery<{ clave: string; valor: string }>(
    'SELECT clave, valor FROM cobranza_telegram_memoria_equipo WHERE empresa_id = 1 AND telegram_user_id = ? ORDER BY updated_at DESC',
    [telegramUserId]
  );
}

export async function guardarMemoriaEquipo(
  telegramUserId: number,
  clave: string,
  valor: string
): Promise<void> {
  await cobranzasExecute(
    `INSERT INTO cobranza_telegram_memoria_equipo (empresa_id, telegram_user_id, clave, valor)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE valor = VALUES(valor), updated_at = NOW()`,
    [telegramUserId, clave, valor]
  );
}
