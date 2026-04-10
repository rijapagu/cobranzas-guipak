import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const descartarSchema = z.object({
  motivo: z.string().min(1, 'Motivo requerido'),
});

/**
 * POST /api/cobranzas/gestiones/[id]/descartar
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
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden descartar' }, { status: 403 });
    }

    const { id } = await params;
    const gestionId = Number(id);
    const body = await request.json();
    const parsed = descartarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Motivo requerido' }, { status: 400 });
    }

    const gestiones = await cobranzasQuery<{ id: number; estado: string; codigo_cliente: string }>(
      'SELECT id, estado, codigo_cliente FROM cobranza_gestiones WHERE id = ?',
      [gestionId]
    );

    if (gestiones.length === 0) {
      return NextResponse.json({ error: 'Gestión no encontrada' }, { status: 404 });
    }
    if (gestiones[0].estado !== 'PENDIENTE') {
      return NextResponse.json({ error: `No se puede descartar: estado ${gestiones[0].estado}` }, { status: 400 });
    }

    // CP-08: Log
    await logAccion(
      session.userId.toString(),
      'GESTION_DESCARTADA',
      'gestion',
      gestionId.toString(),
      { motivo: parsed.data.motivo, cliente: gestiones[0].codigo_cliente }
    );

    await cobranzasExecute(
      'UPDATE cobranza_gestiones SET estado = ?, motivo_descarte = ?, aprobado_por = ? WHERE id = ?',
      ['DESCARTADO', parsed.data.motivo, session.email, gestionId]
    );

    return NextResponse.json({ message: `Gestión ${gestionId} descartada` });
  } catch (error) {
    console.error('[DESCARTAR] Error:', error);
    return NextResponse.json({ error: 'Error descartando gestión' }, { status: 500 });
  }
}
