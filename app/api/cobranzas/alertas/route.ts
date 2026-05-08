import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';

interface Alerta {
  tipo: 'PROMESA_VENCIDA' | 'FACTURA_SIN_GESTION' | 'PAGO_SIN_REGISTRAR' | 'ESCALADO' | 'CLIENTE_NUEVO_MORA';
  prioridad: 'alta' | 'media' | 'baja';
  titulo: string;
  detalle: string;
  entidad_id?: string;
  codigo_cliente?: string;
  fecha: string;
}

/**
 * GET /api/cobranzas/alertas
 * Genera alertas internas basadas en el estado actual del sistema.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const alertas: Alerta[] = [];

    // 1. Promesas de pago vencidas sin cumplir
    const promesasVencidas = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
      ij_inum: number;
      monto_prometido: number;
      fecha_prometida: string;
    }>(
      "SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida FROM cobranza_acuerdos WHERE estado = 'PENDIENTE' AND fecha_prometida < CURDATE() ORDER BY fecha_prometida ASC"
    );

    promesasVencidas.forEach(p => {
      const diasVencida = Math.floor((Date.now() - new Date(p.fecha_prometida).getTime()) / 86400000);
      alertas.push({
        tipo: 'PROMESA_VENCIDA',
        prioridad: diasVencida > 7 ? 'alta' : 'media',
        titulo: `Promesa vencida: Cliente ${p.codigo_cliente}`,
        detalle: `Factura #${p.ij_inum} — Prometió RD$${p.monto_prometido.toLocaleString()} para el ${new Date(p.fecha_prometida).toLocaleDateString('es-DO')}. ${diasVencida} días de retraso.`,
        entidad_id: p.id.toString(),
        codigo_cliente: p.codigo_cliente,
        fecha: p.fecha_prometida,
      });
    });

    // 2. Gestiones escaladas pendientes
    const escaladas = await cobranzasQuery<{
      id: number;
      codigo_cliente: string;
      ij_inum: number;
      saldo_pendiente: number;
      created_at: string;
    }>(
      "SELECT id, codigo_cliente, ij_inum, saldo_pendiente, created_at FROM cobranza_gestiones WHERE estado = 'ESCALADO' ORDER BY created_at DESC LIMIT 20"
    );

    escaladas.forEach(e => {
      alertas.push({
        tipo: 'ESCALADO',
        prioridad: 'alta',
        titulo: `Gestión escalada: Cliente ${e.codigo_cliente}`,
        detalle: `Factura #${e.ij_inum} — Saldo RD$${e.saldo_pendiente.toLocaleString()}. Requiere intervención gerencial.`,
        entidad_id: e.id.toString(),
        codigo_cliente: e.codigo_cliente,
        fecha: e.created_at,
      });
    });

    // 3. Pagos en conciliación sin registrar (POR_APLICAR)
    const pagosNoAplicados = await cobranzasQuery<{
      id: number;
      monto: number;
      fecha_transaccion: string;
      cuenta_origen: string;
      codigo_cliente: string | null;
    }>(
      "SELECT id, monto, fecha_transaccion, cuenta_origen, codigo_cliente FROM cobranza_conciliacion WHERE estado = 'POR_APLICAR' ORDER BY fecha_transaccion DESC LIMIT 10"
    );

    pagosNoAplicados.forEach(p => {
      alertas.push({
        tipo: 'PAGO_SIN_REGISTRAR',
        prioridad: 'media',
        titulo: `Pago por aplicar: RD$${p.monto.toLocaleString()}`,
        detalle: `Cuenta: ${p.cuenta_origen || 'Desconocida'}. Cliente: ${p.codigo_cliente || 'Sin asignar'}. Fecha: ${new Date(p.fecha_transaccion).toLocaleDateString('es-DO')}.`,
        entidad_id: p.id.toString(),
        fecha: p.fecha_transaccion,
      });
    });

    // 4. Facturas con 30+ días sin gestión (solo si Softec conectado)
    const softecOk = await testSoftecConnection();
    if (softecOk) {
      const sinGestion = await softecQuery<{
        codigo_cliente: string;
        nombre_cliente: string;
        facturas: number;
        saldo: number;
        max_dias: number;
      }>(`
        SELECT
          f.IJ_CCODE AS codigo_cliente,
          c.IC_NAME AS nombre_cliente,
          COUNT(*) AS facturas,
          SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo,
          MAX(DATEDIFF(CURDATE(), f.IJ_DUEDATE)) AS max_dias
        FROM v_cobr_ijnl f
        INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
        WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
          AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
          AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30
        GROUP BY f.IJ_CCODE, c.IC_NAME
        HAVING facturas >= 3
        ORDER BY saldo DESC
        LIMIT 10
      `);

      sinGestion.forEach(s => {
        alertas.push({
          tipo: 'FACTURA_SIN_GESTION',
          prioridad: s.max_dias > 60 ? 'alta' : 'media',
          titulo: `${s.nombre_cliente}: ${s.facturas} facturas 30+ días`,
          detalle: `Saldo total: RD$${s.saldo.toLocaleString()}. Factura más antigua: ${s.max_dias} días vencida.`,
          codigo_cliente: s.codigo_cliente,
          fecha: new Date().toISOString(),
        });
      });
    }

    // Ordenar por prioridad
    const prioridadOrden = { alta: 0, media: 1, baja: 2 };
    alertas.sort((a, b) => prioridadOrden[a.prioridad] - prioridadOrden[b.prioridad]);

    return NextResponse.json({
      alertas,
      total: alertas.length,
      resumen: {
        alta: alertas.filter(a => a.prioridad === 'alta').length,
        media: alertas.filter(a => a.prioridad === 'media').length,
        baja: alertas.filter(a => a.prioridad === 'baja').length,
      },
    });
  } catch (error) {
    console.error('[ALERTAS] Error:', error);
    return NextResponse.json({ error: 'Error generando alertas' }, { status: 500 });
  }
}
