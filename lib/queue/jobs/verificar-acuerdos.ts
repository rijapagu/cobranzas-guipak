/**
 * Verificación de acuerdos de pago — resuelve PENDIENTE → CUMPLIDO/INCUMPLIDO.
 * Multi-tenant desde Fase 3 Etapa 4: corre por cada empresa activa con ERP
 * disponible, usando su adaptador (Softec en vivo o snapshot CSV).
 *
 * Reglas (por acuerdo PENDIENTE con fecha_prometida <= hoy):
 *   1. Si la factura del acuerdo ya no tiene saldo en el ERP → CUMPLIDO.
 *   2. Si los recibos (RC) del cliente entre la fecha del acuerdo y
 *      fecha_prometida + GRACIA suman >= monto_prometido → CUMPLIDO.
 *      (En modo CSV no hay recibos: aplica solo la regla 1 — el saldo del
 *      último snapshot importado.)
 *   3. Si ya pasó fecha_prometida + GRACIA días sin pago → INCUMPLIDO.
 *   4. Dentro del período de gracia → sigue PENDIENTE (se reevalúa mañana).
 *
 * Idempotente: solo toca filas PENDIENTE. Diseñado para correr a diario
 * ANTES de recordatorios-promesas (así las tareas solo se crean para
 * acuerdos que siguen realmente pendientes).
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { adaptadorParaEmpresa } from '@/lib/erp';
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
  empresas: number;
  evaluados: number;
  cumplidos: number;
  incumplidos: number;
  en_gracia: number;
  errores: number;
}

export async function verificarAcuerdos(): Promise<StatsVerificacionAcuerdos> {
  const total: StatsVerificacionAcuerdos = {
    empresas: 0,
    evaluados: 0,
    cumplidos: 0,
    incumplidos: 0,
    en_gracia: 0,
    errores: 0,
  };

  const empresas = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM empresas WHERE activa = 1 ORDER BY id'
  );

  for (const { id: empresaId } of empresas) {
    try {
      const stats = await verificarAcuerdosEmpresa(empresaId);
      if (stats === null) continue;
      total.empresas++;
      total.evaluados += stats.evaluados;
      total.cumplidos += stats.cumplidos;
      total.incumplidos += stats.incumplidos;
      total.en_gracia += stats.en_gracia;
      total.errores += stats.errores;
    } catch (err) {
      console.error(`[verificar-acuerdos] Error en empresa ${empresaId}:`, err);
    }
  }

  console.log(
    `[verificar-acuerdos] ${total.empresas} empresas | ${total.evaluados} evaluados — ${total.cumplidos} cumplidos, ${total.incumplidos} incumplidos, ${total.en_gracia} en gracia`
  );

  return total;
}

async function verificarAcuerdosEmpresa(
  empresaId: number
): Promise<Omit<StatsVerificacionAcuerdos, 'empresas'> | null> {
  const stats = { evaluados: 0, cumplidos: 0, incumplidos: 0, en_gracia: 0, errores: 0 };

  const acuerdos = await cobranzasQuery<AcuerdoPendiente>(
    `SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida, created_at
     FROM cobranza_acuerdos
     WHERE empresa_id = ? AND estado = 'PENDIENTE' AND fecha_prometida <= CURDATE()`,
    [empresaId]
  );

  stats.evaluados = acuerdos.length;
  if (acuerdos.length === 0) return stats;

  const adapter = await adaptadorParaEmpresa(empresaId);
  if (!(await adapter.disponible())) {
    console.warn(`[verificar-acuerdos] Empresa ${empresaId}: ERP no disponible — se pospone`);
    return null;
  }

  const hoy = toYmd(new Date());

  for (const acuerdo of acuerdos) {
    try {
      const codigo = String(acuerdo.codigo_cliente).trim();
      const fechaPrometida = toYmd(acuerdo.fecha_prometida);
      const fechaAcuerdo = toYmd(acuerdo.created_at);
      const finGracia = addDiasYmd(fechaPrometida, DIAS_GRACIA);
      const montoPrometido = Number(acuerdo.monto_prometido) || 0;

      // 1. ¿La factura del acuerdo ya quedó saldada en el ERP?
      let cumplido = false;
      let fechaPago: string | null = null;
      let montoPagado: number | null = null;

      if (acuerdo.ij_inum > 0) {
        const saldo = await adapter.saldoFactura(acuerdo.ij_inum);
        if (saldo !== null && saldo <= 0) {
          cumplido = true;
        }
      }

      // 2. ¿Los recibos del cliente en la ventana cubren lo prometido?
      // (recibosEnRango devuelve [] en orígenes sin historial de pagos.)
      if (!cumplido && montoPrometido > 0) {
        const recibos = (await adapter.recibosEnRango(fechaAcuerdo, finGracia))
          .filter((r) => r.codigoCliente === codigo);
        const totalPagado = recibos.reduce((s, r) => s + r.monto, 0);
        // Tolerancia de RD$1 por redondeos
        if (totalPagado >= montoPrometido - 1) {
          cumplido = true;
          const ultima = recibos.reduce<string | null>(
            (max, r) => (max === null || r.fecha > max ? r.fecha : max),
            null
          );
          fechaPago = ultima;
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
               notas_completado = 'Acuerdo cumplido: pago verificado en el ERP'
           WHERE empresa_id = ? AND origen = 'ACUERDO_PAGO' AND origen_ref = ? AND estado IN ('PENDIENTE','EN_PROGRESO')`,
          [empresaId, `acuerdo:${acuerdo.id}`]
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
      console.error(`[verificar-acuerdos] Empresa ${empresaId}, error en acuerdo ${acuerdo.id}:`, err);
    }
  }

  if (stats.cumplidos > 0 || stats.incumplidos > 0) {
    await logAccion(null, 'ACUERDOS_VERIFICADOS', 'sistema', 'batch', {
      evaluados: stats.evaluados,
      cumplidos: stats.cumplidos,
      incumplidos: stats.incumplidos,
      en_gracia: stats.en_gracia,
      errores: stats.errores,
    }, undefined, empresaId).catch(() => {});
  }

  console.log(
    `[verificar-acuerdos] Empresa ${empresaId}: ${stats.evaluados} evaluados — ${stats.cumplidos} cumplidos, ${stats.incumplidos} incumplidos, ${stats.en_gracia} en gracia`
  );

  return stats;
}
