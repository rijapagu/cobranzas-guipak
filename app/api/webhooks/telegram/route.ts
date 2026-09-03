import { NextRequest, NextResponse } from 'next/server';
import { resolverUsuarioTelegram, esSupervisor } from '@/lib/telegram/auth';
import { procesarMensajeBot } from '@/lib/telegram/agent';
import { getTelegraf } from '@/lib/telegram/client';
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import { aprobarGestion, descartarGestion } from '@/lib/telegram/gestion-acciones';
import { limpiarSesion } from '@/lib/telegram/session';
import { marcarUpdateVisto } from '@/lib/telegram/idempotency';
import { enHorarioLaboral, descripcionHorarioLaboral } from '@/lib/horario';
import { secretoValido } from '@/lib/auth/secrets';
import { cargarExtracto } from '@/lib/conciliacion/cargar';
import { listarDepositosPendientes } from '@/lib/conciliacion/acciones';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
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
  caption?: string;
  document?: {
    file_id: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  };
  reply_to_message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; username?: string };
  };
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
 *
 * El procesamiento real (LLM, DB, envío de mensajes) corre en background
 * para que el webhook ACKee con 200 OK en menos de 1s. Si bloqueáramos
 * esperando al LLM (1-3 min con qwen-deep), Telegram interpreta timeout
 * y retransmite el update, disparando ejecuciones duplicadas.
 *
 * Idempotencia por update_id en Redis (24h) — si Telegram igual retransmite
 * antes del ACK, las réplicas se descartan.
 */
