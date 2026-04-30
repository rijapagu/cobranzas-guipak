import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const UpdateSchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  descripcion: z.string().nullable().optional(),
  segmento: z.enum(['VERDE', 'AMARILLO', 'NARANJA', 'ROJO']).optional(),
  categoria: z.enum(['SECUENCIA', 'BUEN_CLIENTE', 'PROMESA_ROTA', 'ESTADO_CUENTA']).optional(),
  dia_desde_vencimiento: z.number().int().optional(),
  orden_secuencia: z.number().int().min(1).optional(),
  asunto: z.string().min(2).max(200).optional(),
  cuerpo: z.string().min(10).optional(),
  tono: z.enum(['AMIGABLE', 'MODERADO', 'FORMAL', 'FIRME', 'LEGAL']).optional(),
  requiere_aprobacion: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).optional(),
  activa: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).optional(),
});

/**
 * GET /api/cobranzas/plantillas/[id]
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const rows = await cobranzasQuery(
    'SELECT * FROM cobranza_plantillas_email WHERE id = ?',
    [Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  return NextResponse.json({ plantilla: rows[0] });
}

/**
 * PUT /api/cobranzas/plantillas/[id]
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
    return NextResponse.json({ error: 'Solo supervisores pueden editar plantillas' }, { status: 403 });
  }

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
  if (updates.length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }
  values.push(idNum);

  await cobranzasExecute(
    `UPDATE cobranza_plantillas_email SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  await logAccion(
    String(session.userId),
    'PLANTILLA_EDITADA',
    'plantilla_email',
    String(idNum),
    { campos: Object.keys(parsed.data) }
  );

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/cobranzas/plantillas/[id]
 * Soft-delete: pone activa = 0
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
    return NextResponse.json({ error: 'Solo supervisores pueden archivar plantillas' }, { status: 403 });
  }

  const { id } = await params;
  await cobranzasExecute(
    'UPDATE cobranza_plantillas_email SET activa = 0 WHERE id = ?',
    [Number(id)]
  );

  await logAccion(
    String(session.userId),
    'PLANTILLA_ARCHIVADA',
    'plantilla_email',
    id,
    {}
  );

  return NextResponse.json({ ok: true });
}
