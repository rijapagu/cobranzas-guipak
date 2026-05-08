import { NextResponse } from 'next/server';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { getMockResumen } from '@/lib/mock/cartera-mock';
import type { ResumenSegmento, ResumenResponse } from '@/lib/types/cartera';

/**
 * GET /api/softec/resumen-segmentos
 * Retorna resumen de cartera agrupado por segmento de riesgo.
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

    const totalCartera = segmentos.reduce((sum, s) => sum + s.saldo_total, 0);
    const totalFacturas = segmentos.reduce((sum, s) => sum + s.num_facturas, 0);
    const totalClientes = segmentos.reduce((sum, s) => sum + s.num_clientes, 0);

    const response: ResumenResponse = {
      segmentos,
      total_cartera: Math.round(totalCartera * 100) / 100,
      total_facturas: totalFacturas,
      total_clientes: totalClientes,
      modo: softecOk ? 'live' : 'mock',
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[RESUMEN] Error:', error);
    return NextResponse.json({ error: 'Error consultando resumen' }, { status: 500 });
  }
}
