/**
 * Despertador del Supervisor Cobros #2: "top-10 cliente cruza umbral".
 *
 * Corre DESPUÉS del scoring nocturno (inteligencia-clientes, 1 AM AST). Detecta
 * clientes de alta exposición (top-N por saldo neto) que escalaron su riesgo a
 * ROJO/CRÍTICO en la última corrida, y por cada uno pide al modelo local (capa
 * Supervisor, deepseek-r1:14b vía gateway) una alerta ejecutiva en prosa que se
 * envía al Telegram PRIVADO del CEO.
 *
 * Diferencia con el Asistente: el Asistente ya generó tareas (correo + llamada)
 * para estos clientes. El Supervisor NO genera tareas: aporta contexto + decisión
 * estratégica al CEO. Trabajan en paralelo sin solaparse (ver frontera acordada).
 *
 * Regla de oro: el Supervisor solo RECOMIENDA. No ejecuta nada, no manda nada al
 * cliente. La alerta es para que el CEO decida.
 *
 * Sugerido: 1:30 AM AST (5:30 UTC), justo tras el scoring de la 1 AM.
 *
 * Env vars (todas opcionales, con defaults sensatos):
 *   SUPERVISOR_TOP_N         default 10.    Universo top por saldo neto a vigilar.
 *   SUPERVISOR_DELTA_SCORE   default 15.    Salto de score que cuenta como "cruce".
 *   SUPERVISOR_COOLDOWN_DAYS default 7.     No re-alertar mismo cliente/tipo en N días...
 *   SUPERVISOR_SALDO_MIN     default 50000. ...salvo que el saldo justifique igual.
 *   TELEGRAM_USER_RICARDO    default '7281538057'. Chat privado del CEO.
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { enviarAlertaSupervisor } from '@/lib/supervisor/telegram';
import { generarSupervisorLocal } from '@/lib/supervisor/local-llm';
import {
  SUPERVISOR_TOP10_SYSTEM,
  buildSupervisorUserInput,
  type SupervisorClienteInput,
} from '@/lib/supervisor/prompts';

// ── Tipos ────────────────────────────────────────────────────────────────────

interface IntelRow {
  codigo_cliente: string;
  nombre_cliente: string;
  risk_score: number;
  risk_level: 'VERDE' | 'AMARILLO' | 'ROJO' | 'CRITICO';
  score_anterior: number | null;
  saldo_neto: number;
  total_facturas: number;
  dias_mora_promedio: number;
  tasa_cumplimiento_promesas: number;
  tendencia: string;
  accion_cobranza: string;
  razones: unknown; // columna JSON: mysql2 puede devolver array o string
}

export interface SupervisorAlertasStats {
  evaluados: number;        // clientes top-N revisados
  candidatos: number;       // los que cruzaron umbral
  alertas_enviadas: number;
  alertas_fallback: number; // enviadas con texto determinista (gateway IA caído/ocupado)
  omitidos_cooldown: number;
  errores: number;
  costo_usd_total: number;  // 0 con modelo local; reservado para futura mezcla Anthropic
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NIVEL_RANK: Record<string, number> = {
  VERDE: 0,
  AMARILLO: 1,
  ROJO: 2,
  CRITICO: 3,
};

/** Replica la clasificación del scoring (inteligencia-clientes.ts). */
function nivelDesdeScore(score: number): 'VERDE' | 'AMARILLO' | 'ROJO' | 'CRITICO' {
  if (score >= 76) return 'CRITICO';
  if (score >= 46) return 'ROJO';
  if (score >= 31) return 'AMARILLO';
  return 'VERDE';
}

function parseRazones(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
}

function fmtDOP(n: number): string {
  return `RD$${Math.round(n).toLocaleString('es-DO')}`;
}

/** Texto determinista cuando el modelo no está disponible (no perder la alerta). */
function fallbackTop10(i: SupervisorClienteInput): string {
  const salto =
    i.scoreAnterior != null ? `de ${i.scoreAnterior} a ${i.scoreNuevo}` : `a ${i.scoreNuevo}`;
  return (
    `(Análisis automático no disponible — gateway IA ocupado.) ` +
    `${i.nombre} es el #${i.rankExposicion} por exposición y su riesgo subió ${salto} (${i.riskLevel}). ` +
    `Mora promedio ${Math.round(i.diasMoraPromedio)}d, cumplimiento de promesas ${Math.round(i.tasaCumplimientoPromesas)}%, ` +
    `tendencia ${i.tendencia.toLowerCase()}. Conviene revisarlo hoy y decidir si contactar, esperar o frenar nueva venta.`
  );
}

