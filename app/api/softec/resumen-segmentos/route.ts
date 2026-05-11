import { NextResponse } from 'next/server';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockResumen } from '@/lib/mock/cartera-mock';
import type { ResumenSegmento, ResumenResponse } from '@/lib/types/cartera';

/**
 * GET /api/softec/resumen-segmentos
 * Retorna resumen de cartera agrupado por segmento de riesgo.
 *
 * CP-15: el `saldo_total` por segmento sigue siendo el bruto (porque los
 * anticipos pertenecen a clientes que pueden tener facturas en varios
 * segmentos — no se distribuyen). El ajuste se hace solo a nivel agregado
 * total: `total_a_favor` y `total_neto`.
 */
export async function GET() {
  try {
    const softecOk = await testSoftecConnection();
    let segmentos: ResumenSegmento[];

    if (softecOk) {
      segmentos = await softecQuery<ResumenSegmento>(`
        SELECT
          CASE
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN 'AMARILLO'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30              THEN 'ROJO'
            ELSE 'VERDE'
          END                             AS segmento,
          COUNT(*)                        AS num_facturas,
          COUNT(DISTINCT f.IJ_CCODE)      AS num_clientes,
          SUM(f.IJ_TOT - f.IJ_TOTAPPL)   AS saldo_total
        FROM v_cobr_ijnl f
        WHERE
          f.IJ_TYPEDOC  = 'IN'
          AND f.IJ_INVTORF = 'T'
          AND f.IJ_PAID    = 'F'
          AND f.IJ_DUEDATE < CURDATE()
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        GROUP BY segmento
        ORDER BY FIELD(segmento, 'ROJO', 'NARANJA', 'AMARILLO', 'VERDE')
      `);
    } else {
      segmentos = getMockResumen();
    }

    const totalCartera = segmentos.reduce((sum, s) => sum + Number(s.saldo_total), 0);
    const totalFacturas = segmentos.reduce((sum, s) => sum + Number(s.num_facturas), 0);
    const totalClientes = segmentos.reduce((sum, s) => sum + Number(s.num_clientes), 0);

    // CP-15: agregado a favor / neto. Solo con datos reales.
    let totalAFavor: number | undefined;
    let totalNeto: number | undefined;
    if (softecOk) {
      const saldosFavor = await obtenerSaldoAFavorPorCliente();
      // Restamos solo lo que efectivamente cubre pendiente (no transferimos
      // saldo a favor de un cliente sin facturas a otros).
      const clientesConPendiente = await softecQuery<{ codigo_cliente: string; pendiente: number }>(
        `SELECT
           f.IJ_CCODE                          AS codigo_cliente,
           SUM(f.IJ_TOT - f.IJ_TOTAPPL)        AS pendiente
         FROM v_cobr_ijnl f
         WHERE f.IJ_TYPEDOC = 'IN'
           AND f.IJ_INVTORF = 'T'
           AND f.IJ_PAID    = 'F'
           AND f.IJ_DUEDATE < CURDATE()
           AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
         GROUP BY f.IJ_CCODE`
      );
      let aFavorAplicable = 0;
      let netoAcumulado = 0;
      for (const r of clientesConPendiente) {
        const codigo = String(r.codigo_cliente).trim();
        const pendiente = Number(r.pendiente) || 0;
        const favor = saldosFavor.get(codigo) ?? 0;
        const aplicable = Math.min(pendiente, favor);
        aFavorAplicable += aplicable;
        netoAcumulado += Math.max(0, pendiente - favor);
      }
      totalAFavor = Math.round(aFavorAplicable * 100) / 100;
      totalNeto = Math.round(netoAcumulado * 100) / 100;
    }

    const response: ResumenResponse = {
      segmentos,
      total_cartera: Math.round(totalCartera * 100) / 100,
      total_facturas: totalFacturas,
      total_clientes: totalClientes,
      modo: softecOk ? 'live' : 'mock',
      total_a_favor: totalAFavor,
      total_neto: totalNeto,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[RESUMEN] Error:', error);
    return NextResponse.json({ error: 'Error consultando resumen' }, { status: 500 });
  }
}
