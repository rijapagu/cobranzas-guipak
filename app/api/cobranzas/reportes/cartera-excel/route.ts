import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { generarExcelCartera } from '@/lib/reportes/excel';

/**
 * GET /api/cobranzas/reportes/cartera-excel
 * Exporta la cartera vencida completa a Excel.
 *
 * La generación vive en lib/reportes/excel.ts — compartida con la tool
 * enviar_reporte_excel del agente conversacional.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const empresaId = empresaIdDeSesion(session);
    const { buffer, filename, registros } = await generarExcelCartera(empresaId);

    await logAccion(session.email, 'REPORTE_CARTERA_EXCEL', 'reporte', 'cartera', {
      total_registros: registros,
    });

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-EXCEL] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
