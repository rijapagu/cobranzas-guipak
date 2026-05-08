import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import * as XLSX from 'xlsx';

/**
 * GET /api/cobranzas/reportes/cartera-excel
 * Exporta la cartera vencida completa a Excel.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const softecOk = await testSoftecConnection();
    let facturas;

    if (softecOk) {
      // CP-04: filtros obligatorios
      facturas = await softecQuery<Record<string, unknown>>(`
        SELECT
          c.IC_CODE AS 'Código Cliente',
          c.IC_NAME AS 'Nombre Cliente',
          c.IC_RNC AS 'RNC',
          f.IJ_INUM AS '# Factura',
          CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS 'NCF',
          f.IJ_DATE AS 'Fecha Emisión',
          f.IJ_DUEDATE AS 'Fecha Vencimiento',
          DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS 'Días Vencido',
          f.IJ_TOT AS 'Total Factura',
          f.IJ_TOTAPPL AS 'Total Pagado',
          (f.IJ_TOT - f.IJ_TOTAPPL) AS 'Saldo Pendiente',
          f.IJ_CURRENC AS 'Moneda',
          f.IJ_SLSCODE AS 'Vendedor',
          CASE
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30 THEN 'ROJO'
            ELSE 'VERDE'
          END AS 'Segmento',
          c.IC_EMAIL AS 'Email',
          c.IC_PHONE AS 'Teléfono',
          c.IC_ARCONTC AS 'Contacto Cobros'
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
        WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
          AND f.IJ_DUEDATE < CURDATE()
        ORDER BY DATEDIFF(CURDATE(), f.IJ_DUEDATE) DESC
      `);
    } else {
      const mock = getMockCartera();
      facturas = mock.map(f => ({
        'Código Cliente': f.codigo_cliente,
        'Nombre Cliente': f.nombre_cliente,
        'RNC': f.rnc,
        '# Factura': f.numero_interno,
        'NCF': f.ncf_fiscal,
        'Fecha Emisión': f.fecha_emision,
        'Fecha Vencimiento': f.fecha_vencimiento,
        'Días Vencido': f.dias_vencido,
        'Total Factura': f.total_factura,
        'Total Pagado': f.total_pagado,
        'Saldo Pendiente': f.saldo_pendiente,
        'Moneda': f.moneda,
        'Vendedor': f.vendedor,
        'Segmento': f.segmento_riesgo,
        'Email': f.email || '',
        'Teléfono': f.telefono || '',
        'Contacto Cobros': f.contacto_cobros || '',
      }));
    }

    // Crear Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(facturas);

    // Ajustar anchos de columna
    ws['!cols'] = [
      { wch: 14 }, { wch: 35 }, { wch: 12 }, { wch: 10 }, { wch: 22 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 30 },
      { wch: 15 }, { wch: 20 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Cartera Vencida');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().split('T')[0];

    await logAccion(session.email, 'REPORTE_CARTERA_EXCEL', 'reporte', 'cartera', {
      total_registros: Array.isArray(facturas) ? facturas.length : 0,
      modo: softecOk ? 'live' : 'mock',
    });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="cartera-vencida-${fecha}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('[REPORTE-EXCEL] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
