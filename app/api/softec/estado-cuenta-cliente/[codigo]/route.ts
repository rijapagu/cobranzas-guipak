import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';

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
  { params }: { params: { codigo: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const codigo = params.codigo?.trim();
  if (!codigo) {
    return NextResponse.json({ error: 'Código de cliente requerido' }, { status: 400 });
  }

  try {
    const softecOk = await testSoftecConnection();
    let facturas: FacturaEstadoCuenta[] = [];
    let nombreCliente = codigo;

    if (softecOk) {
      const rows = await softecQuery<Record<string, unknown>>(`
        SELECT
          c.IC_NAME           AS nombre_cliente,
          f.IJ_INUM           AS numero,
          CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS ncf,
          f.IJ_DATE           AS fecha_emision,
          f.IJ_DUEDATE        AS fecha_vencimiento,
          DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencido,
          f.IJ_TOT            AS total,
          f.IJ_TOTAPPL        AS pagado,
          (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo,
          f.IJ_CURRENC        AS moneda
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE
        WHERE f.IJ_CCODE = ?
          AND f.IJ_TYPEDOC = 'IN'
          AND f.IJ_INVTORF = 'T'
          AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        ORDER BY f.IJ_DUEDATE ASC
      `, [codigo]);

      if (rows.length > 0) nombreCliente = String(rows[0].nombre_cliente);

      facturas = rows.map((r) => ({
        numero: Number(r.numero),
        ncf: String(r.ncf ?? ''),
        fecha_emision: String(r.fecha_emision ?? ''),
        fecha_vencimiento: String(r.fecha_vencimiento ?? ''),
        dias_vencido: Number(r.dias_vencido),
        total: Number(r.total),
        pagado: Number(r.pagado),
        saldo: Number(r.saldo),
        moneda: String(r.moneda ?? 'DOP'),
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