export async function POST(req: NextRequest) {
  // Solo Telegram conoce este secreto (configurado vía setWebhook secret_token).
  // Sin él, el from.id del payload sería falsificable por cualquiera.
  if (
    !secretoValido(
      req.headers.get('x-telegram-bot-api-secret-token'),
      process.env.TELEGRAM_WEBHOOK_SECRET
    )
  ) {
    console.warn('[telegram-webhook] request rechazado: secret token inválido o ausente');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (err) {
    console.error('[telegram-webhook] JSON parse error:', err);
    return NextResponse.json({ ok: true, ignored: 'bad-json' });
  }

  if (typeof update.update_id === 'number') {
    const primeraVez = await marcarUpdateVisto(update.update_id);
    if (!primeraVez) {
      console.info(
        `[telegram-webhook] retry descartado update_id=${update.update_id}`
      );
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  void procesarUpdate(update).catch((err) => {
    console.error('[telegram-webhook] background error:', err);
  });

  return NextResponse.json({ ok: true });
}

async function procesarUpdate(update: TelegramUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await manejarCallback(update.callback_query);
      return;
    }

    const message = update.message || update.edited_message;
    if (!message || !message.from) return;
    if (message.from.is_bot) return;

    // Un documento no lleva `text`, así que esto va ANTES del filtro de abajo:
    // hasta ahora todo adjunto se descartaba en silencio.
    if (message.document) {
      await manejarDocumento(message);
      return;
    }

    if (!message.text) return;

    const chatIdGrupo = process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS;
    const esGrupoAutorizado = chatIdGrupo && String(message.chat.id) === chatIdGrupo;
    const esChatPrivado = message.chat.type === 'private';
    if (!esGrupoAutorizado && !esChatPrivado) return;

    const texto = message.text.trim();
    let textoLimpio = texto;
    if (esGrupoAutorizado) {
      const mencionaBot = texto.includes(BOT_USERNAME_PREFIX);
      const esComando = texto.startsWith('/');
      // Responder a un mensaje del bot cuenta como mención: es como el usuario
      // sigue una conversación ya iniciada ("el 512 es de Padrón" respondiendo
      // al mensaje del bot que pidió el extracto o listó los depósitos), sin
      // tener que escribir @CobrosGuipakBot cada vez.
      const esRespuestaAlBot =
        message.reply_to_message?.from?.is_bot === true &&
        message.reply_to_message.from.username === BOT_USERNAME_PREFIX.slice(1);
      if (!mencionaBot && !esComando && !esRespuestaAlBot) return;
      textoLimpio = texto.replace(BOT_USERNAME_PREFIX, '').trim();
    }

    if (textoLimpio.startsWith('/')) {
      await manejarComando(textoLimpio, message);
      return;
    }

    const auth = await resolverUsuarioTelegram(message.from.id);
    if (!auth) {
      await responderMensaje(
        message.chat.id,
        '⛔ No estás autorizado. Pídele a Ricardo que te dé acceso.',
        message.message_id
      );
      return;
    }

    // Compuerta de horario: SOLO en el grupo, y solo por herencia histórica del
    // time-share de la GPU local (Qwen de día, deepseek de noche). Con Anthropic
    // ese conflicto no existe (2026-09-03) — los chats PRIVADOS ya atienden 24/7.
    // El grupo la mantiene porque sigue siendo un canal compartido por todo el
    // equipo y de uso operativo, no por límite técnico.
    if (esGrupoAutorizado && !enHorarioLaboral()) {
      await responderMensaje(
        message.chat.id,
        `🌙 Estoy fuera de mi horario de atención en el grupo (${descripcionHorarioLaboral()}). ` +
          `Escríbeme por privado si es urgente, o para temas estratégicos te atiende el Supervisor (@CobrosSupervisorBot).`,
        message.message_id
      );
      return;
    }

    const respuesta = await procesarMensajeBot({
      texto: textoLimpio,
      user: auth,
      chatId: message.chat.id,
      telegramUserId: message.from.id,
    });

    const { texto: textoFinal, gestionId } = extraerGestionPendiente(respuesta);
    const teclado = gestionId ? construirBotonesGestion(gestionId) : undefined;

    await responderMensaje(message.chat.id, textoFinal, message.message_id, teclado);

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
  } catch (error) {
    const { logError } = await import('@/lib/db/cobranzas');
    await logError('telegram-webhook', error, { update_id: update.update_id });
    const chatId =
      update.message?.chat.id ??
      update.edited_message?.chat.id ??
      update.callback_query?.message?.chat.id;
    if (chatId) {
      await responderMensaje(
        chatId,
        '⚠️ Ocurrió un error procesando tu mensaje. El detalle quedó registrado en los logs del sistema.'
      ).catch(() => {});
    }
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
    // Guard de entrada (bot solo-Guipak): hace tenant-safe los UPDATE por id posteriores
    'SELECT id, estado, codigo_cliente, saldo_pendiente, asunto_email, mensaje_propuesto_email FROM cobranza_gestiones WHERE id = ? AND empresa_id = 1',
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

  // Paridad de privilegios con el endpoint web /gestiones/[id]/aprobar (que
  // exige ADMIN/SUPERVISOR): aprobar dispara el envío al cliente y descartar
  // cierra la gestión, así que ambos requieren rol supervisor. El rol por
  // defecto en cobranza_telegram_usuarios es agente_cobros (no supervisor).
  if ((accion === 'aprobar' || accion === 'descartar') && !esSupervisor(auth)) {
    await bot.telegram.answerCbQuery(
      cb.id,
      '⛔ Solo un supervisor puede aprobar o descartar gestiones.',
      { show_alert: true }
    );
    return NextResponse.json({ ok: true, sin_permiso: true });
  }

  switch (accion) {
    case 'aprobar': {
      // Delega en gestion-acciones.ts (compartida con la tool aprobar_gestion
      // del agente conversacional) para que botón y texto libre nunca diverjan.
      const resultado = await aprobarGestion(gestionId, {
        userId: String(auth.usuario_id),
        userEmail: `telegram:${auth.telegram_username || auth.telegram_user_id}`,
        esSupervisor: true, // ya verificado arriba antes del switch
      });
      const mensajeFeedback = `${resultado.ok ? '✅' : '⚠️'} ${resultado.mensaje}`;

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
      await bot.telegram.answerCbQuery(cb.id, resultado.ok ? '✅ Aprobado' : '⚠️ No se pudo aprobar');
      return NextResponse.json({ ok: resultado.ok });
    }

    case 'descartar': {
      const resultado = await descartarGestion(
        gestionId,
        {
          userId: String(auth.usuario_id),
          userEmail: `telegram:${auth.telegram_username || auth.telegram_user_id}`,
          esSupervisor: true, // ya verificado arriba antes del switch
        },
        'Descartado desde Telegram'
      );
      if (cb.message) {
        try {
          await bot.telegram.editMessageReplyMarkup(
            cb.message.chat.id,
            cb.message.message_id,
            undefined,
            undefined
          );
          await bot.telegram.sendMessage(
            cb.message.chat.id,
            `${resultado.ok ? '❌' : '⚠️'} ${resultado.mensaje}`,
            { reply_parameters: { message_id: cb.message.message_id } }
          );
        } catch {}
      }
      await bot.telegram.answerCbQuery(cb.id, resultado.ok ? '❌ Descartado' : '⚠️ No se pudo descartar');
      return NextResponse.json({ ok: resultado.ok });
    }

    case 'editar': {
      if (!cb.message) {
        await bot.telegram.answerCbQuery(cb.id, 'No se puede editar este mensaje');
        return NextResponse.json({ ok: false });
      }
      // Para editar, escríbeme en texto libre — no hay comando /editar; lo
      // resuelve el agente conversacional con la tool editar_gestion.
      const link = `${process.env.NEXT_PUBLIC_APP_URL || 'https://cobros.sguipak.com'}/cola-aprobacion`;
      await bot.telegram.sendMessage(
        cb.message.chat.id,
        `✏️ Escríbeme qué cambiar, por ejemplo:\n<code>edita la gestión ${gestionId}: cambia el asunto a "..."</code>\n\nO ábrela en la app: ${link}`,
        {
          parse_mode: 'HTML',
          reply_parameters: { message_id: cb.message.message_id },
        }
      );
      await bot.telegram.answerCbQuery(cb.id, 'Escríbeme el cambio');
      return NextResponse.json({ ok: true });
    }

    default:
      await bot.telegram.answerCbQuery(cb.id, 'Acción desconocida');
      return NextResponse.json({ ok: false });
  }
}

/** Formatos que el parser de extractos sabe leer hoy. PDF todavía no. */
const EXTENSIONES_EXTRACTO = /\.(xlsx|xls|csv|txt)$/i;
/** Telegram ya limita a 20 MB por getFile; 10 basta de sobra para un extracto. */
const MAX_EXTRACTO_BYTES = 10 * 1024 * 1024;

/**
 * Extracto bancario enviado como adjunto.
 *
 * Entra por la MISMA puerta que la pantalla de Conciliación
 * (`lib/conciliacion/cargar.ts`) y con el mismo permiso: solo ADMIN/SUPERVISOR.
 * El rol del chat se deriva del rol de la app, así que `esSupervisor` equivale
 * exactamente al guard de la ruta HTTP — nadie tiene por chat lo que no tiene
 * en la web.
 *
 * El bot NO actúa por su cuenta: carga el extracto EN NOMBRE de quien lo envió,
 * y así queda en `cargado_por` y en la bitácora.
 */
async function manejarDocumento(message: TelegramMessage): Promise<void> {
  const doc = message.document;
  if (!doc || !message.from) return;

  const nombre = doc.file_name || 'archivo';
  const chatId = message.chat.id;

  if (!EXTENSIONES_EXTRACTO.test(nombre)) {
    const esPdf = /\.pdf$/i.test(nombre);
    await responderMensaje(
      chatId,
      esPdf
        ? `📄 Recibí <b>${nombre}</b>, pero todavía no sé leer PDF.\n\nPídele al banco el extracto en <b>Excel</b> o <b>CSV</b> y te lo concilio en el momento.`
        : `📎 Recibí <b>${nombre}</b>, pero no reconozco ese formato.\n\nPara conciliar necesito el extracto bancario en <b>.xlsx</b> o <b>.csv</b>.`,
      message.message_id
    );
    return;
  }

  const auth = await resolverUsuarioTelegram(message.from.id);
  if (!auth) {
    await responderMensaje(
      chatId,
      '⛔ No estás autorizado. Pídele a Ricardo que te dé acceso.',
      message.message_id
    );
    return;
  }
  if (!esSupervisor(auth)) {
    await responderMensaje(
      chatId,
      '⛔ Cargar un extracto bancario está reservado a supervisores.',
      message.message_id
    );
    return;
  }

  if (doc.file_size && doc.file_size > MAX_EXTRACTO_BYTES) {
    await responderMensaje(
      chatId,
      `El archivo pesa ${(doc.file_size / 1024 / 1024).toFixed(1)} MB y el límite son 10 MB. Súbelo desde la pantalla de Conciliación.`,
      message.message_id
    );
    return;
  }

  await responderMensaje(chatId, `📥 Recibido <b>${nombre}</b>. Dame un momento…`, message.message_id);

  try {
    const enlace = await getTelegraf().telegram.getFileLink(doc.file_id);
    const respuesta = await fetch(enlace.href);
    if (!respuesta.ok) throw new Error(`descarga falló: HTTP ${respuesta.status}`);
    const buffer = Buffer.from(await respuesta.arrayBuffer());

    const usuarios = await cobranzasQuery<{ email: string }>(
      'SELECT email FROM usuarios WHERE id = ? LIMIT 1',
      [auth.usuario_id]
    );

    // El banco puede venir en el pie de foto ("BHD", "Popular"); si no, el
    // parser ya detecta Banco Popular solo y el resto queda sin especificar.
    const banco = (message.caption || '').trim().slice(0, 60) || 'Sin especificar';

    // Si el chat es el grupo, cargarExtracto NO manda su propio resumen al
    // grupo (notificarGrupo:false) — esta misma respuesta YA es al grupo, y
    // antes salían dos mensajes iguales (el detallado y el de montos).
    const esGrupoDelDocumento =
      String(chatId) === (process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS ?? '');

    const r = await cargarExtracto(
      buffer,
      nombre,
      banco,
      {
        userId: auth.usuario_id,
        email: usuarios[0]?.email || `telegram:${message.from.id}`,
        empresaId: EMPRESA_GUIPAK,
      },
      { notificarGrupo: !esGrupoDelDocumento }
    );

    if (!r.huboNovedad) {
      await responderMensaje(chatId, `ℹ️ ${r.mensaje}`);
      return;
    }

    const lineas = [
      `✅ <b>Extracto conciliado</b> — ${nombre}`,
      ``,
      `• <b>${r.conciliadas}</b> conciliadas solas`,
      `• <b>${r.porAplicar}</b> por aplicar`,
      `• <b>${r.desconocidas}</b> sin dueño — necesito que me digas de quién son`,
    ];
    if (r.multiRecibo > 0) lineas.push(`• ${r.multiRecibo} depósitos que cubren varios recibos`);
    if (r.duplicadasOmitidas > 0) lineas.push(`• ${r.duplicadasOmitidas} ya estaban, no se duplicaron`);
    if (r.chequesDevueltos.length > 0) {
      lineas.push(
        ``,
        `⚠️ <b>${r.chequesDevueltos.length} cheque(s) devuelto(s)</b> por ${r.montoDevuelto.toLocaleString('es-DO', { minimumFractionDigits: 2 })}.`,
        `Hay que desaplicarlos en Softec — eso lo hace una persona allá, ni la app ni yo tocamos el ERP.`
      );
    }
    if (r.tareasCreadas > 0) lineas.push(``, `Te dejé ${r.tareasCreadas} tarea(s) en <b>Tareas</b>.`);

    // Lista real con ids — antes esto invitaba a preguntar "¿qué depósitos
    // quedaron sin dueño?" sin que ninguna tool respaldara esa pregunta.
    if (r.desconocidas > 0) {
      const sinDueno = await listarDepositosPendientes({
        archivo: nombre,
        estado: 'DESCONOCIDO',
        limite: 10,
      });
      lineas.push(``, `<b>Sin dueño:</b>`);
      for (const d of sinDueno) {
        const monto = Number(d.monto).toLocaleString('es-DO', { minimumFractionDigits: 2 });
        lineas.push(`  #${d.id} — RD$${monto} — ${(d.descripcion || '').slice(0, 40)}`);
      }
      lineas.push(
        ``,
        `Respóndeme a este mensaje diciendo de quién es cada uno (ej. <i>"el ${sinDueno[0]?.id ?? '512'} es de Padrón Office"</i>) y lo aplico.`
      );
    }

    await responderMensaje(chatId, lineas.join('\n'));
  } catch (error) {
    const { logError } = await import('@/lib/db/cobranzas');
    await logError('telegram-extracto', error, { archivo: nombre, from: message.from.id });
    const detalle = error instanceof Error ? error.message : String(error);
    await responderMensaje(
      chatId,
      `❌ No pude procesar <b>${nombre}</b>.\n<code>${detalle.slice(0, 200)}</code>\n\nSi el archivo está bien, súbelo desde la pantalla de Conciliación.`
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
        `👋 ¡Hola! Soy el asistente de cobranzas de Guipak.\n\nPuedes preguntarme cosas como:\n• <i>"¿Cuánto debe Master Clean?"</i>\n• <i>"Resumen de cobros hoy"</i>\n• <i>"Genera un correo para Master Clean"</i>\n• <i>"Qué hay pendiente de aprobar"</i>\n• <i>"Promesas vencidas"</i>\n\nMenciona <b>@CobrosGuipakBot</b> en el grupo o háblame en privado.`,
        message.message_id
      );
      return NextResponse.json({ ok: true });

    // Antes del control de acceso a propósito: este comando sirve JUSTAMENTE
    // para quien todavía no tiene acceso. Solo revela el id de quien pregunta
    // —lo mismo que ya hace cualquier bot público tipo @userinfobot—, así que
    // no expone nada que Telegram no diera igual. Sin él, dar de alta a alguien
    // obliga a tener su teléfono en la mano.
    case '/id': {
      const id = message.from?.id;
      const alias = message.from?.username;
      await responderMensaje(
        message.chat.id,
        id
          ? `🪪 Tu <b>Id de Telegram</b> es <code>${id}</code>\n` +
            (alias
              ? `Tu usuario es <code>${alias}</code> (se guarda sin la @).\n`
              : `No tienes usuario de Telegram puesto — no hace falta, con el Id basta.\n`) +
            `\nPásale el Id a Ricardo para que te dé acceso en <b>Usuarios</b>.`
          : 'No pude leer tu Id. Háblame por chat privado.',
        message.message_id
      );
      return NextResponse.json({ ok: true });
    }

    case '/help':
      await responderMensaje(
        message.chat.id,
        `<b>Comandos disponibles:</b>\n\n/start — Saludo y guía\n/help — Esta ayuda\n/id — Tu Id de Telegram (para pedir acceso)\n/estado — Resumen rápido del día\n/olvidar — Olvida el cliente activo de esta conversación\n\n<b>O pregúntame en lenguaje natural:</b>\n• Consultas de saldo, gestiones pendientes, promesas vencidas\n• "Genera un correo para [cliente]" — yo redacto y tú apruebas con un botón`,
        message.message_id
      );
      return NextResponse.json({ ok: true });

    // El cliente activo de la sesión ya caduca solo (ver lib/telegram/session.ts),
    // pero a veces conviene soltarlo antes de que pase el TTL — ej. si acabas de
    // preguntar por un cliente y quieres hacer ya una pregunta de cartera completa.
    case '/olvidar':
      await limpiarSesion(message.chat.id);
      await responderMensaje(
        message.chat.id,
        '🧹 Listo, olvidé el cliente activo de esta conversación.',
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
      // Horario solo aplica en el grupo (ver comentario en procesarUpdate) — los
      // chats privados atienden 24/7.
      const esGrupoDeEstado =
        String(message.chat.id) === (process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS ?? '');
      if (esGrupoDeEstado && !enHorarioLaboral()) {
        await responderMensaje(
          message.chat.id,
          `🌙 Fuera de horario en el grupo (${descripcionHorarioLaboral()}). De noche te atiende el Supervisor (@CobrosSupervisorBot).`,
          message.message_id
        );
        return NextResponse.json({ ok: true });
      }
      const respuesta = await procesarMensajeBot({
        texto: 'Dame el estado de cobros de hoy.',
        user: auth,
        chatId: message.chat.id,
        telegramUserId: message.from?.id ?? 0,
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
