import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logError } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { generarColaAprobacion } from '@/lib/cobranzas/generar-cola';

/**
 * POST /api/cobranzas/generar-cola
 * Genera mensajes de cobranza con Claude AI para facturas vencidas.
 * Inserta en cobranza_gestiones con estado PENDIENTE.
 * CP-03: Excluye facturas con disputa activa.
 * CP-10: Claude solo genera texto.
 *
 * La lógica vive en lib/cobranzas/generar-cola.ts — compartida con la tool
 * generar_cola_hoy del agente conversacional.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden generar cola' }, { status: 403 });
    }

    const resultado = await generarColaAprobacion(
      { userId: session.userId.toString(), userEmail: session.email },
      empresaIdDeSesion(session)
    );

    return NextResponse.json({
      message: `Cola generada: ${resultado.generadas} gestiones creadas`,
      ...resultado,
    });
  } catch (error) {
    await logError('generar-cola', error);
    return NextResponse.json({ error: 'Error generando cola' }, { status: 500 });
  }
}
