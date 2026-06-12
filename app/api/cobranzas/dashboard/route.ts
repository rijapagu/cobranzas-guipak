import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { getRedis } from '@/lib/redis/client';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { carteraCompatParaEmpresa } from '@/lib/erp/compat';

// Cache del dashboard en Redis: ~10 queries (varias agregando toda la
// cartera del ERP) por cada carga de página no escalan sin esto.
// La clave incluye la empresa: cada tenant tiene su propio cache.
const DASHBOARD_CACHE_TTL_SEG = 120;
const cacheKeyDashboard = (empresaId: number) => `cache:dashboard:v2:empresa:${empresaId}`;

interface DashboardKPIs {
  // Cartera
  cartera_total: number;          // bruto (compat)
  cartera_total_a_favor: number;  // CP-15: anticipos aplicables
  cartera_total_neta: number;     // CP-15: bruto - a favor
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
  // Top 10 clientes — CP-15: ordenado por saldo_neto, no por saldo bruto.
  top_clientes: {
    codigo: string;
    nombre: string;
    saldo: number;          // bruto (compat)
    saldo_a_favor: number;
    saldo_neto: number;
    facturas: number;
  }[];
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
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Cache (TTL 2 min). El botón "Actualizar" puede forzar con ?refresh=1.
  const empresaId = empresaIdDeSesion(session);

  const cacheKey = cacheKeyDashboard(empresaId);
  const forzar = request.nextUrl.searchParams.get('refresh') === '1';
  if (!forzar) {
    try {
      const cacheado = await getRedis().get(cacheKey);
      if (cacheado) {
        return NextResponse.json(JSON.parse(cacheado));
      }
    } catch {
      // Redis caído → calcular en vivo
    }
  }

  try {
    // Guipak (empresa 1) sigue en Softec en vivo; las demás empresas leen su
    // cartera importada via adaptador ERP (lib/erp). CP-15 y DSO son
    // dimensiones Softec — en modo CSV: neto == bruto, DSO 0.
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const softecOk = esGuipak && (await testSoftecConnection());
    const kpis: DashboardKPIs = {
      cartera_total: 0,
      cartera_total_a_favor: 0,
      cartera_total_neta: 0,
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
      modo: esGuipak && !softecOk ? 'mock' : 'live',
    };

    // --- Datos de cartera via adaptador ERP (todas las empresas) ---
    // El mock solo aplica a Guipak sin conexión Softec. DSO, saldo a favor
    // (CP-15) y el conteo exacto de clientes sin contacto son dimensiones
    // Softec y se calculan aparte solo para Guipak en vivo.
    if (!esGuipak || softecOk) {
      const cartera = await carteraCompatParaEmpresa(empresaId, { incluirPorVencerDias: 36500 });
      const segMap: Record<string, { facturas: number; clientes: Set<string>; saldo: number }> = {};
      const clienteMap: Record<string, { nombre: string; saldo: number; facturas: number }> = {};
      for (const f of cartera) {
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
      }
      kpis.segmentos = Object.entries(segMap).map(([seg, d]) => ({
        segmento: seg,
        facturas: d.facturas,
        clientes: d.clientes.size,
        saldo: Math.round(d.saldo * 100) / 100,
      }));
      kpis.total_facturas = cartera.length;
      kpis.total_clientes = new Set(cartera.map((f) => f.codigo_cliente)).size;
      kpis.cartera_total = Math.round(cartera.reduce((s, f) => s + f.saldo_pendiente, 0) * 100) / 100;
      kpis.cartera_total_a_favor = 0;
      kpis.cartera_total_neta = kpis.cartera_total;
      kpis.top_clientes = Object.entries(clienteMap)
        .sort(([, a], [, b]) => b.saldo - a.saldo)
        .slice(0, 10)
        .map(([codigo, d]) => ({
          codigo,
          ...d,
          saldo_a_favor: 0,
          saldo_neto: d.saldo,
        }));
      kpis.clientes_sin_contacto = cartera
        .filter((f) => !f.email?.trim() && !f.telefono?.trim())
        .reduce((set, f) => set.add(f.codigo_cliente), new Set<string>()).size;

      if (softecOk) {
        // CP-15: top clientes reordenado por saldo NETO (top 30 candidatos
        // por bruto, restar saldo a favor, quedarse con 10).
        const candidatos = Object.entries(clienteMap)
          .sort(([, a], [, b]) => b.saldo - a.saldo)
          .slice(0, 30);
        const saldosFavor = await obtenerSaldoAFavorPorCliente(candidatos.map(([c]) => c));
        kpis.top_clientes = candidatos
          .map(([codigo, d]) => {
            const favor = saldosFavor.get(codigo) ?? 0;
            return {
              codigo,
              nombre: d.nombre,
              saldo: d.saldo,
              saldo_a_favor: Math.min(d.saldo, favor),
              saldo_neto: Math.max(0, d.saldo - favor),
              facturas: d.facturas,
            };
          })
          .sort((a, b) => b.saldo_neto - a.saldo_neto)
          .slice(0, 10);

        // CP-15: cartera neta global (favor aplicado por cliente, sin
        // transferir entre clientes).
        const saldosFavorTodos = await obtenerSaldoAFavorPorCliente(Object.keys(clienteMap));
        let aFavorAplicable = 0;
        let netoAcumulado = 0;
        for (const [codigo, d] of Object.entries(clienteMap)) {
          const favor = saldosFavorTodos.get(codigo) ?? 0;
          aFavorAplicable += Math.min(d.saldo, favor);
          netoAcumulado += Math.max(0, d.saldo - favor);
        }
        kpis.cartera_total_a_favor = Math.round(aFavorAplicable * 100) / 100;
        kpis.cartera_total_neta = Math.round(netoAcumulado * 100) / 100;

        // DSO = (CxC / Ventas últimos 90 días) × 90 — requiere las ventas
        // del ERP: query especializada solo-Softec.
        const dsoData = await softecQuery<{ cxc: number; ventas_90: number }>(`
          SELECT
            (SELECT SUM(IJ_TOT - IJ_TOTAPPL) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0) AS cxc,
            (SELECT SUM(IJ_TOT) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_DATE >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AS ventas_90
        `);
        if (dsoData[0] && Number(dsoData[0].ventas_90) > 0) {
          kpis.dso = Math.round((Number(dsoData[0].cxc) / Number(dsoData[0].ventas_90)) * 90);
        }

        // Clientes sin contacto con la semántica legacy exacta (IC_EMAIL /
        // IC_PHONE — el modelo canónico expone el email de CxP, no el general).
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
      }
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
      // CP-15: en mock no hay anticipos modelados — neto == bruto, a favor 0.
      kpis.cartera_total_a_favor = 0;
      kpis.cartera_total_neta = kpis.cartera_total;
      kpis.dso = 45; // Mock value

      kpis.top_clientes = Object.entries(clienteMap)
        .sort(([, a], [, b]) => b.saldo - a.saldo)
        .slice(0, 10)
        .map(([codigo, data]) => ({
          codigo,
          ...data,
          saldo_a_favor: 0,
          saldo_neto: data.saldo,
        }));

      kpis.clientes_sin_contacto = mockData.filter(f => !f.email && !f.telefono).length;
    }

    // --- Datos de cobranzas_guipak (siempre real) ---
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = `${hoy.substring(0, 7)}-01`;

    // Gestiones hoy
    const gestionesHoy = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE empresa_id = ? AND DATE(created_at) = ?",
      [empresaId, hoy]
    );
    kpis.gestiones_hoy = gestionesHoy[0]?.total || 0;

