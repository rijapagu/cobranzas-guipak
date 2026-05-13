/**
 * Reporte diario de cobranzas — enviado por email al supervisor cada mañana.
 * Reutiliza la misma lógica de datos que el empuje matutino de Telegram,
 * pero en formato HTML para email.
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { enviarEmail } from '@/lib/email/sender';

// ─── Tipos internos ──────────────────────────────────────────────────────────

interface ResumenCartera {
  cartera_total: number;
  cartera_a_favor: number;
  cartera_neta: number;
  total_facturas: number;
  total_clientes: number;
  clientes_cubiertos: number;
  por_segmento: Record<'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO', { facturas: number; saldo: number }>;
}

interface ResumenAlertas {
  promesas_vencidas: number;
  pendientes_aprobacion: number;
  pagos_sin_registrar: number;
  enviadas_ayer: number;
  acuerdos_vencen_hoy: number;
  disputas_abiertas: number;
}

interface TopCliente {
  codigo: string;
  nombre: string;
  saldo_neto: number;
  facturas: number;
}

interface ResumenGestiones {
  enviadas_ayer: number;
  aprobadas_hoy: number;
  descartadas_hoy: number;
  pendientes: number;
}

// ─── Queries de datos ────────────────────────────────────────────────────────

async function obtenerCartera(): Promise<ResumenCartera | null> {
  try {
    if (!(await testSoftecConnection())) return null;

    const segmentos = await softecQuery<{
      segmento: string;
      num_facturas: number;
      saldo_total: number;
    }>(`
      SELECT
        CASE
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30              THEN 'ROJO'
          ELSE 'VERDE'
        END AS segmento,
        COUNT(*)                      AS num_facturas,
        SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_total
      FROM v_cobr_ijnl f
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY segmento
    `);

    const r: ResumenCartera = {
      cartera_total: 0,
      cartera_a_favor: 0,
      cartera_neta: 0,
      total_facturas: 0,
      total_clientes: 0,
      clientes_cubiertos: 0,
      por_segmento: {
        VERDE:    { facturas: 0, saldo: 0 },
        AMARILLO: { facturas: 0, saldo: 0 },
        NARANJA:  { facturas: 0, saldo: 0 },
        ROJO:     { facturas: 0, saldo: 0 },
      },
    };

    for (const s of segmentos) {
      const seg = s.segmento as keyof ResumenCartera['por_segmento'];
      r.por_segmento[seg].facturas = Number(s.num_facturas);
      r.por_segmento[seg].saldo    = Number(s.saldo_total);
      r.total_facturas += Number(s.num_facturas);
      r.cartera_total  += Number(s.saldo_total);
    }

    const [{ total }] = await softecQuery<{ total: number }>(`
      SELECT COUNT(DISTINCT f.IJ_CCODE) AS total
      FROM v_cobr_ijnl f
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    `);
    r.total_clientes = Number(total) || 0;

    // CP-15: calcular neto descontando saldo a favor por cliente
    const pendientes = await softecQuery<{ codigo: string; pendiente: number }>(`
      SELECT f.IJ_CCODE AS codigo, SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS pendiente
      FROM v_cobr_ijnl f
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY f.IJ_CCODE
    `);
    const codigos = pendientes.map((p) => String(p.codigo).trim());
    const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);

    let aFavor = 0; let neto = 0; let cubiertos = 0;
    for (const p of pendientes) {
      const cod = String(p.codigo).trim();
      const bruto = Number(p.pendiente) || 0;
      const favor = saldosFavor.get(cod) ?? 0;
      aFavor += Math.min(bruto, favor);
      neto   += Math.max(0, bruto - favor);
      if (favor >= bruto && bruto > 0) cubiertos += 1;
    }
    r.cartera_a_favor   = Math.round(aFavor * 100) / 100;
    r.cartera_neta      = Math.round(neto   * 100) / 100;
    r.clientes_cubiertos = cubiertos;

    return r;
  } catch (err) {
    console.error('[reporte-diario] Error cartera:', err);
    return null;
  }
}

async function obtenerAlertas(): Promise<ResumenAlertas> {
  const r: ResumenAlertas = {
    promesas_vencidas: 0,
    pendientes_aprobacion: 0,
    pagos_sin_registrar: 0,
    enviadas_ayer: 0,
    acuerdos_vencen_hoy: 0,
    disputas_abiertas: 0,
  };
  try {
    const [[prom], [pend], [pagos], [ayer], [hoy], [disp]] = await Promise.all([
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida < CURDATE()"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='PENDIENTE'"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_conciliacion WHERE estado='POR_APLICAR'"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='ENVIADO' AND DATE(fecha_envio)=CURDATE()-INTERVAL 1 DAY"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida=CURDATE()"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_disputas WHERE estado IN ('ABIERTA','EN_REVISION')"),
    ]);
    r.promesas_vencidas    = Number(prom.t) || 0;
    r.pendientes_aprobacion = Number(pend.t) || 0;
    r.pagos_sin_registrar  = Number(pagos.t) || 0;
    r.enviadas_ayer        = Number(ayer.t) || 0;
    r.acuerdos_vencen_hoy  = Number(hoy.t) || 0;
    r.disputas_abiertas    = Number(disp.t) || 0;
  } catch (err) {
    console.error('[reporte-diario] Error alertas:', err);
  }
  return r;
}

async function obtenerTopClientes(): Promise<TopCliente[]> {
  try {
    if (!(await testSoftecConnection())) return [];
    const rows = await softecQuery<{ codigo: string; nombre: string; pendiente: number; facturas: number }>(`
      SELECT
        f.IJ_CCODE                     AS codigo,
        c.IC_NAME                      AS nombre,
        SUM(f.IJ_TOT - f.IJ_TOTAPPL)  AS pendiente,
        COUNT(*)                       AS facturas
      FROM v_cobr_ijnl f
      INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY f.IJ_CCODE, c.IC_NAME
      ORDER BY pendiente DESC
      LIMIT 10
    `);
    const codigos = rows.map((r) => String(r.codigo).trim());
    const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);

    return rows
      .map((r) => {
        const cod = String(r.codigo).trim();
        const bruto = Number(r.pendiente) || 0;
        const favor = saldosFavor.get(cod) ?? 0;
        return { codigo: cod, nombre: String(r.nombre).trim(), saldo_neto: Math.max(0, bruto - favor), facturas: Number(r.facturas) };
      })
      .filter((r) => r.saldo_neto > 0)
      .sort((a, b) => b.saldo_neto - a.saldo_neto)
      .slice(0, 8);
  } catch (err) {
    console.error('[reporte-diario] Error top clientes:', err);
    return [];
  }
}

async function obtenerGestiones(): Promise<ResumenGestiones> {
  const r: ResumenGestiones = { enviadas_ayer: 0, aprobadas_hoy: 0, descartadas_hoy: 0, pendientes: 0 };
  try {
    const [[ayer], [apro], [desc], [pend]] = await Promise.all([
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='ENVIADO' AND DATE(fecha_envio)=CURDATE()-INTERVAL 1 DAY"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='APROBADO' AND DATE(fecha_aprobacion)=CURDATE()"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='DESCARTADO' AND DATE(updated_at)=CURDATE()"),
      cobranzasQuery<{ t: number }>("SELECT COUNT(*) AS t FROM cobranza_gestiones WHERE estado='PENDIENTE'"),
    ]);
    r.enviadas_ayer   = Number(ayer.t) || 0;
    r.aprobadas_hoy   = Number(apro.t) || 0;
    r.descartadas_hoy = Number(desc.t) || 0;
    r.pendientes      = Number(pend.t) || 0;
  } catch (err) {
    console.error('[reporte-diario] Error gestiones:', err);
  }
  return r;
}

// ─── Template HTML ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(n);
}

function buildHtml(
  cartera: ResumenCartera | null,
  alertas: ResumenAlertas,
  top: TopCliente[],
  gestiones: ResumenGestiones,
  fecha: string,
  appUrl: string
): string {
  const SEGMENTOS: Array<{ key: keyof ResumenCartera['por_segmento']; emoji: string; label: string; color: string }> = [
    { key: 'ROJO',     emoji: '🔴', label: '30+ días', color: '#ff4d4f' },
    { key: 'NARANJA',  emoji: '🟠', label: '16–30 días', color: '#fa8c16' },
    { key: 'AMARILLO', emoji: '🟡', label: '1–15 días', color: '#faad14' },
    { key: 'VERDE',    emoji: '🟢', label: 'Vence pronto', color: '#52c41a' },
  ];

  const cartRow = (label: string, val: string, bold = false) =>
    `<tr><td style="padding:6px 12px;color:#666;font-size:14px">${label}</td>
     <td style="padding:6px 12px;text-align:right;font-size:14px;${bold ? 'font-weight:700;color:#1a1a1a' : 'color:#333'}">${val}</td></tr>`;

  const alertaItems = [
    alertas.acuerdos_vencen_hoy > 0  && `<li>⚠️ <b>${alertas.acuerdos_vencen_hoy}</b> promesas de pago vencen hoy</li>`,
    alertas.promesas_vencidas > 0     && `<li>🚨 <b>${alertas.promesas_vencidas}</b> promesas vencidas sin cobrar</li>`,
    alertas.pendientes_aprobacion > 0 && `<li>✉️ <b>${alertas.pendientes_aprobacion}</b> mensajes esperando aprobación</li>`,
    alertas.pagos_sin_registrar > 0   && `<li>🏦 <b>${alertas.pagos_sin_registrar}</b> pagos bancarios por aplicar</li>`,
    alertas.disputas_abiertas > 0     && `<li>⚖️ <b>${alertas.disputas_abiertas}</b> disputas abiertas o en revisión</li>`,
  ].filter(Boolean).join('\n');

  const topRows = top.map((c, i) =>
    `<tr style="background:${i % 2 === 0 ? '#fff' : '#fafafa'}">
      <td style="padding:7px 12px;font-size:13px;color:#666">${i + 1}</td>
      <td style="padding:7px 12px;font-size:13px">${c.nombre}</td>
      <td style="padding:7px 12px;font-size:13px;color:#666">${c.codigo}</td>
      <td style="padding:7px 12px;font-size:13px;font-weight:600;text-align:right;color:#cf1322">${fmt(c.saldo_neto)}</td>
      <td style="padding:7px 12px;font-size:13px;text-align:center;color:#666">${c.facturas}</td>
    </tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reporte Diario — Cobros Guipak</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:680px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:#1677ff;padding:24px 32px">
    <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700">📊 Reporte Diario de Cobranzas</h1>
    <p style="margin:6px 0 0;color:rgba(255,255,255,.8);font-size:14px">${fecha}</p>
  </div>

  <div style="padding:24px 32px">

    <!-- Cartera -->
    <h2 style="margin:0 0 12px;font-size:16px;color:#1a1a1a;border-bottom:2px solid #f0f0f0;padding-bottom:8px">
      💰 Cartera Vencida
    </h2>
    ${cartera ? `
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #f0f0f0;border-radius:6px;overflow:hidden">
      ${cartRow('Cartera bruta', fmt(cartera.cartera_total))}
      ${cartera.cartera_a_favor > 0 ? cartRow('Saldo a favor (anticipos)', `- ${fmt(cartera.cartera_a_favor)}`) : ''}
      ${cartRow('Cartera neta cobrable', fmt(cartera.cartera_neta), true)}
      ${cartRow('Total facturas', `${cartera.total_facturas}`)}
      ${cartRow('Total clientes', `${cartera.total_clientes}${cartera.clientes_cubiertos > 0 ? ` (${cartera.clientes_cubiertos} cubiertos por anticipo)` : ''}`)}
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      ${SEGMENTOS.map(s => {
        const d = cartera.por_segmento[s.key];
        const pct = cartera.total_facturas > 0 ? Math.round(d.facturas / cartera.total_facturas * 100) : 0;
        return `<tr>
          <td style="padding:5px 0;width:140px;font-size:13px">${s.emoji} ${s.label}</td>
          <td style="padding:5px 8px">
            <div style="background:#f0f0f0;border-radius:4px;height:16px;overflow:hidden">
              <div style="background:${s.color};width:${pct}%;height:100%;min-width:${d.facturas > 0 ? '4px' : '0'}"></div>
            </div>
          </td>
          <td style="padding:5px 0;width:120px;font-size:13px;text-align:right;font-weight:600">${d.facturas} fact.</td>
          <td style="padding:5px 0 5px 12px;font-size:13px;color:#666;text-align:right">${fmt(d.saldo)}</td>
        </tr>`;
      }).join('')}
    </table>
    ` : `<p style="color:#999;font-style:italic">No se pudo conectar con Softec.</p>`}

    <!-- Gestiones -->
    <h2 style="margin:0 0 12px;font-size:16px;color:#1a1a1a;border-bottom:2px solid #f0f0f0;padding-bottom:8px">
      📤 Gestiones
    </h2>
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      ${[
        { label: 'Enviadas ayer', val: gestiones.enviadas_ayer, color: '#52c41a' },
        { label: 'Aprobadas hoy', val: gestiones.aprobadas_hoy, color: '#1677ff' },
        { label: 'Pendientes aprobación', val: gestiones.pendientes, color: '#fa8c16' },
        { label: 'Descartadas hoy', val: gestiones.descartadas_hoy, color: '#999' },
      ].map(g => `
        <div style="flex:1;min-width:120px;background:#fafafa;border:1px solid #f0f0f0;border-radius:6px;padding:12px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:${g.color}">${g.val}</div>
          <div style="font-size:12px;color:#666;margin-top:4px">${g.label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Alertas -->
    ${alertaItems ? `
    <h2 style="margin:0 0 12px;font-size:16px;color:#1a1a1a;border-bottom:2px solid #f0f0f0;padding-bottom:8px">
      🚨 Acciones Requeridas
    </h2>
    <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:6px;padding:16px;margin-bottom:24px">
      <ul style="margin:0;padding-left:20px;line-height:1.8;font-size:14px">
        ${alertaItems}
      </ul>
    </div>` : `
    <div style="background:#f6ffed;border:1px solid #b7eb8f;border-radius:6px;padding:16px;margin-bottom:24px;font-size:14px;color:#389e0d">
      ✅ Sin alertas activas — todo al día.
    </div>`}

    <!-- Top clientes -->
    ${top.length > 0 ? `
    <h2 style="margin:0 0 12px;font-size:16px;color:#1a1a1a;border-bottom:2px solid #f0f0f0;padding-bottom:8px">
      🏆 Top Clientes por Saldo Neto
    </h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px">
      <thead>
        <tr style="background:#fafafa;border-bottom:2px solid #f0f0f0">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#666">#</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#666">Cliente</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#666">Código</th>
          <th style="padding:8px 12px;text-align:right;font-weight:600;color:#666">Saldo neto</th>
          <th style="padding:8px 12px;text-align:center;font-weight:600;color:#666">Fact.</th>
        </tr>
      </thead>
      <tbody>${topRows}</tbody>
    </table>` : ''}

    <!-- CTA -->
    <div style="text-align:center;padding:8px 0 4px">
      <a href="${appUrl}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600">
        Abrir Sistema de Cobranzas →
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#fafafa;border-top:1px solid #f0f0f0;padding:16px 32px;text-align:center;font-size:12px;color:#999">
    Suministros Guipak — Sistema de Cobranzas · cobros.sguipak.com<br>
    Este reporte se genera automáticamente cada mañana.
  </div>
</div>
</body>
</html>`;
}

function buildTexto(cartera: ResumenCartera | null, alertas: ResumenAlertas, gestiones: ResumenGestiones, fecha: string): string {
  let t = `REPORTE DIARIO DE COBRANZAS — ${fecha}\n${'='.repeat(50)}\n\n`;
  if (cartera) {
    t += `CARTERA\n  Bruta:  ${fmt(cartera.cartera_total)}\n  Neta:   ${fmt(cartera.cartera_neta)}\n  Facturas: ${cartera.total_facturas} · Clientes: ${cartera.total_clientes}\n\n`;
  }
  t += `GESTIONES\n  Enviadas ayer: ${gestiones.enviadas_ayer} · Pendientes: ${gestiones.pendientes}\n\n`;
  const items = [
    alertas.acuerdos_vencen_hoy > 0  && `  - ${alertas.acuerdos_vencen_hoy} promesas vencen hoy`,
    alertas.promesas_vencidas > 0     && `  - ${alertas.promesas_vencidas} promesas vencidas sin cobrar`,
    alertas.pendientes_aprobacion > 0 && `  - ${alertas.pendientes_aprobacion} mensajes pendientes de aprobación`,
    alertas.pagos_sin_registrar > 0   && `  - ${alertas.pagos_sin_registrar} pagos bancarios por aplicar`,
    alertas.disputas_abiertas > 0     && `  - ${alertas.disputas_abiertas} disputas activas`,
  ].filter(Boolean);
  t += items.length > 0 ? `ALERTAS\n${items.join('\n')}\n` : 'Sin alertas activas.\n';
  return t;
}

// ─── Función principal ────────────────────────────────────────────────────────

export interface ResultadoReporte {
  ok: boolean;
  destinatario: string;
  error?: string;
}

export async function enviarReporteDiario(): Promise<ResultadoReporte> {
  const destinatario = process.env.REPORT_EMAIL || process.env.SMTP_USER || '';
  if (!destinatario) {
    return { ok: false, destinatario: '', error: 'REPORT_EMAIL no configurado' };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cobros.sguipak.com';
  const fecha = new Date().toLocaleDateString('es-DO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Santo_Domingo',
  });
  const fechaCorta = new Date().toLocaleDateString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Santo_Domingo',
  });

  const [cartera, alertas, top, gestiones] = await Promise.all([
    obtenerCartera(),
    obtenerAlertas(),
    obtenerTopClientes(),
    obtenerGestiones(),
  ]);

  const htmlBody = buildHtml(cartera, alertas, top, gestiones, fecha, appUrl);
  const textBody = buildTexto(cartera, alertas, gestiones, fecha);
  const asunto   = `📊 Reporte Cobranzas ${fechaCorta}${alertas.promesas_vencidas + alertas.pendientes_aprobacion > 0 ? ' ⚠️' : ''}`;

  const result = await enviarEmail(destinatario, asunto, textBody, undefined, htmlBody);

  return {
    ok: result.status === 'sent',
    destinatario,
    error: result.error,
  };
}
