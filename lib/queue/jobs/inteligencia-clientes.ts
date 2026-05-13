/**
 * Job nocturno: calcula el score de riesgo para TODOS los clientes con saldo pendiente.
 * Corre a la 1:00 AM AST (5:00 AM UTC) para que el equipo llegue con datos frescos.
 *
 * Arquitectura (4 capas):
 *   Raw Data (Softec) → Algoritmo (aquí, reglas puras) → cobranza_cliente_inteligencia → Claude (comunica)
 *
 * Claude NO calcula. Lee la tabla y comunica.
 */
import { softecQuery } from '@/lib/db/softec';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { obtenerSaldoAFavorPorCliente, ajustarSaldoCliente } from '@/lib/cobranzas/saldo-favor';

// =====================================================================
// Tipos internos
// =====================================================================

interface ClienteAging {
  codigo: string;
  nombre: string;
  saldo_pendiente: number;
  total_facturas: number;
  dias_mora_promedio: number;
  factura_mas_antigua_dias: number;
  bucket_0_15: number;
  bucket_16_30: number;
  bucket_31_60: number;
  bucket_60_plus: number;
}

interface PromesaStats {
  total: number;
  cumplidas: number;
}

interface IntelRecord {
  codigo_cliente: string;
  risk_score: number;
  saldo_anterior: number | null;
  score_anterior: number | null;
}

interface ScoringResult {
  risk_score: number;
  risk_level: 'VERDE' | 'AMARILLO' | 'ROJO' | 'CRITICO';
  accion_credito: 'NORMAL' | 'REDUCIR_LIMITE' | 'AUTORIZAR_MANUAL' | 'SUSPENDER';
  accion_ventas: 'NORMAL' | 'SUBIR_MARGEN' | 'REQUIERE_ABONO' | 'NO_VENDER';
  accion_cobranza: 'CADENCIA_NORMAL' | 'SEGUIMIENTO_INTENSIVO' | 'GESTION_DIRECTA' | 'COBRO_LEGAL';
  tendencia: 'MEJORANDO' | 'ESTABLE' | 'EMPEORANDO';
  razones: string[];
  resumen: string;
}

// =====================================================================
// Algoritmo de scoring (puro — sin Claude, sin AI)
// =====================================================================

