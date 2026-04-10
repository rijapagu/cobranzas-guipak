import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

/**
 * POST /api/webhooks/whatsapp
 * Recibe actualizaciones de estado de Evolution API.
 * No requiere session auth (viene de Evolution API).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Evolution API envía diferentes tipos de eventos
    const event = body.event;
    const data = body.data;

    if (!data) {
      return NextResponse.json({ ok: true });
    }

    // Mapear estados de Evolution API a nuestros estados
    const statusMap: Record<string, string> = {
      'DELIVERY_ACK': 'ENTREGADO',
      'READ': 'LEIDO',
      'PLAYED': 'LEIDO',
      'ERROR': 'FALLIDO',
      'FAILED': 'FALLIDO',
    };

    if (event === 'messages.update' || event === 'message-receipt.update') {
      const messageId = data.key?.id || data.messageId;
      const status = data.status || data.update?.status;

      if (!messageId || !status) {
        return NextResponse.json({ ok: true });
      }

      const nuevoEstado = statusMap[status];
      if (!nuevoEstado) {
        return NextResponse.json({ ok: true });
      }

      // Buscar conversación por whatsapp_message_id
      const convs = await cobranzasQuery<{ id: number; estado: string }>(
        'SELECT id, estado FROM cobranza_conversaciones WHERE whatsapp_message_id = ? LIMIT 1',
        [messageId]
      );

      if (convs.length > 0) {
        await cobranzasExecute(
          'UPDATE cobranza_conversaciones SET estado = ? WHERE id = ?',
          [nuevoEstado, convs[0].id]
        );

        await logAccion(null, 'WA_STATUS_UPDATE', 'conversacion', convs[0].id.toString(), {
          message_id: messageId,
          old_status: convs[0].estado,
          new_status: nuevoEstado,
        });
      }
    }

    // Mensajes entrantes (respuestas de clientes)
    if (event === 'messages.upsert') {
      const fromNumber = data.key?.remoteJid?.replace('@s.whatsapp.net', '') || '';
      const messageText = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      const fromMe = data.key?.fromMe || false;

      // Solo procesar mensajes de clientes (no los nuestros)
      if (fromNumber && messageText && !fromMe) {
        console.log('[WEBHOOK-WA] Mensaje entrante de:', fromNumber, '| Texto:', messageText.substring(0, 50));

        // Procesar con IA — la respuesta va a cola de aprobación (CP-02)
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          await fetch(`${baseUrl}/api/cobranzas/procesar-respuesta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telefono: fromNumber,
              mensaje: messageText,
              canal: 'WHATSAPP',
            }),
          });
        } catch (err) {
          console.error('[WEBHOOK-WA] Error procesando respuesta:', err);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[WEBHOOK-WA] Error:', error);
    return NextResponse.json({ ok: true }); // Siempre 200 para Evolution API
  }
}
