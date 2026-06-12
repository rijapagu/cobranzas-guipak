import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';

export interface FacturaEstadoCuenta {
  numero: number;
  ncf: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  dias_vencido: number;
  total: number;
  pagado: number;
  saldo: number;
  moneda: string;
}

export interface EstadoCuentaCliente {
  codigo_cliente: string;
  nombre_cliente: string;
  facturas: FacturaEstadoCuenta[];
  resumen: {
    total_facturas: number;
    saldo_bruto: number;
    saldo_a_favor: number;
    saldo_neto: number;
    cubierto_por_anticipo: boolean;
  };
}

/**
 * GET /api/softec/estado-cuenta-cliente/[codigo]
 *
 * Devuelve el estado de cuenta completo de un cliente en JSON.
 * Incluye TODAS las facturas pendientes (vencidas y por vencer),
 * igual que el estado de cuenta en Softec.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { codigo: codigoRaw } = await params;
  const codigo = codigoRaw?.trim();
  if (!codigo) {
    return NextResponse.json({ error: 'Código de cliente requerido' }, { status: 400 });
  }

  try {
    // Todas las empresas leen via adaptador ERP (lib/erp). CP-15 (saldo a
    // favor) es solo-Softec; el mock solo aplica a Guipak sin conexión.
    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());
    let facturas: FacturaEstadoCuenta[] = [];
    let nombreCliente = codigo;

    if (!esGuipak || softecOk) {
      const [cartera, cli] = await Promise.all([
        adapter.carteraPendiente({ incluirPorVencerDias: 36500, codigoCliente: codigo }),
        adapter.cliente(codigo),
      ]);
      if (cli) nombreCliente = cli.nombre;
      else if (cartera[0]) nombreCliente = cartera[0].nombreCliente;
      facturas = cartera
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))
        .map((f) => ({
          numero: f.numero,
          ncf: f.ncf ?? '',
          fecha_emision: f.fechaEmision ?? '',
          fecha_vencimiento: f.fechaVencimiento,
          dias_vencido: f.diasVencida,
          total: f.total,
          pagado: f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente),
          saldo: f.saldoPendiente,
          moneda: f.moneda,
        }));
    } else {
      const mock = getMockCartera().filter((f) => f.codigo_cliente === codigo);
      const fuente = mock.length > 0 ? mock : getMockCartera().slice(0, 5);
      if (fuente.length > 0) nombreCliente = fuente[0].nombre_cliente;
      facturas = fuente.map((f) => ({
        numero: f.numero_interno,
        ncf: f.ncf_fiscal,
        fecha_emision: String(f.fecha_emision),
        fecha_vencimiento: String(f.fecha_vencimiento),
        dias_vencido: f.dias_vencido,
        total: f.total_factura,
        pagado: f.total_pagado,
        saldo: f.saldo_pendiente,
        moneda: f.moneda,
      }));
    }

    const saldoBruto = facturas.reduce((s, f) => s + f.saldo, 0);
    let saldoAFavor = 0;
    if (softecOk) {
      const favorMap = await obtenerSaldoAFavorPorCliente([codigo]);
      saldoAFavor = favorMap.get(codigo) ?? 0;
    }
    const ajuste = ajustarSaldoCliente(saldoBruto, saldoAFavor);

    const body: EstadoCuentaCliente = {
      codigo_cliente: codigo,
      nombre_cliente: nombreCliente,
      facturas,
      resumen: {
        total_facturas: facturas.length,
        saldo_bruto: ajuste.saldo_pendiente,
        saldo_a_favor: ajuste.saldo_a_favor,
        saldo_neto: ajuste.saldo_neto,
        cubierto_por_anticipo: ajuste.cubierto_por_anticipo,
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error('[ESTADO-CUENTA-CLIENTE]', error);
    return NextResponse.json({ error: 'Error consultando estado de cuenta' }, { status: 500 });
  }
}
