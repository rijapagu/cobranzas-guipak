import { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

let bot: Telegraf | null = null;

function getBot(): Telegraf {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
    bot = new Telegraf(token);
  }
  return bot;
}

function getChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID_GRUPO_COBROS no configurado');
  return chatId;
}

export async function enviarMensajeGrupo(
  texto: string,
  opciones?: { teclado?: InlineKeyboardMarkup }
): Promise<number> {
  const telegram = getBot().telegram;
  const chatId = getChatId();

  const mensaje = await telegram.sendMessage(chatId, texto, {
    parse_mode: 'HTML',
    ...(opciones?.teclado && { reply_markup: opciones.teclado }),
  });

  return mensaje.message_id;
}

/**
 * Mensaje al chat privado de una persona: el chat_id de un privado es su propio
 * telegram_user_id.
 *
 * Ojo: Telegram NO permite que un bot escriba primero a quien nunca le ha
 * hablado. Si esa persona no le ha dado a Iniciar, falla con 403 — por eso
 * devuelve un booleano en vez de reventar, y quien llama decide si importa.
 */
export async function enviarMensajePrivado(
  telegramUserId: number,
  texto: string,
  opciones?: { teclado?: InlineKeyboardMarkup }
): Promise<boolean> {
  try {
    await getBot().telegram.sendMessage(telegramUserId, texto, {
      parse_mode: 'HTML',
      ...(opciones?.teclado && { reply_markup: opciones.teclado }),
    });
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[TELEGRAM] No se pudo escribir en privado a ${telegramUserId}: ${msg}`);
    return false;
  }
}

export async function editarMensaje(
  messageId: number,
  texto: string
): Promise<void> {
  const telegram = getBot().telegram;
  const chatId = getChatId();
  await telegram.editMessageText(chatId, messageId, undefined, texto, {
    parse_mode: 'HTML',
  });
}

export async function responderCallback(
  callbackQueryId: string,
  texto: string
): Promise<void> {
  await getBot().telegram.answerCbQuery(callbackQueryId, texto);
}

export function getTelegraf(): Telegraf {
  return getBot();
}
