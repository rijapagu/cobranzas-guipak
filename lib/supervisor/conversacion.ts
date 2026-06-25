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
import { softecQuery } from '@/lib/db/softec';
import { ajustarSaldoClientes } from '@/lib/cobranzas/saldo-favor';
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

Te paso un SNAPSHOT de datos reales de la cartera (deudores top, agregados y alertas recientes) seguido de la PREGUNTA del CEO. Responde apoyándote SOLO en esos datos y en tu criterio. NO inventes cifras que no estén en el snapshot (en particular, NO inventes margen ni ventas anuales: la "importancia" de un cliente se mide por exposición = saldo neto).

REGLAS DURAS DE EXACTITUD (un error de saldo destruye la confianza):
1. Si el snapshot trae un bloque "SALDO ACTUAL EN VIVO" para el cliente preguntado, USA ESE monto — es el de HOY. El bloque "Top deudores" es del último corrido del scoring y puede estar desactualizado; NO lo uses para el saldo puntual de un cliente.
2. NUNCA atribuyas un saldo a un cliente que el CEO no nombró. Si la pregunta (o el follow-up) NO se ata claramente a un cliente del snapshot, NO respondas sobre otro cliente del top por tu cuenta: pide el NOMBRE EXACTO (o RNC/código). Más vale pedir precisión que inventar.
3. Si el CEO te corrige una cifra ("¿no son X?"), revisa el SALDO EN VIVO del MISMO cliente del hilo; no cambies de cliente.

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

interface SaldoVivoRow {
  codigo: string;
  nombre: string;
  saldo_pendiente: number;
  saldo_a_favor: number;
  saldo_neto: number;
  total_facturas: number;
  dias_mora_promedio: number;
  cubierto_por_anticipo: boolean;
}

/**
 * Saldo EN VIVO (Softec, HOY) de los clientes que menciona la pregunta. Misma fuente y
 * fórmula que el dashboard/clientes (pendiente bruto IJ_TOT-IJ_TOTAPPL + ajuste de saldo a
 * favor), NO la tabla materializada `cobranza_cliente_inteligencia` (que la refresca un job y
 * puede estar stale). Así "¿cuánto debe X?" nunca da un saldo viejo.
 */
async function saldoEnVivoMencionados(texto: string): Promise<SaldoVivoRow[]> {
  const palabras = (
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .match(/[a-z0-9]{4,}/g) || []
  ).filter((w) => !STOPWORDS.has(w));

  const candidatas = [...new Set(palabras)].slice(0, 5);
  if (candidatas.length === 0) return [];

  const likeClauses = candidatas.map(() => 'c.IC_NAME LIKE ?').join(' OR ');
  const params = candidatas.map((w) => `%${w}%`);
  const aging = await softecQuery<{
    codigo: string;
    nombre: string;
    saldo_pendiente: number;
    total_facturas: number;
    dias_mora_promedio: number;
  }>(
    `SELECT c.IC_CODE AS codigo, c.IC_NAME AS nombre,
            SUM(f.IJ_TOT - f.IJ_TOTAPPL)                       AS saldo_pendiente,
            COUNT(f.IJ_INUM)                                    AS total_facturas,
            AVG(GREATEST(0, DATEDIFF(CURDATE(), f.IJ_DUEDATE))) AS dias_mora_promedio
     FROM v_cobr_ijnl f
     INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
     WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
       AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0 AND (${likeClauses})
     GROUP BY c.IC_CODE, c.IC_NAME
     ORDER BY saldo_pendiente DESC
     LIMIT 6`,
    params
  );
  if (aging.length === 0) return [];

  // Resta saldo a favor (anticipos) por cliente, igual que el dashboard.
  const ajustados = await ajustarSaldoClientes(
    aging.map((r) => ({ codigo_cliente: String(r.codigo).trim(), saldo_pendiente: Number(r.saldo_pendiente) }))
  );
  const byCodigo = new Map(ajustados.map((a) => [a.codigo_cliente, a]));

  return aging.map((r) => {
    const a = byCodigo.get(String(r.codigo).trim());
    return {
      codigo: String(r.codigo).trim(),
      nombre: String(r.nombre).trim(),
      saldo_pendiente: a?.saldo_pendiente ?? Number(r.saldo_pendiente),
      saldo_a_favor: a?.saldo_a_favor ?? 0,
      saldo_neto: a?.saldo_neto ?? Number(r.saldo_pendiente),
      total_facturas: Number(r.total_facturas),
      dias_mora_promedio: Number(r.dias_mora_promedio),
      cubierto_por_anticipo: a?.cubierto_por_anticipo ?? false,
    };
  });
}

