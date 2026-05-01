import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const TipoEnum = z.enum(['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO']);
const EstadoEnum = z.enum(['PENDIENTE', 'EN_PROGRESO', 'HECHA', 'CANCELADA']);
const PrioridadEnum = z.enum(['BAJA', 'MEDIA', 'ALTA']);
const OrigenEnum = z.enum(['MANUAL', 'ACUERDO_PAGO', 'CADENCIA']);

const TareaSchema = z.object({
  titulo: z.string().min(2).max(200),
  descripcion: z.string().nullable().optional(),
  tipo: TipoEnum.default('OTRO'),
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
  hora: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  codigo_cliente: z.string().nullable().optional(),
  ij_inum: z.number().int().nullable().optional(),
  prioridad: PrioridadEnum.default('MEDIA'),
  asignada_a: z.string().nullable().optional(),
  origen: OrigenEnum.default('MANUAL'),
  origen_ref: z.string().nullable().optional(),
});

/**
 * GET /api/cobranzas/tareas
 * Filtros query:
 *   ?desde=2026-05-01&hasta=2026-05-31  rango de fechas
 *   ?estado=PENDIENTE                    estado puntual
 *   ?cliente=0000274                     codigo_cliente
 *   ?asignada_a=email@x.com              filtra por dueño
 *   ?origen=ACUERDO_PAGO
 *   ?incluir_completadas=1               por default oculta HECHA/CANCELADA
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  const estado = searchParams.get('estado');
  const cliente = searchParams.get('cliente');
  const asignada_a = searchParams.get('asignada_a');
  const origen = searchParams.get('origen');
  const incluirCompletadas = searchParams.get('incluir_completadas') === '1';

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (desde) {
    where.push('fecha_vencimiento >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('fecha_vencimiento <= ?');
    params.push(hasta);
  }
  if (estado) {
    const e = EstadoEnum.safeParse(estado);
    if (!e.success) return NextResponse.json({ error: 'estado inválido' }, { status: 400 });
    where.push('estado = ?');
    params.push(estado);
  } else if (!incluirCompletadas) {
    where.push("estado IN ('PENDIENTE','EN_PROGRESO')");
  }
  if (cliente) {
    where.push('codigo_cliente = ?');
    params.push(cliente);
  }
  if (asignada_a) {
    where.push('asignada_a = ?');
    params.push(asignada_a);
  }
  if (origen) {
    const o = OrigenEnum.safeParse(origen);
    if (!o.success) return NextResponse.json({ error: 'origen inválido' }, { status: 400 });
    where.push('origen = ?');
    params.push(origen);
  }

  const sql = `
    SELECT id, titulo, descripcion, tipo, fecha_vencimiento, hora,
           codigo_cliente, ij_inum, estado, prioridad,
           asignada_a, creado_por, origen, origen_ref,
           completada_at, completada_por, notas_completado,
           created_at, updated_at
      FROM cobranza_tareas
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY fecha_vencimiento ASC, hora IS NULL, hora ASC, prioridad DESC, id ASC
  `;

  const rows = await cobranzasQuery(sql, params);
  return NextResponse.json({ tareas: rows });
}

/**
 * POST /api/cobranzas/tareas
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = TareaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const t = parsed.data;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_tareas
     (titulo, descripcion, tipo, fecha_vencimiento, hora, codigo_cliente, ij_inum,
      prioridad, asignada_a, creado_por, origen, origen_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.titulo,
      t.descripcion ?? null,
      t.tipo,
      t.fecha_vencimiento,
      t.hora ?? null,
      t.codigo_cliente ?? null,
      t.ij_inum ?? null,
      t.prioridad,
      t.asignada_a ?? session.email,
      session.email,
      t.origen,
      t.origen_ref ?? null,
    ]
  );

  const id = (result as { insertId?: number }).insertId;
  await logAccion(
    String(session.userId),
    'TAREA_CREADA',
    'tarea',
    String(id),
    { titulo: t.titulo, fecha: t.fecha_vencimiento, origen: t.origen }
  );

  return NextResponse.json({ ok: true, id });
}
