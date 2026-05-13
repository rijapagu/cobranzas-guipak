import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery } from '@/lib/db/softec';

const EstadoEnum = z.enum(['ABIERTA', 'EN_REVISION', 'RESUELTA', 'ANULADA']);

const CreateSchema = z.object({
  codigo_cliente: z.string().min(1).max(12),
  ij_inum: z.number().int().positive(),
  motivo: z.string().min(5),
  monto_disputado: z.number().positive().nullable().optional(),
});

/**
 * GET /api/cobranzas/disputas
 * Filtros: ?estado=ABIERTA&busqueda=0000274&desde=2026-01-01&hasta=2026-12-31
 * Devuelve lista + conteos por estado + nombres de clientes desde Softec.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const estado = searchParams.get('estado');
  const busqueda = searchParams.get('busqueda');
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');

  const where: string[] = [];
  const params: (string | number)[] = [];

  if (estado) {
    const e = EstadoEnum.safeParse(estado);
    if (!e.success) return NextResponse.json({ error: 'estado inválido' }, { status: 400 });
    where.push('d.estado = ?');
    params.push(estado);
  }
  if (busqueda) {
    where.push('d.codigo_cliente LIKE ?');
    params.push(`%${busqueda}%`);
  }
  if (desde) {
    where.push('DATE(d.created_at) >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('DATE(d.created_at) <= ?');
    params.push(hasta);
  }

  const sql = `
    SELECT d.id, d.codigo_cliente, d.ij_inum, d.motivo,
           d.monto_disputado, d.estado,
           d.resolucion, d.resuelto_por, d.fecha_resolucion,
           d.registrado_por, d.created_at, d.updated_at
      FROM cobranza_disputas d
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY
       FIELD(d.estado, 'ABIERTA', 'EN_REVISION', 'RESUELTA', 'ANULADA'),
       d.created_at DESC
  `;

  const disputas = await cobranzasQuery<DisputaRow>(sql, params);

  // Conteos por estado (siempre, sin filtros)
  const conteos = await cobranzasQuery<{ estado: string; total: number }>(
    `SELECT estado, COUNT(*) AS total FROM cobranza_disputas GROUP BY estado`
  );
  const porEstado = Object.fromEntries(conteos.map((c) => [c.estado, Number(c.total)]));

  // Enriquecer con nombres de clientes desde Softec (batch)
  const codigos = [...new Set(disputas.map((d) => d.codigo_cliente))];
  let nombresPorCodigo: Record<string, string> = {};
  if (codigos.length > 0) {
    const placeholders = codigos.map(() => '?').join(',');
    try {
      const clientes = await softecQuery<{ IC_CODE: string; IC_NAME: string }>(
        `SELECT IC_CODE, IC_NAME FROM v_cobr_icust WHERE IC_CODE IN (${placeholders})`,
        codigos
      );
      nombresPorCodigo = Object.fromEntries(clientes.map((c) => [c.IC_CODE.trim(), c.IC_NAME.trim()]));
    } catch {
      // Softec puede no estar disponible en local — continuar sin nombres
    }
  }

  const resultado = disputas.map((d) => ({
    ...d,
    monto_disputado: d.monto_disputado != null ? Number(d.monto_disputado) : null,
    nombre_cliente: nombresPorCodigo[d.codigo_cliente.trim()] || d.codigo_cliente,
  }));

  return NextResponse.json({ disputas: resultado, por_estado: porEstado });
}

/**
 * POST /api/cobranzas/disputas
 * Crea una nueva disputa manualmente.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_disputas (codigo_cliente, ij_inum, motivo, monto_disputado, registrado_por)
     VALUES (?, ?, ?, ?, ?)`,
    [d.codigo_cliente, d.ij_inum, d.motivo, d.monto_disputado ?? null, session.email]
  );
  const id = (result as { insertId?: number }).insertId;

  await logAccion(
    String(session.userId),
    'DISPUTA_CREADA',
    'disputa',
    String(id),
    { codigo_cliente: d.codigo_cliente, ij_inum: d.ij_inum, motivo: d.motivo.substring(0, 100) }
  );

  return NextResponse.json({ ok: true, id });
}

interface DisputaRow {
  id: number;
  codigo_cliente: string;
  ij_inum: number;
  motivo: string;
  monto_disputado: number | null;
  estado: string;
  resolucion: string | null;
  resuelto_por: string | null;
  fecha_resolucion: string | null;
  registrado_por: string;
  created_at: string;
  updated_at: string;
}
