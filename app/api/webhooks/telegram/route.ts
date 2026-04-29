import { NextRequest, NextResponse } from 'next/server';
import { resolverUsuarioTelegram, esSupervisor } from '@/lib/telegram/auth';
import { procesarMensajeBot } from '@/lib/telegram/agent';
import { getTelegraf } from '@/lib/telegram/client';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { enviarGestion } from '@/lib/telegram/enviar-gestion';
import type { InlineKeyboardMarkup } from 'telegraf/types';

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

interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    is_bot: boolean;
    first_name?: string;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: { id: number };
  };
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

const BOT_USERNAME_PREFIX = '@CobrosGuipakBot';

/**
 * Webhook que recibe los updates de Telegram.
 */
export async function POST(req: NextRequest) {
  try {
    const update = (await req.json()) as TelegramUpdate;

    // Callback queries (botones inline)
    if (update.callback_query) {
      return await manejarCallback(update.callback_query);
    }

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
      return NextResponse.json({ ok: true, ignored: 'chat-no-autorizado' });
    }

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

    if (textoLimpio.startsWith('/')) {
      return await manejarComando(textoLimpio, message);
    }

    const auth = await resolverUsuarioTelegram(message.from.id);
    if (!auth) {
      await responderMensaje(
        message.chat.id,
        '⛔ No estás autorizado. Pídele a Ricardo que te dé acceso.',
        message.message_id
      );
      return NextResponse.json({ ok: true, no_autorizado: true });
    }

    console.error(`[webhook] "${textoLimpio.substring(0, 80)}" | anthropic=${!!process.env.ANTHROPIC_API_KEY}`);
    const respuesta = await procesarMensajeBot({
      texto: textoLimpio,
      user: auth,
    });
    console.error(`[webhook] Resp len=${respuesta.length}, gestion=${respuesta.includes('gestion-pendiente')}, head=${respuesta.substring(0, 100)}`);

    // Detectar si la respuesta contiene una gestion_id pendiente
    const { texto: textoFinal, gestionId } = extraerGestionPendiente(respuesta);
    const teclado = gestionId ? construirBotonesGestion(gestionId) : undefined;

    await responderMensaje(message.chat.id, textoFinal, message.message_id, teclado);

    // Audit log (CP-12)
    await logAccion(
      String(auth.usuario_id),
      'BOT_TELEGRAM_QUERY',
      'telegram',
      String(message.message_id),
      {
        chat_id: message.chat.id,
        texto: textoLimpio.substring(0, 500),
        telegram_user_id: message.from.id,
        gestion_id_propuesta: gestionId || null,
      }
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

/**
 * Extrae la marca <gestion-pendiente id="N"/> y devuelve el texto sin ella + el id.
 */
function extraerGestionPendiente(texto: string): {
  texto: string;
  gestionId: number | null;
} {
  const match = texto.match(/<gestion-pendiente\s+id="(\d+)"\s*\/>/);
  if (!match) return { texto, gestionId: null };
  const id = Number(match[1]);
  const limpio = texto.replace(match[0], '').trim();
  return { texto: limpio, gestionId: id };
}

function construirBotonesGestion(gestionId: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Aprobar y enviar', callback_data: `aprobar:${gestionId}` },
      ],
      [
        { text: '✏️ Editar', callback_data: `editar:${gestionId}` },
        { text: '❌ Descartar', callback_data: `descartar:${gestionId}` },
      ],
    ],
  };
}

