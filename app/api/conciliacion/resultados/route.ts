import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import type { ConciliacionEntry, ResultadoConciliacion } from '@/lib/types/conciliacion';

/**
 * GET /api/conciliacion/resultados
 * Lista resultados de conciliación con filtros y stats.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const estado = searchParams.get('estado');
    const fechaExtracto = searchParams.get('fecha_extracto');

    let sql = 'SELECT * FROM cobranza_conciliacion WHERE 1=1';
    const params: (string | number)[] = [];

    if (estado) {
      sql += ' AND estado = ?';
      params.push(estado);
    }
    if (fechaExtracto) {
      sql += ' AND fecha_extracto = ?';
      params.push(fechaExtracto);
    }

    sql += ' ORDER BY fecha_transaccion DESC, id DESC';

    const entradas = await cobranzasQuery<ConciliacionEntry>(sql, params);

    // Stats
    const allEntries = await cobranzasQuery<{ estado: string; monto: number }>(
      'SELECT estado, monto FROM cobranza_conciliacion' +
      (fechaExtracto ? ' WHERE fecha_extracto = ?' : ''),
      fechaExtracto ? [fechaExtracto] : []
    );

    const stats = {
      conciliadas: 0,
      por_aplicar: 0,
      desconocidas: 0,
      monto_conciliado: 0,
      monto_por_aplicar: 0,
      monto_desconocido: 0,
    };

    for (const e of allEntries) {
      if (e.estado === 'CONCILIADO') {
        stats.conciliadas++;
        stats.monto_conciliado += Number(e.monto);
      } else if (e.estado === 'POR_APLICAR') {
        stats.por_aplicar++;
        stats.monto_por_aplicar += Number(e.monto);
      } else {
        stats.desconocidas++;
        stats.monto_desconocido += Number(e.monto);
      }
    }

    const response: ResultadoConciliacion = {
      entradas,
      total: entradas.length,
      ...stats,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[CONCILIACION-RESULTADOS] Error:', error);
    return NextResponse.json({ error: 'Error consultando resultados' }, { status: 500 });
  }
}
