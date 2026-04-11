import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import * as XLSX from 'xlsx';

/**
 * GET /api/cobranzas/reportes/gestiones-excel?desde=2026-04-01&hasta=2026-04-30
 * Exporta historial de gestiones del período a Excel.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const desde = request.nextUrl.searchParams.get('desde') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const hasta = request.nextUrl.searchParams.get('hasta') || new Date().toISOString().split('T')[0];

    const gestiones = await cobranzasQuery<Record<string, unknown>>(
      `SELECT
        g.id AS 'ID',
        g.codigo_cliente AS 'Código Cliente',
        g.ij_inum AS '# Factura',
        g.segmento_riesgo AS 'Segmento',
        g.canal AS 'Canal',
        g.saldo_pendiente AS 'Saldo',
        g.moneda AS 'Moneda',
        g.dias_vencido AS 'Días Vencido',
        g.estado AS 'Estado',
        g.aprobado_por AS 'Aprobado Por',
        g.fecha_aprobacion AS 'Fecha Aprobación',
        g.fecha_envio AS 'Fecha Envío',
        g.motivo_descarte AS 'Motivo Descarte',
        g.creado_por AS 'Creado Por',
        g.created_at AS 'Fecha Creación'
      FROM cobranza_gestiones g
      WHERE DATE(g.created_at) BETWEEN ? AND ?
      ORDER BY g.created_at DESC`,
      [desde, hasta]
    );

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(gestiones);

    ws['!cols'] = [
      { wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
      { wch: 15 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
      { wch: 18 }, { wch: 18 }, { wch: 25 }, { wch: 15 }, { wch: 18 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Gestiones');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await logAccion(session.email, 'REPORTE_GESTIONES_EXCEL', 'reporte', 'gestiones', {
      desde, hasta, total_registros: gestiones.length,
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="gestiones-${desde}-a-${hasta}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-GESTIONES] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
