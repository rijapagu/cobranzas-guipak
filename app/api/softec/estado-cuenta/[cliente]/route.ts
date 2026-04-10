import { NextRequest, NextResponse } from 'next/server';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { getMockPagos } from '@/lib/mock/cartera-mock';
import type { PagoAplicado } from '@/lib/types/cartera';

/**
 * GET /api/softec/estado-cuenta/[cliente]?factura=1234
 * Retorna el historial de pagos de una factura de un cliente.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cliente: string }> }
) {
  try {
    const { cliente } = await params;
    const factura = request.nextUrl.searchParams.get('factura');

    if (!factura) {
      return NextResponse.json({ error: 'Parámetro factura requerido' }, { status: 400 });
    }

    const softecOk = await testSoftecConnection();
    let pagos: PagoAplicado[];

    if (softecOk) {
      pagos = await softecQuery<PagoAplicado>(
        `SELECT
          r.IR_PDATE          AS fecha_pago,
          r.IR_PAYDOC         AS tipo_recibo,
          r.IR_RECNUM         AS numero_recibo,
          r.IR_FTYPDOC        AS tipo_factura,
          r.IR_FINUM          AS numero_factura,
          r.IR_AMTPAID        AS monto_aplicado,
          r.IR_DAMTPAI        AS monto_aplicado_dop,
          p.IJ_DATE           AS fecha_recibo,
          p.IJ_TOT            AS total_recibo,
          p.IJ_DESCR          AS referencia_pago
        FROM irjnl r
        LEFT JOIN ijnl_pay p
          ON  p.IJ_LOCAL  = r.IR_PLOCAL
          AND p.IJ_RECNUM = r.IR_RECNUM
        WHERE
          r.IR_CCODE   = ?
          AND r.IR_FINUM = ?
        ORDER BY r.IR_PDATE ASC`,
        [cliente, Number(factura)]
      );
    } else {
      pagos = getMockPagos(Number(factura));
    }

    return NextResponse.json({
      cliente,
      factura: Number(factura),
      pagos,
      modo: softecOk ? 'live' : 'mock',
    });
  } catch (error) {
    console.error('[ESTADO-CUENTA] Error:', error);
    return NextResponse.json({ error: 'Error consultando estado de cuenta' }, { status: 500 });
  }
}
