import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { getMockCartera } from '@/lib/mock/cartera-mock';

/**
 * GET /api/portal/[token]
 * Retorna facturas pendientes del cliente asociado al token.
 * CP-07: Verifica token válido y no expirado.
 * No requiere session auth — acceso público por token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    // CP-07: Verificar token
    const tokens = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
      fecha_expiracion: string;
      activo: number;
    }>(
      'SELECT id, codigo_cliente, fecha_expiracion, activo FROM cobranza_portal_tokens WHERE token = ? AND activo = 1 AND fecha_expiracion > NOW() LIMIT 1',
      [token]
    );

    if (tokens.length === 0) {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 });
    }

    const portalToken = tokens[0];

    // Actualizar último acceso
    await cobranzasExecute(
      'UPDATE cobranza_portal_tokens SET ultimo_acceso = NOW() WHERE id = ?',
      [portalToken.id]
    );

    const codigoCliente = portalToken.codigo_cliente;

    // Obtener facturas del cliente
    const softecOk = await testSoftecConnection();
    let facturas: Record<string, unknown>[] = [];
    let nombreCliente = '';

    if (softecOk) {
      // Query Softec — CP-01: SOLO SELECT, CP-04: filtros obligatorios
      const rows = await softecQuery<Record<string, unknown>>(`
        SELECT
          c.IC_NAME AS nombre_cliente,
          f.IJ_INUM AS numero_interno,
          CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS ncf_fiscal,
          f.IJ_DATE AS fecha_emision,
          f.IJ_DUEDATE AS fecha_vencimiento,
          DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencido,
          f.IJ_TOT AS total_factura,
          f.IJ_TOTAPPL AS total_pagado,
          (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_pendiente,
          f.IJ_CURRENC AS moneda
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE
        WHERE f.IJ_CCODE = ?
          AND f.IJ_TYPEDOC = 'IN'
          AND f.IJ_INVTORF = 'T'
          AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        ORDER BY f.IJ_DUEDATE ASC
      `, [codigoCliente]);

      facturas = rows;
      if (rows.length > 0) {
        nombreCliente = String(rows[0].nombre_cliente || '');
      }
    } else {
      // Mock mode
      const mockData = getMockCartera();
      const clienteFacturas = mockData.filter(f => f.codigo_cliente === codigoCliente);
      if (clienteFacturas.length > 0) {
        nombreCliente = clienteFacturas[0].nombre_cliente;
        facturas = clienteFacturas.map(f => ({
          numero_interno: f.numero_interno,
          ncf_fiscal: f.ncf_fiscal,
          fecha_emision: f.fecha_emision,
          fecha_vencimiento: f.fecha_vencimiento,
          dias_vencido: f.dias_vencido,
          total_factura: f.total_factura,
          total_pagado: f.total_pagado,
          saldo_pendiente: f.saldo_pendiente,
          moneda: f.moneda,
        }));
      } else {
        // Demo: mostrar primeras facturas
        nombreCliente = mockData[0]?.nombre_cliente || 'Cliente Demo';
        facturas = mockData.slice(0, 5).map(f => ({
          numero_interno: f.numero_interno,
          ncf_fiscal: f.ncf_fiscal,
          fecha_emision: f.fecha_emision,
          fecha_vencimiento: f.fecha_vencimiento,
          dias_vencido: f.dias_vencido,
          total_factura: f.total_factura,
          total_pagado: f.total_pagado,
          saldo_pendiente: f.saldo_pendiente,
          moneda: f.moneda,
        }));
      }
    }

    // Obtener documentos vinculados
    const docs = await cobranzasQuery<{
      ij_inum: number;
      url_pdf: string;
    }>(
      'SELECT ij_inum, url_pdf FROM cobranza_facturas_documentos WHERE codigo_cliente = ?',
      [codigoCliente]
    );
    const docMap = new Map(docs.map(d => [Number(d.ij_inum), d.url_pdf]));

    const facturasConDocs = facturas.map(f => {
      const inum = Number(f.numero_interno);
      return {
        ...f,
        tiene_pdf: docMap.has(inum),
        url_pdf: docMap.get(inum) || null,
      };
    });

    // Obtener acuerdos de pago activos
    const acuerdos = await cobranzasQuery<{
      id: number;
      ij_inum: number;
      monto_prometido: number;
      fecha_prometida: string;
      estado: string;
    }>(
      "SELECT id, ij_inum, monto_prometido, fecha_prometida, estado FROM cobranza_acuerdos WHERE codigo_cliente = ? AND estado = 'PENDIENTE' ORDER BY fecha_prometida ASC",
      [codigoCliente]
    );

    const totalSaldo = facturasConDocs.reduce((sum: number, f: Record<string, unknown>) =>
      sum + Number(f.saldo_pendiente || 0), 0);

    return NextResponse.json({
      cliente: {
        codigo: codigoCliente,
        nombre: nombreCliente,
      },
      facturas: facturasConDocs,
      acuerdos,
      resumen: {
        total_facturas: facturasConDocs.length,
        saldo_total: totalSaldo,
      },
      modo: softecOk ? 'live' : 'mock',
    });
  } catch (error) {
    console.error('[PORTAL] Error:', error);
    return NextResponse.json({ error: 'Error cargando datos del portal' }, { status: 500 });
  }
}
