import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion } from '@/lib/tenant';
import { aprobarDeposito } from '@/lib/conciliacion/acciones';

/**
 * POST /api/conciliacion/[id]/aprobar
 * Aprueba una entrada POR_APLICAR. CP-08: Log.
 *
 * La lógica vive en lib/conciliacion/acciones.ts — compartida con la tool
 * aprobar_deposito del agente conversacional.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores' }, { status: 403 });
    }

    const { id } = await params;
    const entryId = Number(id);

    const resultado = await aprobarDeposito(
      entryId,
      { userId: session.userId.toString(), userEmail: session.email },
      empresaIdDeSesion(session)
    );

    if (!resultado.ok) {
      const status = resultado.mensaje.includes('no encontrado') ? 404 : 400;
      return NextResponse.json({ error: resultado.mensaje }, { status });
    }

    return NextResponse.json({ message: `Entrada ${entryId} aprobada` });
  } catch (error) {
    console.error('[CONCILIACION-APROBAR] Error:', error);
    return NextResponse.json({ error: 'Error aprobando' }, { status: 500 });
  }
}
