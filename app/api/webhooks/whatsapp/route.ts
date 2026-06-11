import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { procesarRespuestaCliente } from '@/lib/cobranzas/procesar-respuesta';
import { secretoValido } from '@/lib/auth/secrets';

/**
 * Extrae el número de teléfono del cliente desde la `key` del mensaje de Evolution.
 *
 * WhatsApp introdujo LID (Linked Identifier) como nuevo formato de privacidad —
 * el `remoteJid` puede ser `XXXXXXXXX@lid` (sin número). En ese caso, el número
 * real va en `remoteJidAlt: "<num>@s.whatsapp.net"`.
 *
 * Devuelve solo dígitos (ej. "18098536995") o '' si no se puede determinar.
 */
function extraerNumero(key: {
  remoteJid?: string;
  remoteJidAlt?: string;
  addressingMode?: string;
} | undefined): string {
  if (!key) return '';

  // Si addressingMode='lid' o el JID es @lid, preferir remoteJidAlt
  const esLid =
    key.addressingMode === 'lid' || key.remoteJid?.endsWith('@lid');

  const jid = esLid && key.remoteJidAlt ? key.remoteJidAlt : key.remoteJid;
  if (!jid) return '';

  // Si todavía es @lid (sin remoteJidAlt), no tenemos número real → vacío
  if (jid.endsWith('@lid')) return '';

  // Quitar sufijo @s.whatsapp.net o @c.us, quedarnos con dígitos
  return jid.split('@')[0].replace(/[^0-9]/g, '');
}

/**
 * POST /api/webhooks/whatsapp
 * Recibe actualizaciones de estado de Evolution API.
 * No requiere session auth, pero SÍ exige EVOLUTION_WEBHOOK_TOKEN:
 * configurar la URL del webhook en Evolution como
 *   https://<app>/api/webhooks/whatsapp?token=<EVOLUTION_WEBHOOK_TOKEN>
 * (o enviar el header x-webhook-token).
 */
export async function POST(request: NextRequest) {
  const tokenRecibido =
    request.headers.get('x-webhook-token') ||
    request.nextUrl.searchParams.get('token');
  if (!secretoValido(tokenRecibido, process.env.EVOLUTION_WEBHOOK_TOKEN)) {
    console.warn('[WEBHOOK-WA] request rechazado: token inválido o ausente');
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

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
        'SELECT id, estado FROM cobranza_conversaciones WHERE empresa_id = 1 AND whatsapp_message_id = ? LIMIT 1',
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
      const fromNumber = extraerNumero(data.key);
      const messageText = data.message?.conversation || data.message?.extendedTextMessage?.text || '';
      const fromMe = data.key?.fromMe || false;
      const pushName = data.pushName || '';
      const isLid = data.key?.addressingMode === 'lid' || data.key?.remoteJid?.endsWith('@lid');

      if (!fromMe && messageText) {
        if (fromNumber) {
          console.log('[WEBHOOK-WA] Mensaje entrante de:', fromNumber, isLid ? '(via LID)' : '', '| Texto:', messageText.substring(0, 50));

          // Procesar con IA — la respuesta va a cola de aprobación (CP-02).
          // Llamada directa a la lib (antes era un fetch HTTP a una ruta pública).
          try {
            await procesarRespuestaCliente({
              telefono: fromNumber,
              mensaje: messageText,
              canal: 'WHATSAPP',
            });
          } catch (err) {
            console.error('[WEBHOOK-WA] Error procesando respuesta:', err);
          }
        } else {
          // Mensaje LID sin número resoluble — guardar para que un humano lo asocie
          console.warn('[WEBHOOK-WA] Mensaje LID sin remoteJidAlt — guardando como huérfano. JID:', data.key?.remoteJid, '| pushName:', pushName);
          await logAccion(
            null,
            'WA_HUERFANO',
            'webhook',
            data.key?.id || 'sin-id',
            {
              remoteJid: data.key?.remoteJid,
              pushName,
              texto: messageText.substring(0, 500),
            }
          );
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[WEBHOOK-WA] Error:', error);
    return NextResponse.json({ ok: true }); // Siempre 200 para Evolution API
  }
}
