/**
 * Despertador del Supervisor Cobros #3: "promesa grande incumplida".
 *
 * Detecta promesas de pago GRANDES (monto >= umbral) que vencieron y siguen sin
 * pagar, y por cada una pide al modelo local (capa Supervisor, deepseek vía
 * gateway) una lectura estratégica: ¿cobro legal o más cuerda? La alerta va al
 * Telegram privado del CEO.
 *
 * Diferencia con el Asistente: el Asistente ya creó la tarea de seguimiento
 * rutinaria (recordatorios-promesas, Tipo C) para CUALQUIER monto. El Supervisor
 * va ENCIMA, solo para las grandes, con la decisión legal-vs-renegociar. Solo
 * RECOMIENDA; el CEO decide.
 *
 * Idempotencia por-acuerdo vía cobranza_supervisor_alertas.origen_ref =
 * 'acuerdo:{id}' (cooldown configurable). No re-alerta la misma promesa; sí
 * alerta promesas distintas del mismo cliente.
 *
 * Sugerido: 1:35 AM AST (5:35 UTC), tras el scoring y el despertador top-10.
 *
 * Env vars:
 *   SUPERVISOR_PROMESA_MIN     default 200000. Umbral de "promesa grande" (DOP).
 *   SUPERVISOR_PROMESA_DIAS    default 2.      Días de gracia tras vencer.
 *   SUPERVISOR_PROMESA_MAX     default 15.     Tope de alertas por corrida.
 *   SUPERVISOR_COOLDOWN_DAYS   default 7.      No re-alertar mismo acuerdo en N días.
 *   TELEGRAM_USER_RICARDO      default '7281538057'.
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { enviarAlertaSupervisor } from '@/lib/supervisor/telegram';
import { generarSupervisorLocal } from '@/lib/supervisor/local-llm';
import {
  SUPERVISOR_PROMESA_SYSTEM,
  buildPromesaUserInput,
  type SupervisorPromesaInput,
} from '@/lib/supervisor/prompts';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface PromesaRow {
  id: number;
  codigo_cliente: string;
  ij_inum: number | null;
  monto_prometido: number;
  moneda: string;
  fecha_prometida: string;
  dias_atraso: number;
  descripcion: string | null;
  estado: string;
  nombre_cliente: string | null;
  risk_level: string | null;
  risk_score: number | null;
  saldo_neto: number | null;
  dias_mora_promedio: number | null;
  tasa_cumplimiento_promesas: number | null;
  promesas_total: number | null;
  promesas_cumplidas: number | null;
}

export interface SupervisorPromesasStats {
  evaluadas: number;        // promesas grandes vencidas encontradas
  alertas_enviadas: number;
  omitidas_cooldown: number;
  errores: number;
  costo_usd_total: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

function fmtMoneda(n: number, moneda: string): string {
  const pref = moneda === 'DOP' || !moneda ? 'RD$' : `${moneda} `;
  return `${pref}${Math.round(n).toLocaleString('es-DO')}`;
}

// ── Job principal ──────────────────────────────────────────────────────────────

export async function ejecutarSupervisorPromesas(): Promise<SupervisorPromesasStats> {
  const stats: SupervisorPromesasStats = {
    evaluadas: 0,
    alertas_enviadas: 0,
    omitidas_cooldown: 0,
    errores: 0,
    costo_usd_total: 0,
  };

  const montoMin = Number(process.env.SUPERVISOR_PROMESA_MIN) || 200_000;
  const diasGracia = Math.max(0, Number(process.env.SUPERVISOR_PROMESA_DIAS) || 2);
  const maxAlertas = Math.max(1, Math.min(50, Number(process.env.SUPERVISOR_PROMESA_MAX) || 15));
  const cooldownDays = Number(process.env.SUPERVISOR_COOLDOWN_DAYS) || 7;
  const chatId = process.env.TELEGRAM_USER_RICARDO || '7281538057';

  // 1. Promesas grandes vencidas y sin pagar, enriquecidas con riesgo del cliente.
  //    diasGracia se inyecta saneado a entero (no es input de usuario externo).
  const promesas = await cobranzasQuery<PromesaRow>(
    `SELECT
       a.id,
       TRIM(a.codigo_cliente) AS codigo_cliente,
       a.ij_inum,
       a.monto_prometido,
       a.moneda,
       DATE_FORMAT(a.fecha_prometida, '%Y-%m-%d') AS fecha_prometida,
       DATEDIFF(CURDATE(), a.fecha_prometida) AS dias_atraso,
       a.descripcion,
       a.estado,
       i.nombre_cliente,
       i.risk_level,
       i.risk_score,
       i.saldo_neto,
       i.dias_mora_promedio,
       i.tasa_cumplimiento_promesas,
       i.promesas_total,
       i.promesas_cumplidas
     FROM cobranza_acuerdos a
     LEFT JOIN cobranza_cliente_inteligencia i
       ON i.codigo_cliente = TRIM(a.codigo_cliente)
     WHERE a.monto_prometido >= ?
       AND (
         (a.estado = 'PENDIENTE' AND a.fecha_prometida < DATE_SUB(CURDATE(), INTERVAL ${diasGracia} DAY))
         OR a.estado = 'INCUMPLIDO'
       )
     ORDER BY a.monto_prometido DESC
     LIMIT ${maxAlertas}`,
    [montoMin]
  );
  stats.evaluadas = promesas.length;

  if (promesas.length === 0) {
    console.log('[supervisor-promesas] Sin promesas grandes incumplidas. Nada que alertar.');
    return stats;
  }

  // 2. Idempotencia por-acuerdo: alertas recientes (cooldown) para estos acuerdos.
  const refs = promesas.map((p) => `acuerdo:${p.id}`);
  const placeholders = refs.map(() => '?').join(',');
  const yaAlertadas = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_supervisor_alertas
     WHERE tipo = 'PROMESA_GRANDE_INCUMPLIDA'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND origen_ref IN (${placeholders})`,
    [cooldownDays, ...refs]
  );
  const refsAlertados = new Set(yaAlertadas.map((r) => r.origen_ref));

  // 3. Por cada promesa nueva: pedir alerta al modelo + enviar + auditar.
  for (const p of promesas) {
    const ref = `acuerdo:${p.id}`;
    if (refsAlertados.has(ref)) {
      stats.omitidas_cooldown++;
      continue;
    }

    const nombre = (p.nombre_cliente || p.codigo_cliente).trim();

    try {
      const input: SupervisorPromesaInput = {
        nombre,
        montoPrometido: Number(p.monto_prometido),
        moneda: p.moneda || 'DOP',
        fechaPrometida: p.fecha_prometida,
        diasAtraso: Number(p.dias_atraso),
        facturaInum: p.ij_inum == null ? null : Number(p.ij_inum),
        descripcionAcuerdo: p.descripcion,
        riskLevel: p.risk_level,
        riskScore: p.risk_score == null ? null : Number(p.risk_score),
        saldoNeto: p.saldo_neto == null ? null : Number(p.saldo_neto),
        diasMoraPromedio: p.dias_mora_promedio == null ? null : Number(p.dias_mora_promedio),
        tasaCumplimientoPromesas:
          p.tasa_cumplimiento_promesas == null ? null : Number(p.tasa_cumplimiento_promesas),
        promesasTotal: p.promesas_total == null ? null : Number(p.promesas_total),
        promesasCumplidas: p.promesas_cumplidas == null ? null : Number(p.promesas_cumplidas),
      };

      const userInput = buildPromesaUserInput(input);
      const llm = await generarSupervisorLocal({
        system: SUPERVISOR_PROMESA_SYSTEM,
        user: userInput,
      });

      const header =
        `🟠 <b>Supervisor Cobros · Promesa grande incumplida</b>\n` +
        `<i>${escapeHtml(nombre)} — ${fmtMoneda(input.montoPrometido, input.moneda)} · ` +
        `vencida hace ${input.diasAtraso}d${input.facturaInum ? ` · fac #${input.facturaInum}` : ''}</i>`;
      const mensaje = `${header}\n\n${escapeHtml(llm.text)}`;

      const messageId = await enviarAlertaSupervisor(chatId, mensaje);

      await cobranzasExecute(
        `INSERT INTO cobranza_supervisor_alertas (
           tipo, origen_ref, codigo_cliente, nombre_cliente,
           risk_level, score_anterior, score_nuevo, saldo_neto,
           descripcion, recomendacion, modelo_response,
           model_used, latency_ms, cost_usd,
           telegram_message_id, notified_at
         ) VALUES (
           'PROMESA_GRANDE_INCUMPLIDA', ?, ?, ?,
           ?, NULL, ?, ?,
           ?, ?, ?,
           ?, ?, 0,
           ?, NOW()
         )`,
        [
          ref,
          p.codigo_cliente.trim(),
          nombre,
          p.risk_level || 'ROJO',
          input.riskScore ?? 0,
          input.saldoNeto ?? 0,
          userInput,
          llm.text,
          JSON.stringify(llm.raw),
          llm.model,
          llm.latencyMs,
          messageId,
        ]
      );

      stats.alertas_enviadas++;
      console.log(
        `[supervisor-promesas] Alerta enviada: ${nombre} (${fmtMoneda(input.montoPrometido, input.moneda)}, ${input.diasAtraso}d, ${llm.latencyMs}ms)`
      );
    } catch (err) {
      stats.errores++;
      console.error(`[supervisor-promesas] Error con acuerdo ${p.id} (${nombre}):`, err);
    }
  }

  await logAccion(null, 'SUPERVISOR_PROMESAS_RUN', 'sistema', 'batch', { ...stats });

  return stats;
}