function calcularScore(
  m: ClienteAging,
  saldo_neto: number,
  promesas: PromesaStats,
  previo: IntelRecord | null
): ScoringResult {
  let score = 0;
  const razones: string[] = [];

  // --- 1. Mora promedio (0-35 puntos) ---
  const mora = m.dias_mora_promedio;
  if (mora > 90) {
    score += 35;
    razones.push(`Mora promedio crítica: ${mora.toFixed(0)} días`);
  } else if (mora > 60) {
    score += 25;
    razones.push(`Mora promedio alta: ${mora.toFixed(0)} días`);
  } else if (mora > 30) {
    score += 15;
    razones.push(`Mora promedio moderada: ${mora.toFixed(0)} días`);
  } else if (mora > 15) {
    score += 5;
    razones.push(`Mora promedio leve: ${mora.toFixed(0)} días`);
  }

  // --- 2. Tendencia vs período anterior (0-20 puntos) ---
  let tendencia: 'MEJORANDO' | 'ESTABLE' | 'EMPEORANDO' = 'ESTABLE';
  if (previo) {
    const deltaScore = score - (previo.score_anterior ?? score);
    const deltaSaldo = saldo_neto - (previo.saldo_anterior ?? saldo_neto);
    if (deltaScore >= 10 || deltaSaldo > 50000) {
      tendencia = 'EMPEORANDO';
      score += 20;
      razones.push('Tendencia: empeorando vs período anterior');
    } else if (deltaScore <= -10 || deltaSaldo < -50000) {
      tendencia = 'MEJORANDO';
      razones.push('Tendencia: mejorando vs período anterior');
    } else if (mora > 30) {
      score += 5;
    }
  }

  // --- 3. Cumplimiento de promesas (0-30 puntos) ---
  const tasaCumpl = promesas.total > 0
    ? (promesas.cumplidas / promesas.total) * 100
    : 100;

  if (promesas.total > 0) {
    if (tasaCumpl < 30) {
      score += 30;
      razones.push(`Muy bajo cumplimiento de promesas: ${tasaCumpl.toFixed(0)}%`);
    } else if (tasaCumpl < 50) {
      score += 20;
      razones.push(`Bajo cumplimiento de promesas: ${tasaCumpl.toFixed(0)}%`);
    } else if (tasaCumpl < 70) {
      score += 10;
      razones.push(`Cumplimiento de promesas regular: ${tasaCumpl.toFixed(0)}%`);
    } else if (tasaCumpl < 85) {
      score += 5;
    }
  }

  // --- 4. Volumen de deuda neta (0-15 puntos) ---
  if (saldo_neto > 500000) {
    score += 15;
    razones.push(`Exposición alta: RD$${saldo_neto.toLocaleString('es-DO')} neto`);
  } else if (saldo_neto > 200000) {
    score += 10;
    razones.push(`Exposición significativa: RD$${saldo_neto.toLocaleString('es-DO')} neto`);
  } else if (saldo_neto > 50000) {
    score += 5;
  }

  // Clamp a 100
  const risk_score = Math.min(100, Math.max(0, score));

  // --- Clasificación ---
  let risk_level: 'VERDE' | 'AMARILLO' | 'ROJO' | 'CRITICO';
  let accion_credito: 'NORMAL' | 'REDUCIR_LIMITE' | 'AUTORIZAR_MANUAL' | 'SUSPENDER';
  let accion_ventas: 'NORMAL' | 'SUBIR_MARGEN' | 'REQUIERE_ABONO' | 'NO_VENDER';
  let accion_cobranza: 'CADENCIA_NORMAL' | 'SEGUIMIENTO_INTENSIVO' | 'GESTION_DIRECTA' | 'COBRO_LEGAL';

  if (risk_score >= 76) {
    risk_level     = 'CRITICO';
    accion_credito = 'SUSPENDER';
    accion_ventas  = 'NO_VENDER';
    accion_cobranza = 'COBRO_LEGAL';
  } else if (risk_score >= 61) {
    risk_level     = 'ROJO';
    accion_credito = 'AUTORIZAR_MANUAL';
    accion_ventas  = 'REQUIERE_ABONO';
    accion_cobranza = 'GESTION_DIRECTA';
  } else if (risk_score >= 46) {
    risk_level     = 'ROJO';
    accion_credito = 'REDUCIR_LIMITE';
    accion_ventas  = 'SUBIR_MARGEN';
    accion_cobranza = 'SEGUIMIENTO_INTENSIVO';
  } else if (risk_score >= 31) {
    risk_level     = 'AMARILLO';
    accion_credito = 'REDUCIR_LIMITE';
    accion_ventas  = 'SUBIR_MARGEN';
    accion_cobranza = 'SEGUIMIENTO_INTENSIVO';
  } else {
    risk_level     = 'VERDE';
    accion_credito = 'NORMAL';
    accion_ventas  = 'NORMAL';
    accion_cobranza = 'CADENCIA_NORMAL';
  }

  // --- Resumen legible para Claude ---
  const resumen = generarResumen(m, saldo_neto, risk_level, tendencia, tasaCumpl, razones);

  return {
    risk_score,
    risk_level,
    accion_credito,
    accion_ventas,
    accion_cobranza,
    tendencia,
    razones,
    resumen,
  };
}

function generarResumen(
  m: ClienteAging,
  saldo_neto: number,
  risk_level: string,
  tendencia: string,
  tasaCumpl: number,
  razones: string[]
): string {
  const emojiNivel: Record<string, string> = {
    VERDE: '🟢', AMARILLO: '🟡', ROJO: '🔴', CRITICO: '🚨',
  };
  const emoji = emojiNivel[risk_level] || '⚪';
  const tendenciaStr = tendencia === 'EMPEORANDO' ? '⬆️ empeorando'
    : tendencia === 'MEJORANDO' ? '⬇️ mejorando'
    : 'estable';

  let txt = `${emoji} ${m.nombre.trim()} — Riesgo ${risk_level} (score ${m.dias_mora_promedio.toFixed(0)}d mora prom). `;
  txt += `Saldo neto RD$${saldo_neto.toLocaleString('es-DO')}, ${m.total_facturas} factura(s). `;
  txt += `Tendencia ${tendenciaStr}.`;
  if (tasaCumpl < 100 && m.total_facturas > 0) {
    txt += ` Cumplimiento promesas: ${tasaCumpl.toFixed(0)}%.`;
  }
  if (razones.length > 0) {
    txt += ` Factores: ${razones.slice(0, 2).join('; ')}.`;
  }
  return txt;
}

// =====================================================================
// Job principal
// =====================================================================

