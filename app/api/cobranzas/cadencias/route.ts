import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

const ACCIONES_VALIDAS = ['EMAIL', 'WHATSAPP', 'LLAMADA_TICKET', 'RECLASIFICAR', 'ESCALAR_LEGAL'];
const SEGMENTOS_VALIDOS = ['VERDE', 'AMARILLO', 'NARANJA', 'ROJO'];

/**
 * GET /api/cobranzas/cadencias
 * Lista todas las cadencias con la última ejecución si está disponible.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const cadencias = await cobranzasQuery<{
    id: number;
    segmento: string;
    dia_desde_vencimiento: number;
    accion: string;
    requiere_aprobacion: number;
    plantilla_mensaje_id: number | null;
    activa: number;
  }>(
    'SELECT id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id, activa FROM cobranza_cadencias ORDER BY dia_desde_vencimiento ASC, segmento ASC'
  );

  // Estadísticas del último run
  const ultimoRun = await cobranzasQuery<{ detalle: string; created_at: string }>(
    "SELECT detalle, created_at FROM cobranza_logs WHERE accion='CADENCIAS_HORARIAS' ORDER BY created_at DESC LIMIT 1"
  );

  return NextResponse.json({
    cadencias: cadencias.map((c) => ({
      ...c,
      requiere_aprobacion: !!c.requiere_aprobacion,
      activa: !!c.activa,
    })),
    ultimo_run: ultimoRun[0] ? { created_at: ultimoRun[0].created_at } : null,
  });
}

/**
 * POST /api/cobranzas/cadencias
 * Crea una nueva cadencia. Solo SUPERVISOR/ADMIN.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!['SUPERVISOR', 'ADMIN'].includes(session.rol?.toUpperCase() ?? '')) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const body = await req.json();
  const { segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id } = body;

  if (!SEGMENTOS_VALIDOS.includes(segmento)) {
    return NextResponse.json({ error: 'Segmento inválido' }, { status: 400 });
  }
  if (!ACCIONES_VALIDAS.includes(accion)) {
    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
  }
  if (typeof dia_desde_vencimiento !== 'number' || dia_desde_vencimiento < 0) {
    return NextResponse.json({ error: 'día inválido' }, { status: 400 });
  }

  try {
    const result = await cobranzasExecute(
      'INSERT INTO cobranza_cadencias (segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id) VALUES (?, ?, ?, ?, ?)',
      [segmento, dia_desde_vencimiento, accion, requiere_aprobacion ? 1 : 0, plantilla_mensaje_id ?? null]
    );
    const id = (result as { insertId?: number }).insertId;
    await logAccion(session.email, 'CADENCIA_CREADA', 'cadencia', String(id), { segmento, dia_desde_vencimiento, accion });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Duplicate')) {
      return NextResponse.json({ error: 'Ya existe una cadencia para ese segmento y día' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/cobranzas/cadencias
 * Actualiza una cadencia existente por ID.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!['SUPERVISOR', 'ADMIN'].includes(session.rol?.toUpperCase() ?? '')) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const body = await req.json();
  const { id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id, activa } = body;

  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (segmento !== undefined) {
    if (!SEGMENTOS_VALIDOS.includes(segmento)) return NextResponse.json({ error: 'Segmento inválido' }, { status: 400 });
    sets.push('segmento = ?'); params.push(segmento);
  }
  if (dia_desde_vencimiento !== undefined) { sets.push('dia_desde_vencimiento = ?'); params.push(dia_desde_vencimiento); }
  if (accion !== undefined) {
    if (!ACCIONES_VALIDAS.includes(accion)) return NextResponse.json({ error: 'Acción inválida' }, { status: 400 });
    sets.push('accion = ?'); params.push(accion);
  }
  if (requiere_aprobacion !== undefined) { sets.push('requiere_aprobacion = ?'); params.push(requiere_aprobacion ? 1 : 0); }
  if (plantilla_mensaje_id !== undefined) { sets.push('plantilla_mensaje_id = ?'); params.push(plantilla_mensaje_id ?? null); }
  if (activa !== undefined) { sets.push('activa = ?'); params.push(activa ? 1 : 0); }

  if (sets.length === 0) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });

  params.push(id);
  await cobranzasExecute(`UPDATE cobranza_cadencias SET ${sets.join(', ')} WHERE id = ?`, params);
  await logAccion(session.email, 'CADENCIA_ACTUALIZADA', 'cadencia', String(id), body);
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/cobranzas/cadencias?id=N
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!['SUPERVISOR', 'ADMIN'].includes(session.rol?.toUpperCase() ?? '')) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  await cobranzasExecute('DELETE FROM cobranza_cadencias WHERE id = ?', [id]);
  await logAccion(session.email, 'CADENCIA_ELIMINADA', 'cadencia', id, {});
  return NextResponse.json({ ok: true });
}
