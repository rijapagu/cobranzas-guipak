/**
 * Capa conversacional del Supervisor Cobros (deepseek-r1:14b local vía gateway).
 *
 * A diferencia de los despertadores (proactivos, 1 cliente), aquí Ricardo le
 * PREGUNTA al Supervisor temas estratégicos ("¿cómo está la cartera?", "¿qué hago
 * con cliente X?"). Para que las respuestas no sean genéricas, inyectamos contexto
 * en vivo desde `cobranza_cliente_inteligencia` (el mismo scoring que usan los
 * despertadores) + las últimas alertas del Supervisor.
 *
 * deepseek-r1 NO es un modelo de tool-calling fiable, por eso NO le damos
 * herramientas: le damos un snapshot de datos y razona sobre él. Si la pregunta
 * menciona un cliente que no está en el snapshot, hacemos un best-effort LIKE.
 *
 * Regla de oro intacta: el Supervisor solo RECOMIENDA. No ejecuta nada ni manda
 * nada al cliente.
 *
 * Env:
 *   SUPERVISOR_CHAT_TOP_N   default 8.  Cuántos deudores top inyectar como contexto.
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import { generarSupervisorLocal } from '@/lib/supervisor/local-llm';

interface CarteraRow {
  nombre_cliente: string;
  saldo_neto: number;
  risk_level: string;
  risk_score: number;
  dias_mora_promedio: number;
  tasa_cumplimiento_promesas: number;
  tendencia: string;
}

interface AggRow {
  clientes: number;
  saldo_total: number;
  en_rojo: number;
}

interface AlertaRow {
  tipo: string;
  nombre_cliente: string;
  risk_level: string;
  reco: string | null;
  created_at: Date | string;
}

export interface SupervisorChatResult {
  text: string;
  model: string;
  latencyMs: number;
}

export const SUPERVISOR_CHAT_SYSTEM = `Eres el SUPERVISOR DE COBROS de Guipak (suministros, Rep. Dominicana), conversando por Telegram DIRECTO con el CEO (Ricardo). Eres su analista de cobranza de confianza: agudo, directo, estratégico. Tu trabajo es analizar y recomendar; NO ejecutas acciones ni mandas nada al cliente — eso lo decide el CEO y lo opera el equipo.

Te paso un SNAPSHOT de datos reales de la cartera (deudores top, agregados y alertas recientes) seguido de la PREGUNTA del CEO. Responde apoyándote SOLO en esos datos y en tu criterio. NO inventes cifras que no estén en el snapshot (en particular, NO inventes margen ni ventas anuales: la "importancia" de un cliente se mide por exposición = saldo neto). Si la pregunta es sobre un cliente que no aparece en el snapshot, dilo claro y responde con lo general que puedas.

Estilo: español dominicano profesional, conciso para Telegram (no más de ~180 palabras salvo que pidan detalle). Puedes usar viñetas cortas si ayudan a la claridad, pero nada de relleno ni disclaimers. Cuando recomiendes algo, sé concreto y con plazo. Si te piden una decisión que toca al cliente (plan de pagos, escalar legal), razónala (monto vs costo vs valor de la relación) pero recuérdale que la decisión y la firma son suyas.`;

function fmtDOP(n: number): string {
  return `RD$${Math.round(n).toLocaleString('es-DO')}`;
}

// Palabras comunes que NO sirven para buscar un cliente por nombre.
const STOPWORDS = new Set([
  'como', 'esta', 'estan', 'cliente', 'clientes', 'cartera', 'cobros', 'cobranza',
  'hago', 'hacer', 'debo', 'puedo', 'sobre', 'para', 'pero', 'todo', 'todos',
  'cuanto', 'cuánto', 'cuando', 'cuándo', 'donde', 'dónde', 'porque', 'porqué',
  'tiene', 'tienen', 'hace', 'dias', 'días', 'mora', 'saldo', 'deuda', 'deben',
  'pago', 'pagos', 'plan', 'cual', 'cuál', 'cuales', 'quien', 'resumen', 'dame',
  'dime', 'analiza', 'analisis', 'análisis', 'estado', 'riesgo', 'esto', 'eso',
]);

/** Best-effort: busca clientes cuyo nombre coincida con palabras de la pregunta. */
async function buscarClientesMencionados(pregunta: string): Promise<CarteraRow[]> {
  const palabras = (
    pregunta
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .match(/[a-z0-9]{4,}/g) || []
  ).filter((w) => !STOPWORDS.has(w));

  const candidatas = [...new Set(palabras)].slice(0, 5);
  if (candidatas.length === 0) return [];

  const likeClauses = candidatas.map(() => 'nombre_cliente LIKE ?').join(' OR ');
  const params = candidatas.map((w) => `%${w}%`);
  return cobranzasQuery<CarteraRow>(
    `SELECT nombre_cliente, saldo_neto, risk_level, risk_score, dias_mora_promedio,
            tasa_cumplimiento_promesas, tendencia
     FROM cobranza_cliente_inteligencia
     WHERE (${likeClauses}) AND saldo_neto > 0
     ORDER BY saldo_neto DESC
     LIMIT 5`,
    params
  );
}

