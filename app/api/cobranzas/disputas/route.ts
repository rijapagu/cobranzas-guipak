import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { empresaIdDeSesion } from '@/lib/tenant';
import { crearDisputa } from '@/lib/cobranzas/disputas';

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

  const empresaId = empresaIdDeSesion(session);
  const where: string[] = ['d.empresa_id = ?'];
  const params: (string | number)[] = [empresaId];

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
    `SELECT estado, COUNT(*) AS total FROM cobranza_disputas WHERE empresa_id = ? GROUP BY estado`,
    [empresaId]
  );
  const porEstado = Object.fromEntries(conteos.map((c) => [c.estado, Number(c.total)]));

  // Enriquecer con nombres de clientes desde el ERP de la empresa (batch)
  const codigos = [...new Set(disputas.map((d) => d.codigo_cliente))];
  let nombresPorCodigo: Record<string, string> = {};
  if (codigos.length > 0) {
    try {
      const adapter = await adaptadorParaEmpresa(empresaId);
      const clientes = await adapter.clientes();
      const buscados = new Set(codigos.map((c) => String(c).trim()));
      nombresPorCodigo = Object.fromEntries(
        clientes.filter((c) => buscados.has(c.codigo)).map((c) => [c.codigo, c.nombre])
      );
    } catch {
      // ERP puede no estar disponible — continuar sin nombres
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
 *
 * La lógica vive en lib/cobranzas/disputas.ts — compartida con la tool
 * crear_disputa del agente conversacional.
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

  const resultado = await crearDisputa(
    { codigoCliente: d.codigo_cliente, ijInum: d.ij_inum, motivo: d.motivo, montoDisputado: d.monto_disputado },
    { userId: String(session.userId), userEmail: session.email },
    empresaIdDeSesion(session)
  );

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: resultado.id });
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
