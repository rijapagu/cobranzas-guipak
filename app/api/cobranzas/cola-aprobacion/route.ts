import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import type { CobranzaGestion, ColaAprobacionResponse } from '@/lib/types/cobranzas';

/**
 * GET /api/cobranzas/cola-aprobacion
 * Lista gestiones pendientes de aprobación.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const segmento = searchParams.get('segmento');
    const canal = searchParams.get('canal');
    const busqueda = searchParams.get('busqueda');
    const estado = searchParams.get('estado') || 'PENDIENTE';

    let sql = `
      SELECT g.*,
        (SELECT COUNT(*) FROM cobranza_gestiones WHERE estado = 'PENDIENTE') as total_pendientes,
        (SELECT COUNT(*) FROM cobranza_gestiones WHERE estado = 'APROBADO' AND DATE(fecha_aprobacion) = CURDATE()) as aprobadas_hoy,
        (SELECT COUNT(*) FROM cobranza_gestiones WHERE estado = 'DESCARTADO' AND DATE(updated_at) = CURDATE()) as descartadas_hoy,
        (SELECT COUNT(*) FROM cobranza_gestiones WHERE estado = 'ESCALADO' AND DATE(updated_at) = CURDATE()) as escaladas_hoy
      FROM cobranza_gestiones g
      WHERE g.estado = ?
    `;
    const params: (string | number)[] = [estado];

    if (segmento) {
      sql += ' AND g.segmento_riesgo = ?';
      params.push(segmento);
    }
    if (canal) {
      sql += ' AND g.canal = ?';
      params.push(canal);
    }
    if (busqueda) {
      sql += ' AND (g.codigo_cliente LIKE ? OR g.codigo_cliente IN (SELECT IC_CODE FROM cobranza_clientes_enriquecidos WHERE contacto_cobros LIKE ?))';
      params.push(`%${busqueda}%`, `%${busqueda}%`);
    }

    sql += ' ORDER BY g.dias_vencido DESC, g.created_at ASC';

    const rows = await cobranzasQuery<CobranzaGestion & {
      total_pendientes: number;
      aprobadas_hoy: number;
      descartadas_hoy: number;
      escaladas_hoy: number;
    }>(sql, params);

    const response: ColaAprobacionResponse = {
      gestiones: rows,
      total: rows.length,
      pendientes: rows[0]?.total_pendientes || 0,
      aprobadas_hoy: rows[0]?.aprobadas_hoy || 0,
      descartadas_hoy: rows[0]?.descartadas_hoy || 0,
      escaladas_hoy: rows[0]?.escaladas_hoy || 0,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[COLA] Error:', error);
    return NextResponse.json({ error: 'Error consultando cola' }, { status: 500 });
  }
}
