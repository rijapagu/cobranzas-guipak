import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { logAccion } from '@/lib/db/cobranzas';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
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
    const softecOk = await testSoftecConnection();
    let facturas: Record<string, unknown>[];
    let nombreCliente = codigoCliente;

    if (softecOk) {
      facturas = await softecQuery<Record<string, unknown>>(`
        SELECT
          c.IC_NAME AS 'Nombre Cliente',
          f.IJ_INUM AS '# Factura',
          CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS 'NCF',
          f.IJ_DATE AS 'Fecha Emisión',
          f.IJ_DUEDATE AS 'Fecha Vencimiento',
          DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS 'Días Vencido',
          f.IJ_TOT AS 'Total',
          f.IJ_TOTAPPL AS 'Pagado',
          (f.IJ_TOT - f.IJ_TOTAPPL) AS 'Saldo',
          f.IJ_CURRENC AS 'Moneda'
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE
        WHERE f.IJ_CCODE = ?
          AND f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        ORDER BY f.IJ_DUEDATE ASC
      `, [codigoCliente]);

      if (facturas.length > 0) {
        nombreCliente = String(facturas[0]['Nombre Cliente']);
      }
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
