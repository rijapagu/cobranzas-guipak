import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { cobranzasQuery } from '@/lib/db/cobranzas';

/**
 * GET /api/conciliacion/verificar-depositos?dias=7
 *
 * Compara recibos EF+CK en Softec vs depósitos consolidados en el banco.
 * Detecta dinero cobrado que no fue depositado (riesgo de fuga).
 *
 * Flujo:
 *   1. Obtener recibos RC con IJ_PAY IN ('EF','CK') de últimos N días
 *   2. Agrupar por fecha
 *   3. Obtener depósitos "DEPOSITO CHEQUE Y EFECTIVO" + "COBRO" del banco
 *   4. Comparar totales por rango de fecha
 *   5. Alertar discrepancias
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const dias = parseInt(request.nextUrl.searchParams.get('dias') || '7', 10);

    const softecOk = await testSoftecConnection();
    if (!softecOk) {
      return NextResponse.json({ error: 'No se pudo conectar a Softec' }, { status: 503 });
    }

    // 1. Recibos EF+CK de Softec (últimos N días)
    const recibos = await softecQuery<{
      fecha: string;
      ij_pay: string;
      total: number;
      cantidad: number;
    }>(
      `SELECT
         DATE(IJ_DATE) AS fecha,
         IJ_PAY AS ij_pay,
         SUM(IJ_TOT) AS total,
         COUNT(*) AS cantidad
       FROM v_cobr_ijnl_pay
       WHERE IJ_SINORIN = 'RC'
         AND IJ_PAY IN ('EF', 'CK')
         AND IJ_DATE >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(IJ_DATE), IJ_PAY
       ORDER BY fecha DESC`,
      [dias]
    );

    // 2. Depósitos consolidados del banco (ya cargados en conciliación)
    const depositos = await cobranzasQuery<{
      fecha: string;
      total: number;
      cantidad: number;
    }>(
      `SELECT
         fecha_transaccion AS fecha,
         SUM(monto) AS total,
         COUNT(*) AS cantidad
       FROM cobranza_conciliacion
       WHERE estado != 'CHEQUE_DEVUELTO'
         AND (descripcion LIKE '%DEPOSITO CHEQUE%'
              OR descripcion LIKE '%COBRO %'
              OR descripcion LIKE '%CORBO %')
         AND fecha_transaccion >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY fecha_transaccion
       ORDER BY fecha DESC`,
      [dias + 3]
    );

    // 3. Agrupar recibos Softec por fecha
    const recibosPorFecha = new Map<string, { efectivo: number; cheques: number; total: number; cantidad: number }>();
    for (const r of recibos) {
      const fecha = String(r.fecha).substring(0, 10);
      const entry = recibosPorFecha.get(fecha) || { efectivo: 0, cheques: 0, total: 0, cantidad: 0 };
      const monto = Number(r.total);
      if (r.ij_pay === 'EF') entry.efectivo += monto;
      if (r.ij_pay === 'CK') entry.cheques += monto;
      entry.total += monto;
      entry.cantidad += Number(r.cantidad);
      recibosPorFecha.set(fecha, entry);
    }

    // 4. Depósitos bancarios por fecha
    const depositosPorFecha = new Map<string, number>();
    for (const d of depositos) {
      const fecha = String(d.fecha).substring(0, 10);
      depositosPorFecha.set(fecha, (depositosPorFecha.get(fecha) || 0) + Number(d.total));
    }

    // 5. Comparar: para cada fecha de recibos, buscar depósito ±3 días
    const alertas: {
      fecha_recibos: string;
      recibos_efectivo: number;
      recibos_cheques: number;
      recibos_total: number;
      recibos_cantidad: number;
      depositado: number;
      diferencia: number;
      estado: 'OK' | 'PARCIAL' | 'SIN_DEPOSITO';
    }[] = [];

    for (const [fecha, info] of recibosPorFecha) {
      // Buscar depósitos ±3 días de esta fecha de recibos
      let depositado = 0;
      const fechaBase = new Date(fecha);
      for (let offset = 0; offset <= 3; offset++) {
        for (const dir of [0, 1, -1]) {
          const check = new Date(fechaBase);
          check.setDate(check.getDate() + offset * (dir || 1));
          const key = check.toISOString().substring(0, 10);
          if (depositosPorFecha.has(key)) {
            depositado += depositosPorFecha.get(key)!;
          }
        }
      }

      const diferencia = info.total - depositado;

      let estado: 'OK' | 'PARCIAL' | 'SIN_DEPOSITO' = 'OK';
      if (depositado === 0) {
        estado = 'SIN_DEPOSITO';
      } else if (diferencia > 1) {
        estado = 'PARCIAL';
      }

      alertas.push({
        fecha_recibos: fecha,
        recibos_efectivo: info.efectivo,
        recibos_cheques: info.cheques,
        recibos_total: info.total,
        recibos_cantidad: info.cantidad,
        depositado,
        diferencia,
        estado,
      });
    }

    const sinDepositar = alertas.filter(a => a.estado !== 'OK');
    const montoSinDepositar = sinDepositar.reduce((s, a) => s + a.diferencia, 0);

    return NextResponse.json({
      dias_analizados: dias,
      total_recibos_ef_ck: recibos.reduce((s, r) => s + Number(r.total), 0),
      total_depositado: depositos.reduce((s, d) => s + Number(d.total), 0),
      alertas_count: sinDepositar.length,
      monto_sin_depositar: montoSinDepositar,
      detalle: alertas,
    });
  } catch (error) {
    console.error('[VERIFICAR-DEPOSITOS] Error:', error);
    return NextResponse.json({ error: 'Error verificando depósitos' }, { status: 500 });
  }
}
