import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';

const aprobarSchema = z.object({
  mensaje_editado_wa: z.string().optional(),
  mensaje_editado_email: z.string().optional(),
  asunto_editado: z.string().optional(),
});

/**
 * POST /api/cobranzas/gestiones/[id]/aprobar
 * CP-02: Aprueba una gestión. Solo SUPERVISOR/ADMIN.
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
      return NextResponse.json({ error: 'Solo supervisores pueden aprobar' }, { status: 403 });
    }

    const { id } = await params;
    const gestionId = Number(id);
    const empresaId = empresaIdDeSesion(session);

    // Verificar que existe y está PENDIENTE (scoped a la empresa de la sesión)
    const gestiones = await cobranzasQuery<{ id: number; estado: string; mensaje_propuesto_wa: string; mensaje_propuesto_email: string; asunto_email: string; codigo_cliente: string; saldo_pendiente: number }>(
      'SELECT id, estado, mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email, codigo_cliente, saldo_pendiente FROM cobranza_gestiones WHERE id = ? AND empresa_id = ?',
      [gestionId, empresaId]
    );

    if (gestiones.length === 0) {
      return NextResponse.json({ error: 'Gestión no encontrada' }, { status: 404 });
    }

    const gestion = gestiones[0];
    if (gestion.estado !== 'PENDIENTE') {
      return NextResponse.json({ error: `Gestión ya está en estado ${gestion.estado}` }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = aprobarSchema.safeParse(body);
    const ediciones = parsed.success ? parsed.data : {};

    const fueEditado = !!(ediciones.mensaje_editado_wa || ediciones.mensaje_editado_email);
    const nuevoEstado = fueEditado ? 'EDITADO' : 'APROBADO';

    const mensajeFinalWa = ediciones.mensaje_editado_wa || gestion.mensaje_propuesto_wa;
    const mensajeFinalEmail = ediciones.mensaje_editado_email || gestion.mensaje_propuesto_email;

    // CP-08: Log ANTES de la acción
    await logAccion(
      session.userId.toString(),
      fueEditado ? 'GESTION_EDITADA_APROBADA' : 'GESTION_APROBADA',
      'gestion',
      gestionId.toString(),
      {
        cliente: gestion.codigo_cliente,
        saldo: gestion.saldo_pendiente,
        editado: fueEditado,
      }
    );

    // CP-02: Actualizar con aprobado_por NOT NULL
    await cobranzasExecute(
      `UPDATE cobranza_gestiones
       SET estado = ?, aprobado_por = ?, fecha_aprobacion = NOW(),
           mensaje_final_wa = ?, mensaje_final_email = ?
       WHERE id = ? AND empresa_id = ?`,
      [nuevoEstado, session.email, mensajeFinalWa, mensajeFinalEmail, gestionId, empresaId]
    );

    // Cerrar tarea espejo de cadencia si existe (Camino A junio 2026).
    // Best-effort: si no hay tarea espejo (gestion no fue creada por cadencia
    // o fue de una version anterior al patch), el UPDATE simplemente afecta 0
    // filas. No falla la aprobacion principal.
    await cobranzasExecute(
      `UPDATE cobranza_tareas
       SET estado='HECHA', completada_at=NOW(), completada_por=?,
           notas_completado=?
       WHERE origen='CADENCIA' AND origen_ref=? AND estado='PENDIENTE'`,
      [
        session.email,
        fueEditado
          ? 'Aprobada con ediciones desde Cola de Aprobación'
          : 'Aprobada desde Cola de Aprobación',
        `gestion:${gestionId}`,
      ]
    );

    return NextResponse.json({
      message: `Gestión ${gestionId} ${fueEditado ? 'editada y aprobada' : 'aprobada'}`,
      estado: nuevoEstado,
    });
  } catch (error) {
    console.error('[APROBAR] Error:', error);
    return NextResponse.json({ error: 'Error aprobando gestión' }, { status: 500 });
  }
}