/**
 * ¿Este cliente cruzó el umbral en esta corrida?
 * Cruce = ahora está en ROJO/CRÍTICO Y o bien subió de nivel respecto al score
 * anterior, o bien pegó un salto de score >= DELTA. Sin score anterior, cualquier
 * aparición en ROJO/CRÍTICO cuenta (el cooldown evita el spam).
 */
function cruzoUmbral(row: IntelRow, deltaThreshold: number): boolean {
  const curRank = NIVEL_RANK[row.risk_level] ?? 0;
  if (curRank < NIVEL_RANK.ROJO) return false; // solo ROJO/CRÍTICO

  if (row.score_anterior == null) return true;

  const prevRank = NIVEL_RANK[nivelDesdeScore(row.score_anterior)] ?? 0;
  const subioNivel = curRank > prevRank;
  const saltoGrande = row.risk_score - row.score_anterior >= deltaThreshold;
  return subioNivel || saltoGrande;
}

// ── Job principal ──────────────────────────────────────────────────────────────

export async function ejecutarSupervisorAlertas(): Promise<SupervisorAlertasStats> {
  const stats: SupervisorAlertasStats = {
    evaluados: 0,
    candidatos: 0,
    alertas_enviadas: 0,
    alertas_fallback: 0,
    omitidos_cooldown: 0,
    errores: 0,
    costo_usd_total: 0,
  };

  // Circuit breaker: si una llamada al modelo falla (timeout por saturación del
  // gateway), las siguientes usan fallback directo en vez de esperar 240s c/u.
  let gatewayDown = false;

  const topN = Math.max(1, Math.min(100, Number(process.env.SUPERVISOR_TOP_N) || 10));
  const deltaScore = Number(process.env.SUPERVISOR_DELTA_SCORE) || 15;
  const cooldownDays = Number(process.env.SUPERVISOR_COOLDOWN_DAYS) || 7;
  const saldoMin = Number(process.env.SUPERVISOR_SALDO_MIN) || 50000;
  const chatId = process.env.TELEGRAM_USER_RICARDO || '7281538057';

  // 1. Top-N clientes por exposición (saldo neto). topN está saneado a entero.
  const top = await cobranzasQuery<IntelRow>(
    `SELECT codigo_cliente, nombre_cliente, risk_score, risk_level,
            score_anterior, saldo_neto, total_facturas, dias_mora_promedio,
            tasa_cumplimiento_promesas, tendencia, accion_cobranza, razones
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND saldo_neto > 0
     ORDER BY saldo_neto DESC
     LIMIT ${topN}`
  );
  stats.evaluados = top.length;

  if (top.length === 0) {
    console.log('[supervisor-alertas] Sin clientes con saldo. Nada que evaluar.');
    return stats;
  }

  // 2. Candidatos que cruzaron umbral (entre los top-N).
  const candidatos = top
    .map((r, idx) => ({ row: r, rank: idx + 1 }))
    .filter(({ row }) => cruzoUmbral(row, deltaScore));
  stats.candidatos = candidatos.length;

  if (candidatos.length === 0) {
    console.log('[supervisor-alertas] Ningún top-N cruzó umbral en esta corrida.');
    return stats;
  }

  // 3. Idempotencia: alertas recientes (cooldown) para estos clientes.
  const codigos = candidatos.map((c) => c.row.codigo_cliente.trim());
  const placeholders = codigos.map(() => '?').join(',');
  const recientes = await cobranzasQuery<{ codigo_cliente: string; last_score: number }>(
    `SELECT codigo_cliente, MAX(score_nuevo) AS last_score
     FROM cobranza_supervisor_alertas
     WHERE tipo = 'TOP10_CRUZA_UMBRAL'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND codigo_cliente IN (${placeholders})
     GROUP BY codigo_cliente`,
    [cooldownDays, ...codigos]
  );
  const ultimoScore = new Map<string, number>(
    recientes.map((r) => [r.codigo_cliente.trim(), Number(r.last_score)])
  );

  // 4. Por cada candidato: salvo cooldown, pedir alerta al modelo + enviar.
  for (const { row, rank } of candidatos) {
    const codigo = row.codigo_cliente.trim();
    const yaAlertado = ultimoScore.get(codigo);

    // Cooldown: si ya alertamos hace poco y el score no escaló más (>= delta por
    // encima de la última alerta), saltar. Una re-escalada fuerte sí re-alerta.
    if (yaAlertado != null && row.risk_score - yaAlertado < deltaScore) {
      stats.omitidos_cooldown++;
      continue;
    }

    try {
      const input: SupervisorClienteInput = {
        nombre: row.nombre_cliente.trim(),
        rankExposicion: rank,
        totalClientesTop: top.length,
        saldoNeto: Number(row.saldo_neto),
        totalFacturas: Number(row.total_facturas),
        diasMoraPromedio: Number(row.dias_mora_promedio),
        riskLevel: row.risk_level,
        scoreAnterior: row.score_anterior == null ? null : Number(row.score_anterior),
        scoreNuevo: Number(row.risk_score),
        tasaCumplimientoPromesas: Number(row.tasa_cumplimiento_promesas),
        tendencia: row.tendencia,
        accionCobranza: row.accion_cobranza,
        razones: parseRazones(row.razones),
      };

      const userInput = buildSupervisorUserInput(input);

      // Generar la prosa con el modelo; si falla (gateway saturado), fallback.
      let cuerpo: string;
      let modelUsed: string;
      let latency = 0;
      let rawJson: string | null = null;
      let esFallback = false;
      if (gatewayDown) {
        cuerpo = fallbackTop10(input);
        modelUsed = 'fallback';
        esFallback = true;
      } else {
        try {
          const llm = await generarSupervisorLocal({
            system: SUPERVISOR_TOP10_SYSTEM,
            user: userInput,
          });
          cuerpo = llm.text;
          modelUsed = llm.model;
          latency = llm.latencyMs;
          rawJson = JSON.stringify(llm.raw);
        } catch (e) {
          console.error('[supervisor-alertas] modelo falló, usando fallback:', e);
          gatewayDown = true; // circuit breaker para el resto del lote
          cuerpo = fallbackTop10(input);
          modelUsed = 'fallback';
          esFallback = true;
        }
      }

      // Mensaje a Telegram (HTML). Encabezado breve + prosa del Supervisor.
      const saltoStr =
        input.scoreAnterior != null
          ? `${input.scoreAnterior}→${input.scoreNuevo}`
          : `${input.scoreNuevo}`;
      const header =
        `🚨 <b>Supervisor Cobros · Alerta top-10</b>\n` +
        `<i>${escapeHtml(input.nombre)} — ${row.risk_level} · score ${saltoStr} · ` +
        `saldo neto ${fmtDOP(input.saldoNeto)}</i>`;
      const mensaje = `${header}\n\n${escapeHtml(cuerpo)}`;

      const messageId = await enviarAlertaSupervisor(chatId, mensaje);

      // Auditoría
      await cobranzasExecute(
        `INSERT INTO cobranza_supervisor_alertas (
           tipo, origen_ref, codigo_cliente, nombre_cliente,
           risk_level, score_anterior, score_nuevo, saldo_neto,
           descripcion, recomendacion, modelo_response,
           model_used, latency_ms, cost_usd,
           telegram_message_id, notified_at
         ) VALUES (
           'TOP10_CRUZA_UMBRAL', ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, 0,
           ?, NOW()
         )`,
        [
          `cliente:${codigo}`,
          codigo,
          input.nombre,
          row.risk_level,
          input.scoreAnterior,
          input.scoreNuevo,
          input.saldoNeto,
          userInput,
          cuerpo,
          rawJson,
          modelUsed,
          latency,
          messageId,
        ]
      );

      stats.alertas_enviadas++;
      if (esFallback) stats.alertas_fallback++;
      console.log(
        `[supervisor-alertas] Alerta enviada${esFallback ? ' (fallback)' : ''}: ${input.nombre} (${row.risk_level}, score ${saltoStr}, ${latency}ms)`
      );
    } catch (err) {
      stats.errores++;
      console.error(`[supervisor-alertas] Error con ${codigo}:`, err);
    }
  }

  await logAccion(null, 'SUPERVISOR_ALERTAS_RUN', 'sistema', 'batch', {
    ...stats,
  });

  return stats;
}
