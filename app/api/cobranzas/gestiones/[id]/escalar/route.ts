import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

/**
 * POST /api/cobranzas/gestiones/[id]/escalar
 * CP-08: Log antes de ejecutar.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { id } = await params;
    const gestionId = Number(id);
    const body = await request.json().catch(() => ({}));
    const notas = (body as { notas?: string }).notas || '';

    const gestiones = await cobranzasQuery<{ id: number; estado: string; codigo_cliente: string }>(
      'SELECT id, estado, codigo_cliente FROM cobranza_gestiones WHERE id = ?',
      [gestionId]
    );

    if (gestiones.length === 0) {
      return NextResponse.json({ error: 'Gestión no encontrada' }, { status: 404 });
    }
    if (gestiones[0].estado !== 'PENDIENTE') {
      return NextResponse.json({ error: `No se puede escalar: estado ${gestiones[0].estado}` }, { status: 400 });
    }

    await logAccion(
      session.userId.toString(),
      'GESTION_ESCALADA',
      'gestion',
      gestionId.toString(),
      { notas, cliente: gestiones[0].codigo_cliente }
    );

    await cobranzasExecute(
      'UPDATE cobranza_gestiones SET estado = ?, motivo_descarte = ?, aprobado_por = ? WHERE id = ?',
      ['ESCALADO', notas ? `ESCALADO: ${notas}` : 'Escalado a gestión manual', session.email, gestionId]
    );

    return NextResponse.json({ message: `Gestión ${gestionId} escalada` });
  } catch (error) {
    console.error('[ESCALAR] Error:', error);
    return NextResponse.json({ error: 'Error escalando gestión' }, { status: 500 });
  }
}