function lineaCliente(c: CarteraRow): string {
  return (
    `- ${c.nombre_cliente.trim()}: ${fmtDOP(Number(c.saldo_neto))} neto, ` +
    `${c.risk_level} (score ${Math.round(Number(c.risk_score))}), ` +
    `mora ${Math.round(Number(c.dias_mora_promedio))}d, ` +
    `cumplimiento ${Math.round(Number(c.tasa_cumplimiento_promesas))}%, ` +
    `tendencia ${String(c.tendencia).toLowerCase()}`
  );
}

/** Arma el bloque de contexto en texto plano que precede a la pregunta. */
async function construirContexto(pregunta: string): Promise<string> {
  const topN = Math.max(1, Math.min(25, Number(process.env.SUPERVISOR_CHAT_TOP_N) || 8));

  const [agg] = await cobranzasQuery<AggRow>(
    `SELECT COUNT(*) AS clientes,
            COALESCE(SUM(saldo_neto), 0) AS saldo_total,
            COALESCE(SUM(risk_level IN ('ROJO','CRITICO')), 0) AS en_rojo
     FROM cobranza_cliente_inteligencia
     WHERE saldo_neto > 0`
  );

  const top = await cobranzasQuery<CarteraRow>(
    `SELECT nombre_cliente, saldo_neto, risk_level, risk_score, dias_mora_promedio,
            tasa_cumplimiento_promesas, tendencia
     FROM cobranza_cliente_inteligencia
     WHERE saldo_neto > 0
     ORDER BY saldo_neto DESC
     LIMIT ${topN}`
  );

  const alertas = await cobranzasQuery<AlertaRow>(
    `SELECT tipo, nombre_cliente, risk_level, LEFT(recomendacion, 220) AS reco, created_at
     FROM cobranza_supervisor_alertas
     ORDER BY created_at DESC
     LIMIT 5`
  );

  const mencionados = await buscarClientesMencionados(pregunta);

  const partes: string[] = ['=== SNAPSHOT DE CARTERA (datos reales) ==='];

  if (agg) {
    partes.push(
      `Agregado: ${Number(agg.clientes)} clientes con saldo, ${fmtDOP(Number(agg.saldo_total))} en total, ${Number(agg.en_rojo)} en ROJO/CRÍTICO.`
    );
  }

  if (top.length > 0) {
    partes.push(`\nTop ${top.length} deudores por exposición (saldo neto):`);
    partes.push(...top.map(lineaCliente));
  } else {
    partes.push('\nNo hay clientes con saldo en el scoring (¿corrió el job de inteligencia?).');
  }

  if (mencionados.length > 0) {
    partes.push(`\nCliente(s) que parece(s) mencionar la pregunta:`);
    partes.push(...mencionados.map(lineaCliente));
  }

  if (alertas.length > 0) {
    partes.push(`\nÚltimas alertas que disparó el Supervisor:`);
    partes.push(
      ...alertas.map((a) => {
        const fecha =
          a.created_at instanceof Date
            ? a.created_at.toISOString().slice(0, 10)
            : String(a.created_at).slice(0, 10);
        const reco = a.reco ? ` — ${a.reco.trim()}` : '';
        return `- [${fecha}] ${a.tipo} · ${a.nombre_cliente.trim()} (${a.risk_level})${reco}`;
      })
    );
  }

  return partes.join('\n');
}

/**
 * Responde una pregunta estratégica del CEO con deepseek + contexto en vivo.
 * Lanza si el gateway falla (el caller decide el mensaje de error).
 */
export async function conversarSupervisor(pregunta: string): Promise<SupervisorChatResult> {
  const contexto = await construirContexto(pregunta);
  const user = `${contexto}\n\n=== PREGUNTA DEL CEO ===\n${pregunta.trim()}`;

  const llm = await generarSupervisorLocal({
    system: SUPERVISOR_CHAT_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 1600,
  });

  return { text: llm.text, model: llm.model, latencyMs: llm.latencyMs };
}
