import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery } from '@/lib/db/softec';

const UpdateSchema = z.object({
  motivo: z.string().min(5).optional(),
  monto_disputado: z.number().positive().nullable().optional(),
  estado: z.enum(['EN_REVISION', 'RESUELTA', 'ANULADA']).optional(),
  resolucion: z.string().min(5).optional(),
});

/**
 * GET /api/cobranzas/disputas/[id]
 * Devuelve la disputa con datos de Softec (cliente + factura) + log de acciones.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const rows = await cobranzasQuery(
    'SELECT * FROM cobranza_disputas WHERE id = ?',
    [Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  const disputa = rows[0] as Record<string, unknown>;

  // Datos del cliente y factura desde Softec
  type ClienteRow = { IC_CODE: string; IC_NAME: string; IC_EMAIL: string; IC_PHONE: string };
  type FacturaRow = { IJ_INUM: number; IJ_DATE: string; IJ_DUEDATE: string; IJ_TOT: number; IJ_TOTAPPL: number; IJ_NCFFIX: string; IJ_NCFNUM: number };

  let cliente: ClienteRow | null = null;
  let factura: FacturaRow | null = null;

  try {
    const clientes = await softecQuery<ClienteRow>(
      'SELECT IC_CODE, IC_NAME, IC_EMAIL, IC_PHONE FROM v_cobr_icust WHERE IC_CODE = ?',
      [String(disputa.codigo_cliente)]
    );
    if (clientes.length > 0) cliente = clientes[0];

    const facturas = await softecQuery<FacturaRow>(
      `SELECT IJ_INUM, IJ_DATE, IJ_DUEDATE, IJ_TOT, IJ_TOTAPPL, IJ_NCFFIX, IJ_NCFNUM
         FROM v_cobr_ijnl
        WHERE IJ_INUM = ? AND IJ_CCODE = ?`,
      [Number(disputa.ij_inum), String(disputa.codigo_cliente)]
    );
    if (facturas.length > 0) factura = facturas[0];
  } catch {
    // Softec no disponible — continuar sin datos adicionales
  }

  // Historial de acciones para esta disputa
  const logs = await cobranzasQuery(
    `SELECT usuario_id, accion, detalle, created_at
       FROM cobranza_logs
      WHERE entidad = 'disputa' AND entidad_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [String(id)]
  );

  const facturaOut = factura
    ? { ...factura, IJ_TOT: Number(factura.IJ_TOT), IJ_TOTAPPL: Number(factura.IJ_TOTAPPL), saldo_pendiente: Number(factura.IJ_TOT) - Number(factura.IJ_TOTAPPL) }
    : null;

  return NextResponse.json({
    disputa: {
      ...disputa,
      monto_disputado: disputa.monto_disputado != null ? Number(disputa.monto_disputado) : null,
    },
    cliente,
    factura: facturaOut,
    logs,
  });
}

/**
 * PUT /api/cobranzas/disputas/[id]
 * Transiciones de estado y edición de motivo/monto.
 *
 * Reglas:
 *   ABIERTA → EN_REVISION  (sin requisito extra)
 *   ABIERTA → ANULADA       (sin requisito extra)
 *   EN_REVISION → RESUELTA  (requiere resolucion)
 *   EN_REVISION → ANULADA   (sin requisito extra)
 *   RESUELTA / ANULADA      → sin transición (inmutable)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const idNum = Number(id);

  const rows = await cobranzasQuery('SELECT * FROM cobranza_disputas WHERE id = ?', [idNum]);
  if (rows.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  const actual = rows[0] as { estado: string };

  if (actual.estado === 'RESUELTA' || actual.estado === 'ANULADA') {
    return NextResponse.json({ error: 'No se puede modificar una disputa resuelta o anulada' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;

  // Validar transición de estado
  if (data.estado) {
    const transicionesValidas: Record<string, string[]> = {
      ABIERTA: ['EN_REVISION', 'ANULADA'],
      EN_REVISION: ['RESUELTA', 'ANULADA'],
    };
    if (!transicionesValidas[actual.estado]?.includes(data.estado)) {
      return NextResponse.json(
        { error: `Transición inválida: ${actual.estado} → ${data.estado}` },
        { status: 400 }
      );
    }
    if (data.estado === 'RESUELTA' && !data.resolucion) {
      return NextResponse.json({ error: 'Se requiere el campo "resolucion" para resolver una disputa' }, { status: 400 });
    }
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.motivo !== undefined) { updates.push('motivo = ?'); values.push(data.motivo); }
  if (data.monto_disputado !== undefined) { updates.push('monto_disputado = ?'); values.push(data.monto_disputado); }

  if (data.estado) {
    updates.push('estado = ?');
    values.push(data.estado);

    if (data.estado === 'RESUELTA') {
      updates.push('resolucion = ?', 'resuelto_por = ?', 'fecha_resolucion = NOW()');
      values.push(data.resolucion!, session.email);
    } else if (data.estado === 'ANULADA') {
      updates.push('resuelto_por = ?', 'fecha_resolucion = NOW()');
      values.push(session.email);
      if (data.resolucion) {
        updates.push('resolucion = ?');
        values.push(data.resolucion);
      }
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });

  values.push(idNum);
  await cobranzasExecute(
    `UPDATE cobranza_disputas SET ${updates.join(', ')} WHERE id = ?`,
    values
  );

  const accion = data.estado
    ? `DISPUTA_${data.estado}`
    : 'DISPUTA_EDITADA';

  await logAccion(
    String(session.userId),
    accion,
    'disputa',
    String(idNum),
    {
      estado_anterior: actual.estado,
      estado_nuevo: data.estado || actual.estado,
      campos: Object.keys(data),
    }
  );

  return NextResponse.json({ ok: true });
}
