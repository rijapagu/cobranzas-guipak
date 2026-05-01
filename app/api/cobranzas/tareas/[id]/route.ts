import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const TipoEnum = z.enum(['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO']);
const EstadoEnum = z.enum(['PENDIENTE', 'EN_PROGRESO', 'HECHA', 'CANCELADA']);
const PrioridadEnum = z.enum(['BAJA', 'MEDIA', 'ALTA']);

const UpdateSchema = z.object({
  titulo: z.string().min(2).max(200).optional(),
  descripcion: z.string().nullable().optional(),
  tipo: TipoEnum.optional(),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hora: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  codigo_cliente: z.string().nullable().optional(),
  ij_inum: z.number().int().nullable().optional(),
  estado: EstadoEnum.optional(),
  prioridad: PrioridadEnum.optional(),
  asignada_a: z.string().nullable().optional(),
  notas_completado: z.string().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const rows = await cobranzasQuery(
    'SELECT * FROM cobranza_tareas WHERE id = ?',
    [Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  return NextResponse.json({ tarea: rows[0] });
}

/**
 * PUT /api/cobranzas/tareas/[id]
 * Si estado pasa a HECHA o CANCELADA, sella completada_at + completada_por.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    updates.push(`${k} = ?`);
    values.push(v as string | number | null);
  }

  if (parsed.data.estado === 'HECHA' || parsed.data.estado === 'CANCELADA') {
    updates.push('completada_at = NOW()');
    updates.push('completada_por = ?');
    values.push(session.email);
  } else if (parsed.data.estado === 'PENDIENTE' || parsed.data.estado === 'EN_PROGRESO') {
    updates.push('completada_at = NULL');
    updates.push('completada_por = NULL');
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }
  values.push(idNum);

  await cobranzasExecute(
    `UPDATE cobranza_tareas SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  await logAccion(
    String(session.userId),
    'TAREA_EDITADA',
    'tarea',
    String(idNum),
    { campos: Object.keys(parsed.data) }
  );

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/cobranzas/tareas/[id]
 * Soft-delete: marca como CANCELADA.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  await cobranzasExecute(
    `UPDATE cobranza_tareas
        SET estado = 'CANCELADA',
            completada_at = NOW(),
            completada_por = ?
      WHERE id = ?`,
    [session.email, Number(id)]
  );

  await logAccion(
    String(session.userId),
    'TAREA_CANCELADA',
    'tarea',
    id,
    {}
  );

  return NextResponse.json({ ok: true });
}
