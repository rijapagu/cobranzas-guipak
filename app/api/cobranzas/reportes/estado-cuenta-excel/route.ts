import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { generarExcelEstadoCuenta } from '@/lib/reportes/excel';

/**
 * GET /api/cobranzas/reportes/estado-cuenta-excel?cliente=0000274
 *
 * Exporta el estado de cuenta de un cliente a Excel (dos hojas: Estado de
 * Cuenta + Resumen con CP-15). La generación vive en lib/reportes/excel.ts —
 * compartida con la tool enviar_reporte_excel del agente conversacional.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const codigoCliente = request.nextUrl.searchParams.get('cliente');
  if (!codigoCliente) {
    return NextResponse.json({ error: 'Parámetro cliente requerido' }, { status: 400 });
  }

  try {
    const { buffer, filename, registros, saldo_bruto, saldo_a_favor, saldo_neto } =
      await generarExcelEstadoCuenta(empresaIdDeSesion(session), codigoCliente);

    await logAccion(session.email, 'REPORTE_ESTADO_CUENTA_EXCEL', 'reporte', codigoCliente, {
      codigo_cliente: codigoCliente,
      total_registros: registros,
      saldo_bruto,
      saldo_a_favor,
      saldo_neto,
    });

    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-ESTADO-CUENTA] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
