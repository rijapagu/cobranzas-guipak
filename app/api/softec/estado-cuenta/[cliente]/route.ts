import { NextRequest, NextResponse } from 'next/server';
import { getMockPagos } from '@/lib/mock/cartera-mock';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
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
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { cliente } = await params;
    const factura = request.nextUrl.searchParams.get('factura');

    if (!factura) {
      return NextResponse.json({ error: 'Parámetro factura requerido' }, { status: 400 });
    }

    // Todas las empresas leen via adaptador ERP (lib/erp): en orígenes sin
    // historial de pagos (CSV) devuelve []. El mock solo aplica a Guipak
    // sin conexión Softec.
    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());
    let pagos: PagoAplicado[];

    if (esGuipak && !softecOk) {
      pagos = getMockPagos(Number(factura));
    } else {
      const canon = await adapter.pagosFactura(Number(factura), cliente);
      pagos = canon.map((p) => ({
        fecha_pago: p.fecha,
        tipo_recibo: p.tipoRecibo ?? '',
        numero_recibo: p.numeroRecibo ?? 0,
        tipo_factura: 'IN',
        numero_factura: Number(factura),
        monto_aplicado: p.monto,
        monto_aplicado_dop: p.montoDop ?? p.monto,
        fecha_recibo: p.fechaRecibo ?? '',
        total_recibo: p.totalRecibo ?? 0,
        referencia_pago: p.referencia ?? '',
      }));
    }

    return NextResponse.json({
      cliente,
      factura: Number(factura),
      pagos,
      modo: esGuipak && !softecOk ? 'mock' : 'live',
    });
  } catch (error) {
    console.error('[ESTADO-CUENTA] Error:', error);
    return NextResponse.json({ error: 'Error consultando estado de cuenta' }, { status: 500 });
  }
}
