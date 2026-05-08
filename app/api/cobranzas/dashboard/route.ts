import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { getMockCartera } from '@/lib/mock/cartera-mock';

interface DashboardKPIs {
  // Cartera
  cartera_total: number;
  total_facturas: number;
  total_clientes: number;
  dso: number;
  // Segmentos
  segmentos: { segmento: string; facturas: number; clientes: number; saldo: number }[];
  // Gestiones
  gestiones_hoy: number;
  pendientes_aprobacion: number;
  enviadas_hoy: number;
  // Acuerdos
  acuerdos_pendientes: number;
  acuerdos_cumplidos_mes: number;
  acuerdos_incumplidos_mes: number;
  // Canales
  wa_enviados_mes: number;
  wa_respondidos_mes: number;
  email_enviados_mes: number;
  email_respondidos_mes: number;
  // Top 10 clientes
  top_clientes: { codigo: string; nombre: string; saldo: number; facturas: number }[];
  // Alertas
  promesas_vencidas: number;
  facturas_sin_gestion_30d: number;
  clientes_sin_contacto: number;
  // Meta
  modo: 'live' | 'mock';
}

/**
 * GET /api/cobranzas/dashboard
 * Retorna KPIs para el dashboard principal.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const softecOk = await testSoftecConnection();
    const kpis: DashboardKPIs = {
      cartera_total: 0,
      total_facturas: 0,
      total_clientes: 0,
      dso: 0,
      segmentos: [],
      gestiones_hoy: 0,
      pendientes_aprobacion: 0,
      enviadas_hoy: 0,
      acuerdos_pendientes: 0,
      acuerdos_cumplidos_mes: 0,
      acuerdos_incumplidos_mes: 0,
      wa_enviados_mes: 0,
      wa_respondidos_mes: 0,
      email_enviados_mes: 0,
      email_respondidos_mes: 0,
      top_clientes: [],
      promesas_vencidas: 0,
      facturas_sin_gestion_30d: 0,
      clientes_sin_contacto: 0,
      modo: softecOk ? 'live' : 'mock',
    };

    // --- Datos de Softec o Mock ---
    if (softecOk) {
      // Resumen por segmento
      const segmentos = await softecQuery<{
        segmento: string;
        num_facturas: number;
        num_clientes: number;
        saldo_total: number;
      }>(`
        SELECT
          CASE
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
            WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30 THEN 'ROJO'
            ELSE 'VERDE'
          END AS segmento,
          COUNT(*) AS num_facturas,
          COUNT(DISTINCT f.IJ_CCODE) AS num_clientes,
          SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_total
        FROM v_cobr_ijnl f
        WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
        GROUP BY segmento
        ORDER BY FIELD(segmento, 'ROJO', 'NARANJA', 'AMARILLO', 'VERDE')
      `);

      kpis.segmentos = segmentos.map(s => ({
        segmento: s.segmento,
        facturas: Number(s.num_facturas),
        clientes: Number(s.num_clientes),
        saldo: Number(s.saldo_total),
      }));
      kpis.total_facturas = kpis.segmentos.reduce((sum, s) => sum + s.facturas, 0);
      kpis.total_clientes = kpis.segmentos.reduce((sum, s) => sum + s.clientes, 0);
      kpis.cartera_total = kpis.segmentos.reduce((sum, s) => sum + s.saldo, 0);

      // Top 10 clientes
      const top = await softecQuery<{
        codigo: string;
        nombre: string;
        saldo: number;
        facturas: number;
      }>(`
        SELECT
          c.IC_CODE AS codigo,
          c.IC_NAME AS nombre,
          SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo,
          COUNT(*) AS facturas
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
        WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
          AND f.IJ_DUEDATE < CURDATE()
        GROUP BY c.IC_CODE, c.IC_NAME
        ORDER BY saldo DESC
        LIMIT 10
      `);
      kpis.top_clientes = top.map(t => ({
        codigo: String(t.codigo).trim(),
        nombre: String(t.nombre).trim(),
        saldo: Number(t.saldo),
        facturas: Number(t.facturas),
      }));

      // DSO = (CxC / Ventas últimos 90 días) × 90
      const dsoData = await softecQuery<{ cxc: number; ventas_90: number }>(`
        SELECT
          (SELECT SUM(IJ_TOT - IJ_TOTAPPL) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0) AS cxc,
          (SELECT SUM(IJ_TOT) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_DATE >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AS ventas_90
      `);
      if (dsoData[0] && Number(dsoData[0].ventas_90) > 0) {
        kpis.dso = Math.round((Number(dsoData[0].cxc) / Number(dsoData[0].ventas_90)) * 90);
      }

      // Clientes sin contacto
      const sinContacto = await softecQuery<{ total: number }>(`
        SELECT COUNT(DISTINCT c.IC_CODE) AS total
        FROM v_cobr_icust c
        INNER JOIN v_cobr_ijnl f ON f.IJ_CCODE = c.IC_CODE
        WHERE c.IC_STATUS = 'A' AND f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
          AND (c.IC_EMAIL IS NULL OR TRIM(c.IC_EMAIL) = '')
          AND (c.IC_PHONE IS NULL OR TRIM(c.IC_PHONE) = '')
      `);
      kpis.clientes_sin_contacto = Number(sinContacto[0]?.total) || 0;
    } else {
      // Mock
      const mockData = getMockCartera();
      const segMap: Record<string, { facturas: number; clientes: Set<string>; saldo: number }> = {};
      const clienteMap: Record<string, { nombre: string; saldo: number; facturas: number }> = {};

      mockData.forEach(f => {
        const seg = f.segmento_riesgo;
        if (!segMap[seg]) segMap[seg] = { facturas: 0, clientes: new Set(), saldo: 0 };
        segMap[seg].facturas++;
        segMap[seg].clientes.add(f.codigo_cliente);
        segMap[seg].saldo += f.saldo_pendiente;

        if (!clienteMap[f.codigo_cliente]) {
          clienteMap[f.codigo_cliente] = { nombre: f.nombre_cliente, saldo: 0, facturas: 0 };
        }
        clienteMap[f.codigo_cliente].saldo += f.saldo_pendiente;
        clienteMap[f.codigo_cliente].facturas++;
      });

      kpis.segmentos = Object.entries(segMap).map(([seg, data]) => ({
        segmento: seg,
        facturas: data.facturas,
        clientes: data.clientes.size,
        saldo: data.saldo,
      }));
      kpis.total_facturas = mockData.length;
      kpis.total_clientes = new Set(mockData.map(f => f.codigo_cliente)).size;
      kpis.cartera_total = mockData.reduce((sum, f) => sum + f.saldo_pendiente, 0);
      kpis.dso = 45; // Mock value

      kpis.top_clientes = Object.entries(clienteMap)
        .sort(([, a], [, b]) => b.saldo - a.saldo)
        .slice(0, 10)
        .map(([codigo, data]) => ({ codigo, ...data }));

      kpis.clientes_sin_contacto = mockData.filter(f => !f.email && !f.telefono).length;
    }

    // --- Datos de cobranzas_guipak (siempre real) ---
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = `${hoy.substring(0, 7)}-01`;

    // Gestiones hoy
    const gestionesHoy = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE DATE(created_at) = ?",
      [hoy]
    );
    kpis.gestiones_hoy = gestionesHoy[0]?.total || 0;

    // Pendientes aprobación
    const pendientes = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE estado = 'PENDIENTE'"
    );
    kpis.pendientes_aprobacion = pendientes[0]?.total || 0;

    // Enviadas hoy
    const enviadasHoy = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE estado = 'ENVIADO' AND DATE(fecha_envio) = ?",
      [hoy]
    );
    kpis.enviadas_hoy = enviadasHoy[0]?.total || 0;

    // Acuerdos
    const acuerdos = await cobranzasQuery<{ estado: string; total: number }>(
      `SELECT estado, COUNT(*) as total FROM cobranza_acuerdos
       WHERE estado IN ('PENDIENTE', 'CUMPLIDO', 'INCUMPLIDO')
       AND (estado = 'PENDIENTE' OR updated_at >= ?)
       GROUP BY estado`,
      [inicioMes]
    );
    acuerdos.forEach(a => {
      if (a.estado === 'PENDIENTE') kpis.acuerdos_pendientes = a.total;
      if (a.estado === 'CUMPLIDO') kpis.acuerdos_cumplidos_mes = a.total;
      if (a.estado === 'INCUMPLIDO') kpis.acuerdos_incumplidos_mes = a.total;
    });

    // Canales — mensajes del mes
    const canales = await cobranzasQuery<{ canal: string; direccion: string; total: number }>(
      `SELECT canal, direccion, COUNT(*) as total FROM cobranza_conversaciones
       WHERE created_at >= ?
       GROUP BY canal, direccion`,
      [inicioMes]
    );
    canales.forEach(c => {
      if (c.canal === 'WHATSAPP' && c.direccion === 'ENVIADO') kpis.wa_enviados_mes = c.total;
      if (c.canal === 'WHATSAPP' && c.direccion === 'RECIBIDO') kpis.wa_respondidos_mes = c.total;
      if (c.canal === 'EMAIL' && c.direccion === 'ENVIADO') kpis.email_enviados_mes = c.total;
      if (c.canal === 'EMAIL' && c.direccion === 'RECIBIDO') kpis.email_respondidos_mes = c.total;
    });

    // Promesas vencidas
    const promesasVencidas = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_acuerdos WHERE estado = 'PENDIENTE' AND fecha_prometida < CURDATE()"
    );
    kpis.promesas_vencidas = promesasVencidas[0]?.total || 0;

    return NextResponse.json(kpis);
  } catch (error) {
    console.error('[DASHBOARD] Error:', error);
    return NextResponse.json({ error: 'Error calculando KPIs' }, { status: 500 });
  }
}
