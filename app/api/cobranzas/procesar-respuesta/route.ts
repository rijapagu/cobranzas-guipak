import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { procesarRespuestaCliente } from '@/lib/cobranzas/procesar-respuesta';

/**
 * POST /api/cobranzas/procesar-respuesta
 * Procesa un mensaje entrante de un cliente (uso manual/pruebas desde la app).
 *
 * La lógica vive en lib/cobranzas/procesar-respuesta.ts; el webhook de WhatsApp
 * la invoca directamente sin pasar por HTTP. Esta ruta YA NO es pública:
 * requiere sesión (el middleware también la protege).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { telefono, mensaje, canal = 'WHATSAPP' } = body as {
      telefono: string;
      mensaje: string;
      canal?: string;
    };

    if (!telefono || !mensaje) {
      return NextResponse.json({ error: 'telefono y mensaje requeridos' }, { status: 400 });
    }

    const resultado = await procesarRespuestaCliente({ telefono, mensaje, canal });

    if (!resultado.procesado) {
      return NextResponse.json({ message: resultado.motivo, procesado: false });
    }

    return NextResponse.json({
      message: 'Respuesta procesada',
      ...resultado,
    });
  } catch (error) {
    console.error('[PROCESAR-RESPUESTA] Error:', error);
    return NextResponse.json({ error: 'Error procesando respuesta' }, { status: 500 });
  }
}