async function manejarCallback(
  cb: TelegramCallbackQuery
): Promise<NextResponse> {
  const bot = getTelegraf();

  // Auth
  const auth = await resolverUsuarioTelegram(cb.from.id);
  if (!auth) {
    await bot.telegram.answerCbQuery(cb.id, '⛔ No autorizado', { show_alert: true });
    return NextResponse.json({ ok: true, no_autorizado: true });
  }

  const data = cb.data || '';
  const [accion, idStr] = data.split(':');
  const gestionId = Number(idStr);
  if (!gestionId || isNaN(gestionId)) {
    await bot.telegram.answerCbQuery(cb.id, 'Acción inválida');
    return NextResponse.json({ ok: false });
  }

  // Validar gestión
  const gestiones = await cobranzasQuery<{
    id: number;
    estado: string;
    codigo_cliente: string;
    saldo_pendiente: number;
    asunto_email: string | null;
    mensaje_propuesto_email: string | null;
  }>(
    'SELECT id, estado, codigo_cliente, saldo_pendiente, asunto_email, mensaje_propuesto_email FROM cobranza_gestiones WHERE id = ?',
    [gestionId]
  );
  if (gestiones.length === 0) {
    await bot.telegram.answerCbQuery(cb.id, '⚠️ Gestión no encontrada', { show_alert: true });
    return NextResponse.json({ ok: false });
  }
  const gestion = gestiones[0];

  if (gestion.estado !== 'PENDIENTE') {
    await bot.telegram.answerCbQuery(cb.id, `Esta gestión ya está en estado ${gestion.estado}`, {
      show_alert: true,
    });
    return NextResponse.json({ ok: false });
  }

  switch (accion) {
    case 'aprobar': {
      // CP-02: marcar APROBADO con aprobado_por
      // CP-08: log antes de la acción
      await logAccion(
        String(auth.usuario_id),
        'GESTION_APROBADA_TELEGRAM',
        'gestion',
        String(gestionId),
        { cliente: gestion.codigo_cliente, saldo: Number(gestion.saldo_pendiente) }
      );

      await cobranzasExecute(
        `UPDATE cobranza_gestiones
         SET estado='APROBADO', aprobado_por=?, fecha_aprobacion=NOW(),
             mensaje_final_email = COALESCE(mensaje_final_email, mensaje_propuesto_email)
         WHERE id = ?`,
        [`telegram:${auth.telegram_username || auth.telegram_user_id}`, gestionId]
      );

      // Intentar enviar inmediatamente
      let mensajeFeedback = `✅ Aprobado por ${auth.telegram_username || 'Telegram'}.`;
      try {
        const resultadoEnvio = await enviarGestion(gestionId);
        if (resultadoEnvio.ok) {
          mensajeFeedback += `\n📤 Correo enviado a ${resultadoEnvio.destinatario || 'cliente'}.`;
        } else {
          mensajeFeedback += `\n⚠️ Aprobado pero no se pudo enviar: ${resultadoEnvio.error}`;
        }
      } catch (err) {
        mensajeFeedback += `\n⚠️ Aprobado pero error en envío: ${err instanceof Error ? err.message : 'desconocido'}`;
      }

      // Editar el mensaje original — quitar botones, agregar feedback
      if (cb.message) {
        try {
          await bot.telegram.editMessageReplyMarkup(
            cb.message.chat.id,
            cb.message.message_id,
            undefined,
            undefined
          );
          await bot.telegram.sendMessage(cb.message.chat.id, mensajeFeedback, {
            reply_parameters: { message_id: cb.message.message_id },
          });
        } catch (err) {
          console.error('[callback aprobar] Error editando mensaje:', err);
        }
      }
      await bot.telegram.answerCbQuery(cb.id, '✅ Aprobado');
      return NextResponse.json({ ok: true });
    }

    case 'descartar': {
      await logAccion(
        String(auth.usuario_id),
        'GESTION_DESCARTADA_TELEGRAM',
        'gestion',
        String(gestionId),
        { cliente: gestion.codigo_cliente }
      );
      await cobranzasExecute(
        `UPDATE cobranza_gestiones SET estado='DESCARTADO', motivo_descarte=?, aprobado_por=? WHERE id = ?`,
        ['Descartado desde Telegram', `telegram:${auth.telegram_username || auth.telegram_user_id}`, gestionId]
      );
      if (cb.message) {
        try {
          await bot.telegram.editMessageReplyMarkup(
            cb.message.chat.id,
            cb.message.message_id,
            undefined,
            undefined
          );
          await bot.telegram.sendMessage(cb.message.chat.id, '❌ Gestión descartada.', {
            reply_parameters: { message_id: cb.message.message_id },
          });
        } catch {}
      }
      await bot.telegram.answerCbQuery(cb.id, '❌ Descartado');
      return NextResponse.json({ ok: true });
    }

    case 'editar': {
      if (!cb.message) {
        await bot.telegram.answerCbQuery(cb.id, 'No se puede editar este mensaje');
        return NextResponse.json({ ok: false });
      }
      // Para editar, mostramos un mensaje pidiendo el nuevo texto
      const link = `${process.env.NEXT_PUBLIC_APP_URL || 'https://cobros.sguipak.com'}/cola-aprobacion`;
      await bot.telegram.sendMessage(
        cb.message.chat.id,
        `✏️ Para editar este correo, abre la cola de aprobación en la app:\n${link}\n\nO envía el comando:\n<code>/editar ${gestionId} TU NUEVO TEXTO</code>`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: cb.message.message_id },
        }
      );
      await bot.telegram.answerCbQuery(cb.id, 'Edita en la app');
      return NextResponse.json({ ok: true });
    }

    default:
      await bot.telegram.answerCbQuery(cb.id, 'Acción desconocida');
      return NextResponse.json({ ok: false });
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
        `👋 ¡Hola! Soy el asistente de cobranzas de Guipak.\n\nPuedes preguntarme cosas como:\n• <i>"¿Cuánto debe Master Clean?"</i>\n• <i>"Resumen de cobros hoy"</i>\n• <i>"Genera un correo para Master Clean"</i>\n• <i>"Qué hay pendiente de aprobar"</i>\n• <i>"Promesas vencidas"</i>\n\nMenciona <b>@CobrosGuipakBot</b> en el grupo o háblame en privado.`,
        message.message_id
      );
      return NextResponse.json({ ok: true });

    case '/help':
      await responderMensaje(
        message.chat.id,
        `<b>Comandos disponibles:</b>\n\n/start — Saludo y guía\n/help — Esta ayuda\n/estado — Resumen rápido del día\n\n<b>O pregúntame en lenguaje natural:</b>\n• Consultas de saldo, gestiones pendientes, promesas vencidas\n• "Genera un correo para [cliente]" — yo redacto y tú apruebas con un botón`,
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
      const { texto: textoFinal, gestionId } = extraerGestionPendiente(respuesta);
      const teclado = gestionId ? construirBotonesGestion(gestionId) : undefined;
      await responderMensaje(message.chat.id, textoFinal, message.message_id, teclado);
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
  replyTo?: number,
  teclado?: InlineKeyboardMarkup
): Promise<void> {
  const bot = getTelegraf();
  const opcionesBase: Parameters<typeof bot.telegram.sendMessage>[2] = {
    parse_mode: 'HTML',
    ...(teclado && { reply_markup: teclado }),
  };
  try {
    await bot.telegram.sendMessage(chatId, texto, {
      ...opcionesBase,
      ...(replyTo && replyTo > 0 && { reply_parameters: { message_id: replyTo } }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('reply') || msg.includes('replied')) {
      try {
        await bot.telegram.sendMessage(chatId, texto, opcionesBase);
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
