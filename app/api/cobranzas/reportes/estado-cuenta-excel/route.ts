import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { logAccion } from '@/lib/db/cobranzas';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import * as XLSX from 'xlsx';

/**
 * GET /api/cobranzas/reportes/estado-cuenta-excel?cliente=0000274
 * Exporta estado de cuenta de un cliente a Excel.
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
    let facturas;
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

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(facturas);
    ws['!cols'] = [
      { wch: 35 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 8 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Estado de Cuenta');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().split('T')[0];

    await logAccion(session.email, 'REPORTE_ESTADO_CUENTA_EXCEL', 'reporte', codigoCliente, {
      codigo_cliente: codigoCliente, total_registros: facturas.length,
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
