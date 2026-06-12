import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';

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
    'SELECT * FROM cobranza_disputas WHERE id = ? AND empresa_id = ' + empresaIdDeSesion(session),
    [Number(id)]
  );
  if (rows.length === 0) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  const disputa = rows[0] as Record<string, unknown>;

  // Datos del cliente y factura desde el ERP de la empresa (modelo canónico —
  // los nombres IJ_/IC_ quedan encapsulados en el adaptador).
  let cliente: { codigo: string; nombre: string; email: string | null; telefono: string | null } | null = null;
  let factura: {
    numero: number; ncf: string; fecha_emision: string; fecha_vencimiento: string;
    total: number; pagado: number;
  } | null = null;

  try {
    const adapter = await adaptadorParaEmpresa(empresaIdDeSesion(session));
    const [cli, fac] = await Promise.all([
      adapter.cliente(String(disputa.codigo_cliente)),
      adapter.factura(Number(disputa.ij_inum), String(disputa.codigo_cliente)),
    ]);
    if (cli) {
      cliente = { codigo: cli.codigo, nombre: cli.nombre, email: cli.email ?? null, telefono: cli.telefono ?? null };
    }
    if (fac) {
      factura = {
        numero: fac.numero,
        ncf: fac.ncf ?? '',
        fecha_emision: fac.fechaEmision ?? '',
        fecha_vencimiento: fac.fechaVencimiento,
        total: fac.total,
        pagado: fac.totalPagado ?? Math.max(0, fac.total - fac.saldoPendiente),
      };
    }
  } catch {
    // ERP no disponible — continuar sin datos adicionales
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
    ? { ...factura, saldo_pendiente: factura.total - factura.pagado }
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

  const rows = await cobranzasQuery('SELECT * FROM cobranza_disputas WHERE id = ? AND empresa_id = ' + empresaIdDeSesion(session), [idNum]);
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