    // Pendientes aprobación
    const pendientes = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE empresa_id = ? AND estado = 'PENDIENTE'",
      [empresaId]
    );
    kpis.pendientes_aprobacion = pendientes[0]?.total || 0;

    // Enviadas hoy
    const enviadasHoy = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_gestiones WHERE empresa_id = ? AND estado = 'ENVIADO' AND DATE(fecha_envio) = ?",
      [empresaId, hoy]
    );
    kpis.enviadas_hoy = enviadasHoy[0]?.total || 0;

    // Acuerdos
    const acuerdos = await cobranzasQuery<{ estado: string; total: number }>(
      `SELECT estado, COUNT(*) as total FROM cobranza_acuerdos
       WHERE empresa_id = ? AND estado IN ('PENDIENTE', 'CUMPLIDO', 'INCUMPLIDO')
       AND (estado = 'PENDIENTE' OR updated_at >= ?)
       GROUP BY estado`,
      [empresaId, inicioMes]
    );
    acuerdos.forEach(a => {
      if (a.estado === 'PENDIENTE') kpis.acuerdos_pendientes = a.total;
      if (a.estado === 'CUMPLIDO') kpis.acuerdos_cumplidos_mes = a.total;
      if (a.estado === 'INCUMPLIDO') kpis.acuerdos_incumplidos_mes = a.total;
    });

    // Canales — mensajes del mes
    const canales = await cobranzasQuery<{ canal: string; direccion: string; total: number }>(
      `SELECT canal, direccion, COUNT(*) as total FROM cobranza_conversaciones
       WHERE empresa_id = ? AND created_at >= ?
       GROUP BY canal, direccion`,
      [empresaId, inicioMes]
    );
    canales.forEach(c => {
      if (c.canal === 'WHATSAPP' && c.direccion === 'ENVIADO') kpis.wa_enviados_mes = c.total;
      if (c.canal === 'WHATSAPP' && c.direccion === 'RECIBIDO') kpis.wa_respondidos_mes = c.total;
      if (c.canal === 'EMAIL' && c.direccion === 'ENVIADO') kpis.email_enviados_mes = c.total;
      if (c.canal === 'EMAIL' && c.direccion === 'RECIBIDO') kpis.email_respondidos_mes = c.total;
    });

    // Promesas vencidas
    const promesasVencidas = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) as total FROM cobranza_acuerdos WHERE empresa_id = ? AND estado = 'PENDIENTE' AND fecha_prometida < CURDATE()",
      [empresaId]
    );
    kpis.promesas_vencidas = promesasVencidas[0]?.total || 0;

    try {
      await getRedis().set(cacheKey, JSON.stringify(kpis), 'EX', DASHBOARD_CACHE_TTL_SEG);
    } catch {
      // sin cache, no es fatal
    }

    return NextResponse.json(kpis);
  } catch (error) {
    console.error('[DASHBOARD] Error:', error);
    return NextResponse.json({ error: 'Error calculando KPIs' }, { status: 500 });
  }
}
