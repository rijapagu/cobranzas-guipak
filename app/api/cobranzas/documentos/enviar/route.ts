import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion } from '@/lib/tenant';
import { enviarFacturaCliente } from '@/lib/cobranzas/enviar-factura';

/**
 * POST /api/cobranzas/documentos/enviar
 * Envía una factura PDF a un cliente por email o WhatsApp.
 *
 * La lógica vive en lib/cobranzas/enviar-factura.ts — compartida con la tool
 * enviar_factura_cliente del agente conversacional.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { documento_id, canal, destinatario } = await request.json();

    if (!documento_id || !canal || !destinatario) {
      return NextResponse.json(
        { error: 'Campos requeridos: documento_id, canal (EMAIL|WHATSAPP), destinatario' },
        { status: 400 }
      );
    }

    if (canal !== 'EMAIL' && canal !== 'WHATSAPP') {
      return NextResponse.json({ error: 'Canal debe ser EMAIL o WHATSAPP' }, { status: 400 });
    }

    const resultado = await enviarFacturaCliente(
      { documentoId: Number(documento_id), canal, destinatario },
      { userId: session.email, userEmail: session.email },
      empresaIdDeSesion(session)
    );

    if (!resultado.ok) {
      const status = resultado.mensaje.includes('no encontrado') ? 404 : 502;
      return NextResponse.json({ error: resultado.mensaje }, { status });
    }
    return NextResponse.json({ ok: true, mensaje: resultado.mensaje });
  } catch (error) {
    console.error('[DOCUMENTOS-ENVIAR] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error enviando factura' },
      { status: 500 }
    );
  }
}
