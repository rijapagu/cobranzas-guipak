import { NextRequest, NextResponse } from 'next/server';
import { resolverUsuarioTelegram, esSupervisor } from '@/lib/telegram/auth';
import { enviarAlertaSupervisor } from '@/lib/supervisor/telegram';
import { conversarSupervisor } from '@/lib/supervisor/conversacion';
import { marcarUpdateVisto } from '@/lib/telegram/idempotency';
import { enHorarioLaboral, descripcionHorarioLaboral } from '@/lib/horario';
import { logAccion } from '@/lib/db/cobranzas';
import { secretoValido } from '@/lib/auth/secrets';

/**
 * Webhook conversacional del Supervisor Cobros (@CobrosSupervisorBot, deepseek).
 *
 * Bot PROPIO, separado del Asistente (@CobrosGuipakBot / Qwen). Aquí el CEO
 * pregunta temas ESTRATÉGICOS y deepseek responde con contexto de cartera.
 *
 * Diferencias clave con el webhook del Asistente:
 *   - Solo chat PRIVADO y solo rol 'supervisor' (es la línea directa del CEO).
 *   - Compuerta de horario INVERTIDA: atiende FUERA del horario laboral (de día
 *     la GPU la usa el Asistente + YOLO/visión; de noche está libre para deepseek).
 *   - No usa Telegraf ni botones: responde por la API directa (mismo emisor que
 *     las alertas push). El texto del modelo se escapa a HTML por seguridad.
 *
 * Idempotencia con namespace 'supervisor' para no colisionar update_id con el
 * otro bot (cada bot tiene su propia secuencia de update_id).
 *
 * Setup (Ricardo, una vez): registrar el webhook del bot Supervisor CON secret_token
 * (debe coincidir con TELEGRAM_WEBHOOK_SECRET del .env — sin él, el webhook rechaza todo):
 *   curl "https://api.telegram.org/bot<SUPERVISOR_BOT_TOKEN>/setWebhook?url=https://cobros.sguipak.com/api/webhooks/telegram-supervisor&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 */

interface TgMessage {
  message_id: number;
  from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

export async function POST(req: NextRequest) {
  // Solo Telegram conoce este secreto (configurado vía setWebhook secret_token).
  // Sin él, el from.id del payload sería falsificable por cualquiera.
  if (
    !secretoValido(
      req.headers.get('x-telegram-bot-api-secret-token'),
      process.env.TELEGRAM_WEBHOOK_SECRET
    )
  ) {
    console.warn('[supervisor-webhook] request rechazado: secret token inválido o ausente');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch (err) {
    console.error('[supervisor-webhook] JSON parse error:', err);
    return NextResponse.json({ ok: true, ignored: 'bad-json' });
  }

  if (typeof update.update_id === 'number') {
    const primeraVez = await marcarUpdateVisto(update.update_id, 'supervisor');
    if (!primeraVez) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  // Procesar en background y ACKear 200 rápido (deepseek puede tardar; si
  // bloqueáramos, Telegram reintenta el update y duplica ejecuciones).
  void procesarUpdate(update).catch((err) => {
    console.error('[supervisor-webhook] background error:', err);
  });

  return NextResponse.json({ ok: true });
}

/** Responde por el bot Supervisor (API directa, parse_mode HTML). */
async function responder(chatId: number, texto: string): Promise<void> {
  try {
    await enviarAlertaSupervisor(chatId, texto);
  } catch (err) {
    console.error('[supervisor-webhook] envío falló:', err);
  }
}

async function procesarUpdate(update: TgUpdate): Promise<void> {
  const message = update.message || update.edited_message;
  if (!message || !message.text || !message.from) return;
  if (message.from.is_bot) return;

  // El Supervisor es la línea directa del CEO: solo privado.
  if (message.chat.type !== 'private') return;

  const texto = message.text.trim();

  // Auth: solo rol 'supervisor' (la dirección).
  const auth = await resolverUsuarioTelegram(message.from.id);
  if (!auth || !esSupervisor(auth)) {
    await responder(
      message.chat.id,
      '⛔ Este es el bot estratégico del Supervisor de Cobros, reservado a la dirección.'
    );
    return;
  }

  // Comandos estáticos (siempre disponibles, no cargan el modelo).
  if (texto.startsWith('/')) {
    const cmd = texto.split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/start' || cmd === '/help') {
      await responder(
        message.chat.id,
        `🧠 <b>Supervisor de Cobros</b> — capa estratégica (deepseek).\n\n` +
          `Pregúntame en lenguaje natural, p. ej.:\n` +
          `• <i>¿Cómo está la cartera?</i>\n` +
          `• <i>¿Qué hago con [cliente]?</i>\n` +
          `• <i>¿A quién priorizo cobrar esta semana?</i>\n\n` +
          `Atiendo <b>fuera del horario laboral</b> (${descripcionHorarioLaboral()}); ` +
          `de día te atiende el Asistente (@CobrosGuipakBot). Las alertas por excepción te llegan a cualquier hora.\n\n` +
          `Solo analizo y recomiendo — la decisión es tuya.`
      );
      return;
    }
    await responder(
      message.chat.id,
      `No reconozco ese comando. Háblame en lenguaje natural (o usa /help).`
    );
    return;
  }

  // Compuerta de horario: el Supervisor atiende FUERA del horario laboral.
  if (enHorarioLaboral()) {
    await responder(
      message.chat.id,
      `🌙 Estoy en modo reposo durante el horario laboral (${descripcionHorarioLaboral()}). ` +
        `De día te atiende el Asistente (@CobrosGuipakBot) para lo operativo; yo te respondo ` +
        `temas estratégicos fuera de ese horario. Las alertas por excepción te siguen llegando a cualquier hora.`
    );
    return;
  }

  // Consulta a deepseek con contexto de cartera.
  try {
    const { text, model, latencyMs } = await conversarSupervisor(texto);
    await responder(message.chat.id, escapeHtml(text));
    await logAccion(
      String(auth.usuario_id),
      'SUPERVISOR_CHAT_QUERY',
      'telegram',
      String(message.message_id),
      { texto: texto.slice(0, 500), model, latency_ms: latencyMs }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await responder(
      message.chat.id,
      `⚠️ No pude consultar el modelo ahora (${escapeHtml(msg.slice(0, 150))}). ` +
        `¿La PC de Robocop (gateway IA) está encendida?`
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'Webhook conversacional del Supervisor Cobros (deepseek)',
    timestamp: new Date().toISOString(),
  });
}
