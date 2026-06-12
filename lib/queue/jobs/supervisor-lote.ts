/**
 * Delegación Supervisor→Asistente #1: "lote de cobranza dirigida".
 *
 * El Supervisor selecciona una cohorte ESTRATÉGICA (clientes top por exposición,
 * riesgo ROJO/CRÍTICO y EMPEORANDO) y le pide al Asistente que redacte los
 * borradores de correo (proponerCorreoCliente). Los borradores caen en la Cola
 * de Aprobación marcados `creado_por='supervisor-lote'`. El Supervisor NOTIFICA
 * al CEO lo que encoló (transparencia, NO compuerta). El equipo de cobros aprueba
 * cada envío en la mañana = compuerta única humana.
 *
 * Reglas de oro intactas:
 *  - Asistente: nada sale al cliente sin aprobación humana (quedan PENDIENTE).
 *  - Supervisor: no ejecuta ni envía; encola trabajo propuesto + reporta.
 *
 * Anti-solapamiento: proponerCorreoCliente salta clientes que YA tienen gestión
 * pendiente (motivo YA_HAY_GESTION_PENDIENTE), así el lote del Supervisor no
 * duplica el trabajo rutinario del Asistente.
 *
 * Sugerido: semanal, lunes 6:00 AM AST (10:00 UTC), antes del empuje matutino.
 *
 * Env vars:
 *   SUPERVISOR_LOTE_TOP_N        default 10.    Tamaño máximo de la cohorte.
 *   SUPERVISOR_LOTE_SALDO_MIN    default 50000. Exposición mínima para entrar.
 *   SUPERVISOR_LOTE_PLANTILLA_ID opcional.      Plantilla específica del lote.
 *   TELEGRAM_USER_RICARDO        default '7281538057'.
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { proponerCorreoCliente } from '@/lib/telegram/draft-correo';
import { enviarAlertaSupervisor } from '@/lib/supervisor/telegram';
import { generarSupervisorLocal } from '@/lib/supervisor/local-llm';
import {
  SUPERVISOR_LOTE_SYSTEM,
  buildLoteUserInput,
  type LoteClienteEncolado,
} from '@/lib/supervisor/prompts';

interface CohorteRow {
  codigo_cliente: string;
  nombre_cliente: string;
  risk_level: string;
  saldo_neto: number;
  dias_mora_promedio: number;
}

export interface SupervisorLoteStats {
  cohorte: number;
  encolados: number;
  omitidos: number;
  errores: number;
  motivos: Record<string, number>;
}

// Mapea los códigos de "motivo" de proponerCorreoCliente a frases legibles.
const MOTIVO_LABEL: Record<string, string> = {
  YA_HAY_GESTION_PENDIENTE: 'ya tenían gestión pendiente',
  CLIENTE_PAUSADO: 'pausados / no contactar',
  SIN_EMAIL_REGISTRADO: 'sin email registrado',
  CLIENTE_CUBIERTO_POR_ANTICIPO: 'cubiertos por anticipo',
  SIN_FACTURAS_VENCIDAS: 'sin facturas vencidas',
  SIN_PLANTILLA: 'sin plantilla aplicable',
  CLIENTE_NO_ENCONTRADO: 'no encontrados en Softec',
  ERROR_GENERAR: 'con error al generar',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

function fmtDOP(n: number): string {
  return `RD$${Math.round(n).toLocaleString('es-DO')}`;
}

export async function ejecutarSupervisorLote(): Promise<SupervisorLoteStats> {
  const stats: SupervisorLoteStats = {
    cohorte: 0,
    encolados: 0,
    omitidos: 0,
    errores: 0,
    motivos: {},
  };

  const topN = Math.max(1, Math.min(50, Number(process.env.SUPERVISOR_LOTE_TOP_N) || 10));
  const saldoMin = Number(process.env.SUPERVISOR_LOTE_SALDO_MIN) || 50000;
  const plantillaId = process.env.SUPERVISOR_LOTE_PLANTILLA_ID
    ? Number(process.env.SUPERVISOR_LOTE_PLANTILLA_ID)
    : undefined;
  const chatId = process.env.TELEGRAM_USER_RICARDO || '7281538057';

  // 1. Cohorte estratégica: top por exposición, ROJO/CRÍTICO y empeorando.
  const cohorte = await cobranzasQuery<CohorteRow>(
    `SELECT codigo_cliente, nombre_cliente, risk_level, saldo_neto, dias_mora_promedio
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND risk_level IN ('ROJO','CRITICO')
       AND tendencia = 'EMPEORANDO'
       AND saldo_neto >= ?
     ORDER BY saldo_neto DESC
     LIMIT ${topN}`,
    [saldoMin]
  );
  stats.cohorte = cohorte.length;

  if (cohorte.length === 0) {
    console.log('[supervisor-lote] Cohorte vacía (ningún top empeorando). Nada que encolar.');
    return stats;
  }

  // 2. Pedir al Asistente que redacte un borrador por cliente (con todos sus guardas).
  const encolados: Array<LoteClienteEncolado & { gestionId: number; codigo: string }> = [];
  for (const c of cohorte) {
    const codigo = c.codigo_cliente.trim();
    try {
      const r = await proponerCorreoCliente(codigo, undefined, plantillaId, 'supervisor-lote');
      if (r.ok && r.gestion_id) {
        encolados.push({
          codigo,
          gestionId: r.gestion_id,
          nombre: (r.cliente || c.nombre_cliente).trim(),
          saldoNeto: Number(r.saldo ?? c.saldo_neto),
          riskLevel: c.risk_level,
          diasMora: Number(c.dias_mora_promedio),
        });
      } else {
        stats.omitidos++;
        const motivo = r.motivo || 'ERROR_GENERAR';
        stats.motivos[motivo] = (stats.motivos[motivo] || 0) + 1;
      }
    } catch (err) {
      stats.errores++;
      stats.motivos.ERROR_GENERAR = (stats.motivos.ERROR_GENERAR || 0) + 1;
      console.error(`[supervisor-lote] Error con ${codigo}:`, err);
    }
  }
  stats.encolados = encolados.length;

  if (encolados.length === 0) {
    console.log('[supervisor-lote] No se encoló ningún borrador (todos omitidos/dedup).');
    await logAccion(null, 'SUPERVISOR_LOTE_RUN', 'sistema', 'batch', { ...stats });
    return stats;
  }

  // 3. Nota al CEO. La voz del Supervisor (deepseek), con FALLBACK determinista:
  //    los borradores YA están encolados, la notificación NO debe fallar si el
  //    modelo está contendido.
  const omitidosResumen = Object.entries(stats.motivos).map(
    ([m, n]) => `${n} ${MOTIVO_LABEL[m] || m.toLowerCase()}`
  );
  let nota: string;
  let modelUsed = 'fallback-deterministico';
  let latency = 0;
  try {
    const llm = await generarSupervisorLocal({
      system: SUPERVISOR_LOTE_SYSTEM,
      user: buildLoteUserInput({
        encolados: encolados.map((e) => ({
          nombre: e.nombre,
          saldoNeto: e.saldoNeto,
          riskLevel: e.riskLevel,
          diasMora: e.diasMora,
        })),
        omitidosResumen,
      }),
      maxTokens: 700,
    });
    nota = llm.text;
    modelUsed = llm.model;
    latency = llm.latencyMs;
  } catch (err) {
    console.error('[supervisor-lote] LLM falló, usando nota determinista:', err);
    nota =
      `Encolé ${encolados.length} borrador(es) de cobranza dirigida para clientes top que vienen empeorando. ` +
      `Quedan en la Cola de Aprobación para que el equipo los revise y apruebe hoy.`;
  }

  // Lista compacta determinista (siempre presente, aunque la nota venga del LLM).
  const lista = encolados
    .map((e) => `• ${escapeHtml(e.nombre)} — ${fmtDOP(e.saldoNeto)} (${e.riskLevel})`)
    .join('\n');
  const omitTxt = omitidosResumen.length > 0 ? `\n\n<i>Omitidos: ${escapeHtml(omitidosResumen.join('; '))}.</i>` : '';
  const mensaje =
    `📋 <b>Supervisor Cobros · Lote de cobranza dirigida</b>\n\n` +
    `${escapeHtml(nota)}\n\n${lista}${omitTxt}`;

  let messageId = 0;
  try {
    messageId = await enviarAlertaSupervisor(chatId, mensaje);
  } catch (err) {
    console.error('[supervisor-lote] No se pudo enviar la notificación a Telegram:', err);
  }

  // 4. Auditoría: una fila por borrador encolado (idempotencia/traza por gestión).
  for (const e of encolados) {
    try {
      await cobranzasExecute(
        `INSERT INTO cobranza_supervisor_alertas (
           tipo, origen_ref, codigo_cliente, nombre_cliente,
           risk_level, score_anterior, score_nuevo, saldo_neto,
           descripcion, recomendacion, modelo_response,
           model_used, latency_ms, cost_usd,
           telegram_message_id, notified_at
         ) VALUES (
           'LOTE_COBRANZA_DIRIGIDO', ?, ?, ?,
           ?, NULL, 0, ?,
           ?, ?, NULL,
           ?, ?, 0,
           ?, NOW()
         )`,
        [
          `gestion:${e.gestionId}`,
          e.codigo,
          e.nombre,
          e.riskLevel,
          e.saldoNeto,
          `Borrador de cobranza dirigida encolado (gestión ${e.gestionId}).`,
          nota,
          modelUsed,
          latency,
          messageId || null,
        ]
      );
    } catch (err) {
      console.error(`[supervisor-lote] Error auditando gestión ${e.gestionId}:`, err);
    }
  }

  await logAccion(null, 'SUPERVISOR_LOTE_RUN', 'sistema', 'batch', { ...stats });
  console.log(`[supervisor-lote] Encolados ${encolados.length} borradores, notificado al CEO.`);

  return stats;
}
