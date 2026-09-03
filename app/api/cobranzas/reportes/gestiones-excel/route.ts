import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion } from '@/lib/tenant';
import { logAccion } from '@/lib/db/cobranzas';
import { generarExcelGestiones } from '@/lib/reportes/excel';

/**
 * GET /api/cobranzas/reportes/gestiones-excel?desde=2026-04-01&hasta=2026-04-30
 * Exporta historial de gestiones del período a Excel.
 *
 * La generación vive en lib/reportes/excel.ts — compartida con la tool
 * enviar_reporte_excel del agente conversacional.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const desde = request.nextUrl.searchParams.get('desde') || undefined;
    const hasta = request.nextUrl.searchParams.get('hasta') || undefined;

    const { buffer, filename, registros } = await generarExcelGestiones(
      empresaIdDeSesion(session),
      desde,
      hasta
    );

    await logAccion(session.email, 'REPORTE_GESTIONES_EXCEL', 'reporte', 'gestiones', {
      desde, hasta, total_registros: registros,
    });

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-GESTIONES] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
