import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import * as XLSX from 'xlsx';

/**
 * GET /api/cobranzas/reportes/estado-cuenta-excel?cliente=0000274
 *
 * Exporta el estado de cuenta de un cliente a Excel. Dos hojas:
 *   1. "Estado de Cuenta" — facturas pendientes con saldo bruto.
 *      Cada fila incluye Saldo a Favor y Saldo Neto del cliente (CP-15)
 *      repetidos en cada fila para que el lector no tenga que cambiar
 *      de hoja para verlos.
 *   2. "Resumen" — totales a nivel cliente: bruto, a favor, neto y si
 *      está cubierto por anticipo.
 *
 * CP-15 (10-may-2026): si el cliente tiene recibos sin aplicar (saldo a
 * favor), el "saldo cobrable" real es bruto - favor. Esto se alinea con
 * la lógica del portal cliente y de cartera-excel.
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
    // Todas las empresas exportan desde el adaptador ERP (lib/erp).
    // CP-15 es solo-Softec; el mock solo aplica a Guipak sin conexión.
    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());
    let facturas: Record<string, unknown>[];
    let nombreCliente = codigoCliente;

    if (!esGuipak || softecOk) {
      const [cartera, cli] = await Promise.all([
        adapter.carteraPendiente({ incluirPorVencerDias: 36500, codigoCliente }),
        adapter.cliente(codigoCliente),
      ]);
      const delCliente = cartera
        .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento));
      if (cli) nombreCliente = cli.nombre;
      else if (delCliente[0]) nombreCliente = delCliente[0].nombreCliente;
      facturas = delCliente.map((f) => ({
        'Nombre Cliente': f.nombreCliente,
        '# Factura': f.numero,
        'NCF': f.ncf ?? '',
        'Fecha Emisión': f.fechaEmision ?? '',
        'Fecha Vencimiento': f.fechaVencimiento,
        'Días Vencido': f.diasVencida,
        'Total': f.total,
        'Pagado': f.totalPagado ?? Math.max(0, f.total - f.saldoPendiente),
        'Saldo': f.saldoPendiente,
        'Moneda': f.moneda,
      }));
    } else {
      const mock = getMockCartera().filter(f => f.codigo_cliente === codigoCliente);
      if (mock.length > 0) nombreCliente = mock[0].nombre_cliente;
      facturas = (mock.length > 0 ? mock : getMockCartera().slice(0, 5)).map(f => ({
        'Nombre Cliente': f.nombre_cliente,
        '# Factura': f.numero_interno,
        'NCF': f.ncf_fiscal,
        'Fecha Emisión': f.fecha_emision,
        'Fecha Vencimiento': f.fecha_vencimiento,
        'Días Vencido': f.dias_vencido,
        'Total': f.total_factura,
        'Pagado': f.total_pagado,
        'Saldo': f.saldo_pendiente,
        'Moneda': f.moneda,
      }));
    }

    // CP-15: calcular bruto / a favor / neto a nivel cliente. Solo con
    // datos reales (Softec); el mock no tiene tabla de recibos.
    const saldoBruto = facturas.reduce(
      (sum, f) => sum + (Number(f['Saldo']) || 0),
      0
    );
    let saldoAFavor = 0;
    if (softecOk) {
      const favorMap = await obtenerSaldoAFavorPorCliente([codigoCliente]);
      saldoAFavor = favorMap.get(String(codigoCliente).trim()) ?? 0;
    }
    const ajuste = ajustarSaldoCliente(saldoBruto, saldoAFavor);

    // Enriquecer cada fila con los totales a nivel cliente (se repiten).
    // Útil para que filtros/segmentaciones en Excel los lean sin cambiar de hoja.
    if (facturas.length > 0) {
      facturas = facturas.map(f => ({
        ...f,
        'Saldo a Favor (cliente)': ajuste.saldo_a_favor,
        'Saldo Neto (cliente)': ajuste.saldo_neto,
        'Cubierto por Anticipo': ajuste.cubierto_por_anticipo ? 'SÍ' : 'NO',
      }));
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(facturas);
    ws['!cols'] = [
      { wch: 35 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 8 },
      { wch: 20 }, { wch: 18 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Estado de Cuenta');

    // Hoja "Resumen": montos a nivel cliente — incluye la lectura clave
    // para el lector (cobrable real cuando hay anticipos).
    const resumenRows: Record<string, unknown>[] = [
      { Concepto: 'Cliente', Valor: nombreCliente },
      { Concepto: 'Código', Valor: codigoCliente },
      { Concepto: 'Facturas pendientes', Valor: facturas.length },
      { Concepto: 'Saldo bruto (RD$)', Valor: ajuste.saldo_pendiente },
      { Concepto: 'Saldo a favor / anticipos (RD$)', Valor: ajuste.saldo_a_favor },
      { Concepto: 'Saldo neto cobrable (RD$)', Valor: ajuste.saldo_neto },
      {
        Concepto: 'Cubierto por anticipo',
        Valor: ajuste.cubierto_por_anticipo ? 'SÍ' : 'NO',
      },
      {
        Concepto: 'Nota',
        Valor: ajuste.cubierto_por_anticipo
          ? 'El cliente tiene saldo a favor que cubre todo su pendiente.'
          : ajuste.saldo_a_favor > 0
            ? 'El saldo neto descuenta el saldo a favor del cliente.'
            : 'El cliente no tiene saldo a favor.',
      },
    ];
    const wsResumen = XLSX.utils.json_to_sheet(resumenRows);
    wsResumen['!cols'] = [{ wch: 38 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().split('T')[0];

    await logAccion(session.email, 'REPORTE_ESTADO_CUENTA_EXCEL', 'reporte', codigoCliente, {
      codigo_cliente: codigoCliente,
      total_registros: facturas.length,
      saldo_bruto: ajuste.saldo_pendiente,
      saldo_a_favor: ajuste.saldo_a_favor,
      saldo_neto: ajuste.saldo_neto,
    });

    const nombreArchivo = nombreCliente.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="estado-cuenta-${nombreArchivo}-${fecha}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-ESTADO-CUENTA] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
