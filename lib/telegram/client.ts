import { Telegraf, InlineKeyboard } from 'telegraf';

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
  opciones?: { teclado?: ReturnType<typeof InlineKeyboard.from> }
): Promise<number> {
  const telegram = getBot().telegram;
  const chatId = getChatId();

  const mensaje = await telegram.sendMessage(chatId, texto, {
    parse_mode: 'HTML',
    ...(opciones?.teclado && { reply_markup: opciones.teclado }),
  });

  return mensaje.message_id;
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
