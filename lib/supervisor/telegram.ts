/**
 * Emisor de Telegram DEDICADO del Supervisor Cobros.
 *
 * Usa un bot PROPIO (token SUPERVISOR_BOT_TOKEN), distinto del bot del Asistente
 * (@CobrosGuipakBot / TELEGRAM_BOT_TOKEN). Razón: separar la identidad y la voz
 * de la capa estratégica (Supervisor → CEO, privado, deepseek) de la operativa
 * (Asistente → equipo, grupo, Qwen). Así, si el Supervisor se vuelve conversacional
 * en el futuro, sus respuestas no las intercepta el handler del Asistente.
 *
 * Hoy es PUSH-ONLY: solo envía alertas, no escucha. Por eso no necesita Telegraf
 * ni webhook — basta una llamada directa a la API de Telegram.
 *
 * Setup (Ricardo):
 *   1. BotFather → /newbot → nombre p.ej. "Supervisor Cobros Guipak" → @CobrosSupervisorBot
 *   2. Enviarle /start al bot nuevo desde tu cuenta (un bot no puede iniciar el
 *      chat; tú debes escribirle primero para que pueda mandarte DMs).
 *   3. Poner el token en Dokploy como SUPERVISOR_BOT_TOKEN.
 *
 * El chat_id privado (TELEGRAM_USER_RICARDO = 7281538057) es tu ID de usuario y
 * es el MISMO para cualquier bot, una vez que le diste /start.
 */

export async function enviarAlertaSupervisor(
  chatId: string | number,
  texto: string
): Promise<number> {
  const token = process.env.SUPERVISOR_BOT_TOKEN;
  if (!token) {
    throw new Error('SUPERVISOR_BOT_TOKEN no configurado');
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: texto,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number };
  };

  if (!res.ok || !data.ok) {
    throw new Error(`Telegram Supervisor ${res.status}: ${data.description ?? 'error desconocido'}`);
  }

  return data.result?.message_id ?? 0;
}
