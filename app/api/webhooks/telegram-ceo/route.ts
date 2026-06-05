import { NextRequest, NextResponse } from 'next/server';
import { resolverUsuarioTelegram, esSupervisor } from '@/lib/telegram/auth';
import { enviarPorBot } from '@/lib/supervisor/telegram';
import { resolverArea, AREAS } from '@/lib/ceo/registry';
import { marcarUpdateVisto } from '@/lib/telegram/idempotency';
import { enHorarioLaboral, descripcionHorarioLaboral } from '@/lib/horario';
import { logAccion } from '@/lib/db/cobranzas';

/**
 * Webhook del CEO orquestador (@GuipakCeoBot) — meta-supervisor conversacional.
 *
 * Línea conversacional ÚNICA del CEO (arquitectura híbrida 2026-06-05): los bots
 * por área (@CobrosSupervisorBot, etc.) emiten ALERTAS push con su voz; este bot
 * CEO recibe las PREGUNTAS del CEO y las enruta al área correcta (lib/ceo/registry),
 * que responde con su modelo + contexto. v1 enruta todo a Cobros (única área con
 * cerebro de supervisor por ahora); añadir áreas = registrar en registry.ts.
 *
 * Igual que el bot Supervisor: privado, solo rol 'supervisor' (CEO), compuerta de
 * horario (deepseek atiende fuera del horario laboral), idempotencia namespace 'ceo'.
 *
 * Setup (Ricardo, una vez):
 *   1. BotFather → /newbot → @GuipakCeoBot → copiar token.
 *   2. /start al bot desde tu cuenta.
 *   3. CEO_BOT_TOKEN en Dokploy (env del servicio cobranzas-guipak).
 *   4. Registrar webhook:
 *      https://api.telegram.org/bot<CEO_BOT_TOKEN>/setWebhook?url=https://cobros.sguipak.com/api/webhooks/telegram-ceo
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
  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch (err) {
    console.error('[ceo-webhook] JSON parse error:', err);
    return NextResponse.json({ ok: true, ignored: 'bad-json' });
  }

  if (typeof update.update_id === 'number') {
    const primeraVez = await marcarUpdateVisto(update.update_id, 'ceo');
    if (!primeraVez) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  }

  void procesarUpdate(update).catch((err) => {
    console.error('[ceo-webhook] background error:', err);
  });

  return NextResponse.json({ ok: true });
}

async function responder(chatId: number, texto: string): Promise<void> {
  const token = process.env.CEO_BOT_TOKEN;
  if (!token) {
    console.error('[ceo-webhook] CEO_BOT_TOKEN no configurado — no se puede responder');
    return;
  }
  try {
    await enviarPorBot(token, chatId, texto);
  } catch (err) {
    console.error('[ceo-webhook] envío falló:', err);
  }
}

async function procesarUpdate(update: TgUpdate): Promise<void> {
  const message = update.message || update.edited_message;
  if (!message || !message.text || !message.from) return;
  if (message.from.is_bot) return;
  if (message.chat.type !== 'private') return;

  const texto = message.text.trim();

  const auth = await resolverUsuarioTelegram(message.from.id);
  if (!auth || !esSupervisor(auth)) {
    await responder(
      message.chat.id,
      '⛔ Este es el bot del CEO de Guipak, reservado a la dirección.'
    );
    return;
  }

  // Comandos estáticos.
  if (texto.startsWith('/')) {
    const cmd = texto.split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/start' || cmd === '/help') {
      const areasTxt = AREAS.map((a) => `• <b>${a.label}</b>`).join('\n');
      await responder(
        message.chat.id,
        `🎩 <b>CEO Guipak</b> — supervisor orquestador.\n\n` +
          `Pregúntame y enruto a la(s) área(s) correspondiente(s). Áreas conectadas:\n${areasTxt}\n\n` +
          `Ej.: <i>¿Cómo está la cartera?</i> · <i>¿Qué hago con [cliente]?</i>\n\n` +
          `Atiendo <b>fuera del horario laboral</b> (${descripcionHorarioLaboral()}); ` +
          `de día, lo operativo lo ve el Asistente. Solo analizo y recomiendo — decides tú.`
      );
      return;
    }
    await responder(message.chat.id, `No reconozco ese comando. Háblame en lenguaje natural (o /help).`);
    return;
  }

  // Compuerta de horario: el CEO (deepseek) atiende fuera del horario laboral.
  if (enHorarioLaboral()) {
    await responder(
      message.chat.id,
      `🌙 Estoy en modo reposo durante el horario laboral (${descripcionHorarioLaboral()}). ` +
        `De día, lo operativo lo atiende el Asistente. Te respondo temas estratégicos fuera de ese horario. ` +
        `Las alertas por excepción te siguen llegando a cualquier hora.`
    );
    return;
  }

  // Enrutar al área y responder.
  try {
    const { area, matched } = resolverArea(texto);
    const { text, model, latencyMs } = await area.conversar(texto);

    // Prefijo con el área que respondió (y aviso si fue default por falta de match).
    const prefijo = matched
      ? `📊 <b>${area.label}</b>\n\n`
      : `📊 <b>${area.label}</b> <i>(área por defecto)</i>\n\n`;
    await responder(message.chat.id, prefijo + escapeHtml(text));

    await logAccion(
      String(auth.usuario_id),
      'CEO_CHAT_QUERY',
      'telegram',
      String(message.message_id),
      { texto: texto.slice(0, 500), area: area.key, matched, model, latency_ms: latencyMs }
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
    info: 'Webhook del CEO orquestador (meta-supervisor)',
    areas: AREAS.map((a) => a.key),
    timestamp: new Date().toISOString(),
  });
}
