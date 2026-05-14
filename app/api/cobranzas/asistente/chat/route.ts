import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { procesarMensajeBot } from '@/lib/telegram/agent';
import type { TelegramUserAuth } from '@/lib/telegram/auth';

/**
 * POST /api/cobranzas/asistente/chat
 * Procesa un mensaje del chat web con el mismo agente del bot de Telegram.
 * Devuelve la respuesta del agente y extrae el gestion_id si viene con
 * una propuesta pendiente de aprobación.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const mensaje = String(body.mensaje || '').trim();
    if (!mensaje) {
      return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 });
    }
    if (mensaje.length > 2000) {
      return NextResponse.json({ error: 'Mensaje demasiado largo' }, { status: 400 });
    }

    // Adaptar sesión web al formato TelegramUserAuth que espera el agente
    const webUser: TelegramUserAuth = {
      id: session.userId,
      telegram_user_id: 0,
      telegram_username: session.nombre || session.email?.split('@')[0] || null,
      usuario_id: session.userId,
      rol: (session.rol === 'ADMIN' || session.rol === 'SUPERVISOR')
        ? 'supervisor'
        : 'agente_cobros',
      activo: 1,
    };

    // chatId negativo ficticio por usuario para separar historial web del de Telegram
    const webChatId = -(session.userId);
    const respuesta = await procesarMensajeBot({
      texto: mensaje,
      user: webUser,
      chatId: webChatId,
      telegramUserId: 0,
    });

    // Extraer <gestion-pendiente id="N"/> si existe
    const match = respuesta.match(/<gestion-pendiente\s+id="(\d+)"\s*\/>/);
    const gestion_id = match ? Number(match[1]) : null;
    const texto = respuesta.replace(/<gestion-pendiente\s+id="\d+"\s*\/>/g, '').trim();

    return NextResponse.json({ respuesta: texto, gestion_id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ASISTENTE-CHAT]', msg, error);
    return NextResponse.json(
      { error: `Error procesando mensaje: ${msg}` },
      { status: 500 }
    );
  }
}