export async function ejecutarInteligenciaClientes(): Promise<{
  procesados: number;
  omitidos: number;
  errores: number;
}> {
  console.log('[InteligenciaClientes] Iniciando cálculo de scores...');
  const inicio = Date.now();

  // 1. Obtener aging de todos los clientes con facturas pendientes en Softec
  const agingRaw = await softecQuery<{
    codigo: string;
    nombre: string;
    saldo_pendiente: number;
    total_facturas: number;
    dias_mora_promedio: number;
    factura_mas_antigua_dias: number;
    bucket_0_15: number;
    bucket_16_30: number;
    bucket_31_60: number;
    bucket_60_plus: number;
  }>(`
    SELECT
      c.IC_CODE   AS codigo,
      c.IC_NAME   AS nombre,
      SUM(f.IJ_TOT - f.IJ_TOTAPPL)                            AS saldo_pendiente,
      COUNT(f.IJ_INUM)                                         AS total_facturas,
      AVG(GREATEST(0, DATEDIFF(CURDATE(), f.IJ_DUEDATE)))      AS dias_mora_promedio,
      MAX(GREATEST(0, DATEDIFF(CURDATE(), f.IJ_DUEDATE)))      AS factura_mas_antigua_dias,
      SUM(CASE WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN (f.IJ_TOT - f.IJ_TOTAPPL) ELSE 0 END) AS bucket_0_15,
      SUM(CASE WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN (f.IJ_TOT - f.IJ_TOTAPPL) ELSE 0 END) AS bucket_16_30,
      SUM(CASE WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 31 AND 60 THEN (f.IJ_TOT - f.IJ_TOTAPPL) ELSE 0 END) AS bucket_31_60,
      SUM(CASE WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 60            THEN (f.IJ_TOT - f.IJ_TOTAPPL) ELSE 0 END) AS bucket_60_plus
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE f.IJ_TYPEDOC = 'IN'
      AND f.IJ_INVTORF = 'T'
      AND f.IJ_PAID    = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    GROUP BY c.IC_CODE, c.IC_NAME
    ORDER BY saldo_pendiente DESC
  `);

  if (agingRaw.length === 0) {
    console.log('[InteligenciaClientes] No hay clientes con saldo pendiente.');
    return { procesados: 0, omitidos: 0, errores: 0 };
  }

  const codigos = agingRaw.map((r) => r.codigo.trim());

  // 2. Saldos a favor (CP-15)
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);

  // 3. Cumplimiento de promesas (últimos 90 días para que sea relevante)
  const promesasRaw = await cobranzasQuery<{
    codigo_cliente: string;
    total: number;
    cumplidas: number;
  }>(`
    SELECT
      codigo_cliente,
      COUNT(*)                                                           AS total,
      SUM(CASE WHEN estado = 'CUMPLIDA' THEN 1 ELSE 0 END)              AS cumplidas
    FROM cobranza_acuerdos
    WHERE fecha_prometida >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
    GROUP BY codigo_cliente
  `);
  const promesasMap = new Map<string, PromesaStats>(
    promesasRaw.map((p) => [
      p.codigo_cliente.trim(),
      { total: Number(p.total), cumplidas: Number(p.cumplidas) },
    ])
  );

  // 4. Registros previos para calcular tendencia
  const previosRaw = await cobranzasQuery<IntelRecord>(`
    SELECT codigo_cliente, risk_score, saldo_anterior, score_anterior
    FROM cobranza_cliente_inteligencia
  `);
  const previosMap = new Map<string, IntelRecord>(
    previosRaw.map((p) => [p.codigo_cliente.trim(), p])
  );

  // 5. Calcular scores en memoria y hacer bulk upsert
  let procesados = 0;
  let errores = 0;

  for (const raw of agingRaw) {
    try {
      const codigo = raw.codigo.trim();
      const saldoBruto = Number(raw.saldo_pendiente) || 0;
      const favor = saldosFavor.get(codigo) ?? 0;
      const ajuste = ajustarSaldoCliente(saldoBruto, favor);

      const agingClean: ClienteAging = {
        codigo,
        nombre: String(raw.nombre).trim(),
        saldo_pendiente: saldoBruto,
        total_facturas: Number(raw.total_facturas),
        dias_mora_promedio: Number(raw.dias_mora_promedio) || 0,
        factura_mas_antigua_dias: Number(raw.factura_mas_antigua_dias) || 0,
        bucket_0_15:   Number(raw.bucket_0_15)   || 0,
        bucket_16_30:  Number(raw.bucket_16_30)  || 0,
        bucket_31_60:  Number(raw.bucket_31_60)  || 0,
        bucket_60_plus: Number(raw.bucket_60_plus) || 0,
      };

      const promesas = promesasMap.get(codigo) ?? { total: 0, cumplidas: 0 };
      const previo = previosMap.get(codigo) ?? null;

      const scoring = calcularScore(agingClean, ajuste.saldo_neto, promesas, previo);

      // Tendencia requiere guardar score anterior → se almacena como score_anterior en el próximo ciclo
      const saldo_anterior_prev = previo?.saldo_anterior ?? null;
      const score_anterior_prev = previo?.risk_score ?? null;

      await cobranzasExecute(`
        INSERT INTO cobranza_cliente_inteligencia (
          codigo_cliente, nombre_cliente,
          risk_score, risk_level,
          saldo_pendiente, saldo_neto, saldo_a_favor, total_facturas,
          dias_mora_promedio, factura_mas_antigua_dias,
          monto_bucket_0_15, monto_bucket_16_30, monto_bucket_31_60, monto_bucket_60_plus,
          tendencia, score_anterior, saldo_anterior,
          promesas_total, promesas_cumplidas, tasa_cumplimiento_promesas,
          accion_credito, accion_ventas, accion_cobranza,
          razones, resumen,
          calculado_at, calculado_por
        ) VALUES (
          ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          NOW(), 'sistema'
        )
        ON DUPLICATE KEY UPDATE
          nombre_cliente   = VALUES(nombre_cliente),
          risk_score       = VALUES(risk_score),
          risk_level       = VALUES(risk_level),
          saldo_pendiente  = VALUES(saldo_pendiente),
          saldo_neto       = VALUES(saldo_neto),
          saldo_a_favor    = VALUES(saldo_a_favor),
          total_facturas   = VALUES(total_facturas),
          dias_mora_promedio          = VALUES(dias_mora_promedio),
          factura_mas_antigua_dias    = VALUES(factura_mas_antigua_dias),
          monto_bucket_0_15           = VALUES(monto_bucket_0_15),
          monto_bucket_16_30          = VALUES(monto_bucket_16_30),
          monto_bucket_31_60          = VALUES(monto_bucket_31_60),
          monto_bucket_60_plus        = VALUES(monto_bucket_60_plus),
          tendencia                   = VALUES(tendencia),
          score_anterior              = VALUES(score_anterior),
          saldo_anterior              = VALUES(saldo_anterior),
          promesas_total              = VALUES(promesas_total),
          promesas_cumplidas          = VALUES(promesas_cumplidas),
          tasa_cumplimiento_promesas  = VALUES(tasa_cumplimiento_promesas),
          accion_credito              = VALUES(accion_credito),
          accion_ventas               = VALUES(accion_ventas),
          accion_cobranza             = VALUES(accion_cobranza),
          razones                     = VALUES(razones),
          resumen                     = VALUES(resumen),
          calculado_at                = NOW(),
          calculado_por               = 'sistema'
      `, [
        codigo,
        agingClean.nombre,
        scoring.risk_score,
        scoring.risk_level,
        saldoBruto,
        ajuste.saldo_neto,
        ajuste.saldo_a_favor,
        agingClean.total_facturas,
        agingClean.dias_mora_promedio,
        agingClean.factura_mas_antigua_dias,
        agingClean.bucket_0_15,
        agingClean.bucket_16_30,
        agingClean.bucket_31_60,
        agingClean.bucket_60_plus,
        scoring.tendencia,
        score_anterior_prev,
        saldo_anterior_prev,
        promesas.total,
        promesas.cumplidas,
        promesas.total > 0 ? (promesas.cumplidas / promesas.total) * 100 : 100,
        scoring.accion_credito,
        scoring.accion_ventas,
        scoring.accion_cobranza,
        JSON.stringify(scoring.razones),
        scoring.resumen,
      ]);

      procesados++;
    } catch (err) {
      errores++;
      console.error(`[InteligenciaClientes] Error procesando ${raw.codigo}:`, err);
    }
  }

  const duracion = Math.round((Date.now() - inicio) / 1000);
  const omitidos = agingRaw.length - procesados - errores;

  await logAccion(null, 'INTELIGENCIA_CLIENTES_RUN', 'sistema', 'batch', {
    procesados,
    omitidos,
    errores,
    total_clientes: agingRaw.length,
    duracion_segundos: duracion,
  });

  console.log(
    `[InteligenciaClientes] Completado en ${duracion}s — ${procesados} procesados, ${errores} errores`
  );

  return { procesados, omitidos, errores };
}
