import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const PlantillaSchema = z.object({
  nombre: z.string().min(2).max(100),
  descripcion: z.string().optional().nullable(),
  segmento: z.enum(['VERDE', 'AMARILLO', 'NARANJA', 'ROJO']),
  dia_desde_vencimiento: z.number().int(),
  orden_secuencia: z.number().int().min(1).default(1),
  asunto: z.string().min(2).max(200),
  cuerpo: z.string().min(10),
  tono: z.enum(['AMIGABLE', 'MODERADO', 'FORMAL', 'FIRME', 'LEGAL']).default('MODERADO'),
  requiere_aprobacion: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)),
  activa: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)),
});

/**
 * GET /api/cobranzas/plantillas
 * Lista todas las plantillas (activas e inactivas).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const rows = await cobranzasQuery(
    `SELECT id, nombre, descripcion, segmento, dia_desde_vencimiento, orden_secuencia,
            asunto, cuerpo, tono, requiere_aprobacion, activa, creado_por,
            created_at, updated_at
     FROM cobranza_plantillas_email
     ORDER BY segmento DESC, dia_desde_vencimiento ASC, orden_secuencia ASC`
  );

  return NextResponse.json({ plantillas: rows });
}

/**
 * POST /api/cobranzas/plantillas
 * Crea una plantilla nueva.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
    return NextResponse.json({ error: 'Solo supervisores pueden crear plantillas' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PlantillaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }

  const p = parsed.data;
  const result = await cobranzasExecute(
    `INSERT INTO cobranza_plantillas_email
     (nombre, descripcion, segmento, dia_desde_vencimiento, orden_secuencia, asunto, cuerpo, tono, requiere_aprobacion, activa, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.nombre,
      p.descripcion || null,
      p.segmento,
      p.dia_desde_vencimiento,
      p.orden_secuencia,
      p.asunto,
      p.cuerpo,
      p.tono,
      p.requiere_aprobacion,
      p.activa,
      session.email,
    ]
  );

  const id = (result as { insertId?: number }).insertId;
  await logAccion(
    String(session.userId),
    'PLANTILLA_CREADA',
    'plantilla_email',
    String(id),
    { nombre: p.nombre, segmento: p.segmento }
  );

  return NextResponse.json({ ok: true, id });
}
