/**
 * Verificación de acuerdos de pago — resuelve PENDIENTE → CUMPLIDO/INCUMPLIDO.
 *
 * Hasta ahora ningún código escribía estos estados: los KPIs de acuerdos
 * siempre daban 0 y el scoring asumía 100% de cumplimiento de promesas.
 *
 * Reglas (por acuerdo PENDIENTE con fecha_prometida <= hoy):
 *   1. Si la factura del acuerdo ya no tiene saldo en Softec → CUMPLIDO.
 *   2. Si los recibos (RC) del cliente entre la fecha del acuerdo y
 *      fecha_prometida + GRACIA suman >= monto_prometido → CUMPLIDO.
 *   3. Si ya pasó fecha_prometida + GRACIA días sin pago → INCUMPLIDO.
 *   4. Dentro del período de gracia → sigue PENDIENTE (se reevalúa mañana).
 *
 * Idempotente: solo toca filas PENDIENTE. Diseñado para correr a diario
 * ANTES de recordatorios-promesas (así las tareas solo se crean para
 * acuerdos que siguen realmente pendientes).
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { toYmd, addDiasYmd } from '@/lib/utils/fechas';

const DIAS_GRACIA = 3;

interface AcuerdoPendiente {
  id: number;
  codigo_cliente: string;
  ij_inum: number;
  monto_prometido: number;
  fecha_prometida: string | Date;
  created_at: string | Date;
}

export interface StatsVerificacionAcuerdos {
  evaluados: number;
  cumplidos: number;
  incumplidos: number;
  en_gracia: number;
  errores: number;
}

export async function verificarAcuerdos(): Promise<StatsVerificacionAcuerdos> {
  const stats: StatsVerificacionAcuerdos = {
    evaluados: 0,
    cumplidos: 0,
    incumplidos: 0,
    en_gracia: 0,
    errores: 0,
  };

  const softecOk = await testSoftecConnection();
  if (!softecOk) {
    console.warn('[verificar-acuerdos] Softec no disponible — se pospone la verificación');
    return stats;
  }

  const acuerdos = await cobranzasQuery<AcuerdoPendiente>(
    `SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida, created_at
     FROM cobranza_acuerdos
     WHERE estado = 'PENDIENTE' AND fecha_prometida <= CURDATE()`
  );

  stats.evaluados = acuerdos.length;
  if (acuerdos.length === 0) return stats;

  const hoy = toYmd(new Date());

  for (const acuerdo of acuerdos) {
    try {
      const codigo = String(acuerdo.codigo_cliente).trim();
      const fechaPrometida = toYmd(acuerdo.fecha_prometida);
      const fechaAcuerdo = toYmd(acuerdo.created_at);
      const finGracia = addDiasYmd(fechaPrometida, DIAS_GRACIA);
      const montoPrometido = Number(acuerdo.monto_prometido) || 0;

      // 1. ¿La factura del acuerdo ya quedó saldada?
      let cumplido = false;
      let fechaPago: string | null = null;
      let montoPagado: number | null = null;

      if (acuerdo.ij_inum > 0) {
        const factura = await softecQuery<{ saldo: number }>(
          `SELECT (IJ_TOT - IJ_TOTAPPL) AS saldo FROM v_cobr_ijnl
           WHERE IJ_INUM = ? AND IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T' LIMIT 1`,
          [acuerdo.ij_inum]
        );
        if (factura.length > 0 && Number(factura[0].saldo) <= 0) {
          cumplido = true;
        }
      }

      // 2. ¿Los recibos del cliente en la ventana cubren lo prometido?
      if (!cumplido && montoPrometido > 0) {
        const recibos = await softecQuery<{ total: number; ultima_fecha: string | Date }>(
          `SELECT SUM(IJ_TOT) AS total, MAX(IJ_DATE) AS ultima_fecha
           FROM v_cobr_ijnl_pay
           WHERE IJ_SINORIN = 'RC'
             AND TRIM(IJ_CCODE) = ?
             AND IJ_DATE BETWEEN ? AND ?`,
          [codigo, fechaAcuerdo, finGracia]
        );
        const totalPagado = Number(recibos[0]?.total) || 0;
        // Tolerancia de RD$1 por redondeos
        if (totalPagado >= montoPrometido - 1) {
          cumplido = true;
          fechaPago = recibos[0]?.ultima_fecha ? toYmd(recibos[0].ultima_fecha) : null;
          montoPagado = totalPagado;
        }
      }

      if (cumplido) {
        await cobranzasExecute(
          `UPDATE cobranza_acuerdos
           SET estado = 'CUMPLIDO', fecha_pago_real = ?, monto_pagado_real = ?
           WHERE id = ? AND estado = 'PENDIENTE'`,
          [fechaPago, montoPagado, acuerdo.id]
        );
        stats.cumplidos++;

        // Cerrar la tarea de seguimiento asociada si sigue abierta
        await cobranzasExecute(
          `UPDATE cobranza_tareas
           SET estado = 'HECHA', completada_at = NOW(), completada_por = 'sistema-acuerdos',
               notas_completado = 'Acuerdo cumplido: pago verificado en Softec'
           WHERE origen = 'ACUERDO_PAGO' AND origen_ref = ? AND estado IN ('PENDIENTE','EN_PROGRESO')`,
          [`acuerdo:${acuerdo.id}`]
        ).catch(() => {});
        continue;
      }

      // 3. ¿Venció el período de gracia sin pago?
      if (hoy > finGracia) {
        await cobranzasExecute(
          `UPDATE cobranza_acuerdos
           SET estado = 'INCUMPLIDO'
           WHERE id = ? AND estado = 'PENDIENTE'`,
          [acuerdo.id]
        );
        stats.incumplidos++;
        continue;
      }

      stats.en_gracia++;
    } catch (err) {
      stats.errores++;
      console.error(`[verificar-acuerdos] Error en acuerdo ${acuerdo.id}:`, err);
    }
  }

  if (stats.cumplidos > 0 || stats.incumplidos > 0) {
    await logAccion(null, 'ACUERDOS_VERIFICADOS', 'sistema', 'batch', {
      evaluados: stats.evaluados,
      cumplidos: stats.cumplidos,
      incumplidos: stats.incumplidos,
      en_gracia: stats.en_gracia,
      errores: stats.errores,
    }).catch(() => {});
  }

  console.log(
    `[verificar-acuerdos] ${stats.evaluados} evaluados — ${stats.cumplidos} cumplidos, ${stats.incumplidos} incumplidos, ${stats.en_gracia} en gracia`
  );

  return stats;
}
