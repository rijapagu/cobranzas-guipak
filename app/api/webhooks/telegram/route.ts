import { NextRequest, NextResponse } from 'next/server';
import { resolverUsuarioTelegram } from '@/lib/telegram/auth';
import { procesarMensajeBot } from '@/lib/telegram/agent';
import { getTelegraf } from '@/lib/telegram/client';
import { cobranzasQuery } from '@/lib/db/cobranzas';

interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
  };
  text?: string;
  reply_to_message?: { message_id: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

const BOT_USERNAME_PREFIX = '@CobrosGuipakBot';

/**
 * Webhook que recibe los updates de Telegram.
 * Solo procesa mensajes en el grupo configurado o de usuarios autorizados.
 */
export async function POST(req: NextRequest) {
  try {
    const update = (await req.json()) as TelegramUpdate;
    const message = update.message || update.edited_message;
    if (!message || !message.text || !message.from) {
      return NextResponse.json({ ok: true, ignored: 'no-message' });
    }

    if (message.from.is_bot) {
      return NextResponse.json({ ok: true, ignored: 'bot-message' });
    }

    const chatIdGrupo = process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS;
    const esGrupoAutorizado = chatIdGrupo && String(message.chat.id) === chatIdGrupo;
    const esChatPrivado = message.chat.type === 'private';

    if (!esGrupoAutorizado && !esChatPrivado) {
      // Solo procesar mensajes del grupo configurado o privados
      return NextResponse.json({ ok: true, ignored: 'chat-no-autorizado' });
    }

    // Si es grupo, exigir que mencionen al bot o usen "/" comando
    const texto = message.text.trim();
    let textoLimpio = texto;
    if (esGrupoAutorizado) {
      const mencionaBot = texto.includes(BOT_USERNAME_PREFIX);
      const esComando = texto.startsWith('/');
      if (!mencionaBot && !esComando) {
        return NextResponse.json({ ok: true, ignored: 'sin-mencion' });
      }
      textoLimpio = texto.replace(BOT_USERNAME_PREFIX, '').trim();
    }

    // Manejar comandos rápidos
    if (textoLimpio.startsWith('/')) {
      return await manejarComando(textoLimpio, message);
    }

    // Resolver autorización
    const auth = await resolverUsuarioTelegram(message.from.id);
    if (!auth) {
      await responderMensaje(
        message.chat.id,
        '⛔ No estás autorizado. Pídele a Ricardo que te dé acceso.',
        message.message_id
      );
      return NextResponse.json({ ok: true, no_autorizado: true });
    }

    // Procesar con Claude
    const respuesta = await procesarMensajeBot({
      texto: textoLimpio,
      user: auth,
    });

    await responderMensaje(message.chat.id, respuesta, message.message_id);

    // Audit log (CP-10)
    await cobranzasQuery(
      `INSERT INTO cobranza_logs (usuario_id, accion, entidad, detalle, ip)
       VALUES (?, ?, ?, ?, ?)`,
      [
        auth.usuario_id,
        'BOT_TELEGRAM_QUERY',
        'telegram',
        JSON.stringify({
          chat_id: message.chat.id,
          message_id: message.message_id,
          texto: textoLimpio.substring(0, 500),
          telegram_user_id: message.from.id,
        }),
        'telegram-webhook',
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[telegram-webhook]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    );
  }
}

async function manejarComando(
  comando: string,
  message: TelegramMessage
): Promise<NextResponse> {
  const cmd = comando.split(/[\s@]/)[0].toLowerCase();

  switch (cmd) {
    case '/start':
      await responderMensaje(
        message.chat.id,
        `👋 ¡Hola! Soy el asistente de cobranzas de Guipak.\n\nPuedes preguntarme cosas como:\n• <i>"¿Cuánto debe Master Clean?"</i>\n• <i>"Resumen de cobros hoy"</i>\n• <i>"Qué hay pendiente de aprobar"</i>\n• <i>"Promesas vencidas"</i>\n\nMenciona <b>@CobrosGuipakBot</b> en el grupo o háblame en privado.`,
        message.message_id
      );
      return NextResponse.json({ ok: true });

    case '/help':
      await responderMensaje(
        message.chat.id,
        `<b>Comandos disponibles:</b>\n\n/start — Saludo y guía\n/help — Esta ayuda\n/estado — Resumen rápido\n\n<b>O pregúntame en lenguaje natural</b> sobre cualquier cliente, factura o gestión.`,
        message.message_id
      );
      return NextResponse.json({ ok: true });

    case '/estado': {
      const auth = message.from
        ? await resolverUsuarioTelegram(message.from.id)
        : null;
      if (!auth) {
        await responderMensaje(message.chat.id, '⛔ No autorizado.', message.message_id);
        return NextResponse.json({ ok: true });
      }
      const respuesta = await procesarMensajeBot({
        texto: 'Dame el estado de cobros de hoy.',
        user: auth,
      });
      await responderMensaje(message.chat.id, respuesta, message.message_id);
      return NextResponse.json({ ok: true });
    }

    default:
      await responderMensaje(
        message.chat.id,
        `Comando no reconocido: <code>${cmd}</code>. Usa /help para ver opciones.`,
        message.message_id
      );
      return NextResponse.json({ ok: true });
  }
}

async function responderMensaje(
  chatId: number,
  texto: string,
  replyTo?: number
): Promise<void> {
  const bot = getTelegraf();
  try {
    await bot.telegram.sendMessage(chatId, texto, {
      parse_mode: 'HTML',
      ...(replyTo && replyTo > 0 && { reply_parameters: { message_id: replyTo } }),
    });
  } catch (error) {
    // Si falla con reply (mensaje original ya no existe), reintentar sin reply
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('reply') || msg.includes('replied')) {
      try {
        await bot.telegram.sendMessage(chatId, texto, { parse_mode: 'HTML' });
        return;
      } catch (retryError) {
        console.error('[telegram-webhook] Error en retry:', retryError);
      }
    }
    console.error('[telegram-webhook] Error enviando respuesta:', error);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'Webhook de Telegram para Cobros Guipak',
    timestamp: new Date().toISOString(),
  });
}