function lineaSaldoVivo(c: SaldoVivoRow): string {
  const favor = c.saldo_a_favor > 0 ? `, a favor ${fmtDOP(c.saldo_a_favor)}` : '';
  const cubierto = c.cubierto_por_anticipo ? ' (cubierto por anticipo → neto 0)' : '';
  return (
    `- ${c.nombre} (${c.codigo}): ${fmtDOP(c.saldo_neto)} NETO (pendiente ${fmtDOP(c.saldo_pendiente)}${favor}), ` +
    `${c.total_facturas} factura(s), mora prom. ${Math.round(c.dias_mora_promedio)}d${cubierto}`
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

/** Arma el bloque de contexto en texto plano que precede a la pregunta.
 *  `contexto` = turnos previos del hilo (lo manda el CEO) — se usa para resolver el cliente
 *  activo en follow-ups ("¿y ese?", "no son 50mil?") sin perder el sujeto. */
async function construirContexto(pregunta: string, contexto = ''): Promise<string> {
  const topN = Math.max(1, Math.min(25, Number(process.env.SUPERVISOR_CHAT_TOP_N) || 8));

  const [agg] = await cobranzasQuery<AggRow>(
    `SELECT COUNT(*) AS clientes,
            COALESCE(SUM(saldo_neto), 0) AS saldo_total,
            COALESCE(SUM(risk_level IN ('ROJO','CRITICO')), 0) AS en_rojo
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND saldo_neto > 0`
  );

  const top = await cobranzasQuery<CarteraRow>(
    `SELECT nombre_cliente, saldo_neto, risk_level, risk_score, dias_mora_promedio,
            tasa_cumplimiento_promesas, tendencia
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND saldo_neto > 0
     ORDER BY saldo_neto DESC
     LIMIT ${topN}`
  );

  const alertas = await cobranzasQuery<AlertaRow>(
    `SELECT tipo, nombre_cliente, risk_level, LEFT(recomendacion, 220) AS reco, created_at
     FROM cobranza_supervisor_alertas
     WHERE empresa_id = 1
     ORDER BY created_at DESC
     LIMIT 5`
  );

  // Saldo EN VIVO de los clientes mencionados (en la pregunta o en el hilo previo).
  const mencionados = await saldoEnVivoMencionados(`${pregunta}\n${contexto}`);

  const partes: string[] = ['=== SNAPSHOT DE CARTERA (datos reales) ==='];

  if (agg) {
    partes.push(
      `Agregado: ${Number(agg.clientes)} clientes con saldo, ${fmtDOP(Number(agg.saldo_total))} en total, ${Number(agg.en_rojo)} en ROJO/CRÍTICO.`
    );
  }

  if (top.length > 0) {
    partes.push(
      `\nTop ${top.length} deudores por exposición (del ÚLTIMO corrido del scoring — puede no reflejar pagos de hoy; para un cliente concreto manda el SALDO EN VIVO de abajo):`
    );
    partes.push(...top.map(lineaCliente));
  } else {
    partes.push('\nNo hay clientes con saldo en el scoring (¿corrió el job de inteligencia?).');
  }

  if (mencionados.length > 0) {
    partes.push(
      `\nSALDO ACTUAL EN VIVO (Softec, HOY) del/los cliente(s) mencionado(s) — USA ESTAS CIFRAS para ese cliente, NO las del top:`
    );
    partes.push(...mencionados.map(lineaSaldoVivo));
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
export async function conversarSupervisor(
  pregunta: string,
  historial = ''
): Promise<SupervisorChatResult> {
  const snapshot = await construirContexto(pregunta, historial);
  const bloqueHilo = historial
    ? `=== CONVERSACIÓN PREVIA (para resolver referencias como "ese"/"no son 50mil?"; NO la repitas) ===\n${historial}\n\n`
    : '';
  const user = `${snapshot}\n\n${bloqueHilo}=== PREGUNTA DEL CEO ===\n${pregunta.trim()}`;

  const llm = await generarSupervisorLocal({
    system: SUPERVISOR_CHAT_SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 1600,
  });

  return { text: llm.text, model: llm.model, latencyMs: llm.latencyMs };
}
