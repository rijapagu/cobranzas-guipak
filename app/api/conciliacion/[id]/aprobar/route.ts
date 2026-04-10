import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

/**
 * POST /api/conciliacion/[id]/aprobar
 * Aprueba una entrada POR_APLICAR. CP-08: Log.
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

    const entries = await cobranzasQuery<{ id: number; estado: string; monto: number; codigo_cliente: string }>(
      'SELECT id, estado, monto, codigo_cliente FROM cobranza_conciliacion WHERE id = ?',
      [entryId]
    );

    if (entries.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    if (entries[0].estado !== 'POR_APLICAR') {
      return NextResponse.json({ error: `Estado actual: ${entries[0].estado}` }, { status: 400 });
    }

    await logAccion(session.userId.toString(), 'CONCILIACION_APROBADA', 'conciliacion', id, {
      monto: entries[0].monto,
      cliente: entries[0].codigo_cliente,
    });

    await cobranzasExecute(
      'UPDATE cobranza_conciliacion SET estado = ?, aprobado_por = ?, fecha_aprobacion = NOW() WHERE id = ?',
      ['CONCILIADO', session.email, entryId]
    );

    return NextResponse.json({ message: `Entrada ${entryId} aprobada` });
  } catch (error) {
    console.error('[CONCILIACION-APROBAR] Error:', error);
    return NextResponse.json({ error: 'Error aprobando' }, { status: 500 });
  }
}
