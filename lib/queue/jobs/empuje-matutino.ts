import { enviarMensajeGrupo } from '@/lib/telegram/client';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';

interface SegmentoData {
  segmento: string;
  num_facturas: number;
  num_clientes: number;
  saldo_total: number;
}

interface ResumenCartera {
  cartera_total: number;
  total_facturas: number;
  total_clientes: number;
  por_segmento: Record<'VERDE' | 'AMARILLO' | 'NARANJA' | 'ROJO', number>;
}

interface ResumenAlertas {
  promesas_vencidas: number;
  pendientes_aprobacion: number;
  pagos_sin_registrar: number;
  enviadas_hoy: number;
  acuerdos_vencen_hoy: number;
}

async function obtenerResumenCartera(): Promise<ResumenCartera | null> {
  try {
    const softecOk = await testSoftecConnection();
    if (!softecOk) return null;

    const segmentos = await softecQuery<SegmentoData>(`
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
      FROM ijnl f
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY segmento
    `);

    const resumen: ResumenCartera = {
      cartera_total: 0,
      total_facturas: 0,
      total_clientes: 0,
      por_segmento: { VERDE: 0, AMARILLO: 0, NARANJA: 0, ROJO: 0 },
    };

    const clientesUnicos = new Set<string>();
    for (const s of segmentos) {
      const seg = s.segmento as keyof ResumenCartera['por_segmento'];
      const facturas = Number(s.num_facturas);
      const saldo = Number(s.saldo_total);
      resumen.por_segmento[seg] = facturas;
      resumen.total_facturas += facturas;
      resumen.cartera_total += saldo;
      clientesUnicos.add(seg + ':' + s.num_clientes);
    }

    const totalClientes = await softecQuery<{ total: number }>(`
      SELECT COUNT(DISTINCT f.IJ_CCODE) AS total
      FROM ijnl f
      WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
        AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    `);
    resumen.total_clientes = Number(totalClientes[0]?.total) || 0;

    return resumen;
  } catch (error) {
    console.error('[empuje-matutino] Error obteniendo cartera:', error);
    return null;
  }
}

async function obtenerAlertas(): Promise<ResumenAlertas> {
  const resumen: ResumenAlertas = {
    promesas_vencidas: 0,
    pendientes_aprobacion: 0,
    pagos_sin_registrar: 0,
    enviadas_hoy: 0,
    acuerdos_vencen_hoy: 0,
  };

  try {
    const promesas = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado = 'PENDIENTE' AND fecha_prometida < CURDATE()"
    );
    resumen.promesas_vencidas = Number(promesas[0]?.total) || 0;

    const pendientes = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE estado = 'PENDIENTE'"
    );
    resumen.pendientes_aprobacion = Number(pendientes[0]?.total) || 0;

    const pagos = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) AS total FROM cobranza_conciliacion WHERE estado = 'POR_APLICAR'"
    );
    resumen.pagos_sin_registrar = Number(pagos[0]?.total) || 0;

    const enviadas = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE estado = 'ENVIADO' AND DATE(fecha_envio) = CURDATE() - INTERVAL 1 DAY"
    );
    resumen.enviadas_hoy = Number(enviadas[0]?.total) || 0;

    const venceHoy = await cobranzasQuery<{ total: number }>(
      "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado = 'PENDIENTE' AND fecha_prometida = CURDATE()"
    );
    resumen.acuerdos_vencen_hoy = Number(venceHoy[0]?.total) || 0;
  } catch (error) {
    console.error('[empuje-matutino] Error obteniendo alertas:', error);
  }

  return resumen;
}

interface TareasResumen {
  hoy: { id: number; titulo: string; hora: string | null }[];
  atrasadas: { id: number; titulo: string; fecha: string }[];
}

async function obtenerTareas(): Promise<TareasResumen> {
  const resumen: TareasResumen = { hoy: [], atrasadas: [] };
  try {
    const hoy = await cobranzasQuery<{
      id: number;
      titulo: string;
      hora: string | null;
    }>(
      `SELECT id, titulo, hora
         FROM cobranza_tareas
        WHERE estado IN ('PENDIENTE','EN_PROGRESO')
          AND fecha_vencimiento = CURDATE()
        ORDER BY hora IS NULL, hora ASC, prioridad DESC, id ASC
        LIMIT 20`
    );
    resumen.hoy = hoy.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      hora: t.hora ? t.hora.slice(0, 5) : null,
    }));

    const atrasadas = await cobranzasQuery<{
      id: number;
      titulo: string;
      fecha_vencimiento: string;
    }>(
      `SELECT id, titulo, fecha_vencimiento
         FROM cobranza_tareas
        WHERE estado IN ('PENDIENTE','EN_PROGRESO')
          AND fecha_vencimiento < CURDATE()
        ORDER BY fecha_vencimiento ASC, id ASC
        LIMIT 10`
    );
    resumen.atrasadas = atrasadas.map((t) => ({
      id: t.id,
      titulo: t.titulo,
      fecha:
        typeof t.fecha_vencimiento === 'string'
          ? t.fecha_vencimiento.slice(0, 10)
          : new Date(t.fecha_vencimiento).toISOString().split('T')[0],
    }));
  } catch (error) {
    console.error('[empuje-matutino] Error obteniendo tareas:', error);
  }
  return resumen;
}

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(monto);
}

export async function ejecutarEmpujeMatutino(): Promise<void> {
  const [cartera, alertas, tareas] = await Promise.all([
    obtenerResumenCartera(),
    obtenerAlertas(),
    obtenerTareas(),
  ]);

  const hoy = new Date().toLocaleDateString('es-DO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Santo_Domingo',
  });

  let mensaje = `📊 <b>Resumen de Cobranzas</b>\n<i>${hoy}</i>\n\n`;

  if (cartera) {
    mensaje += `💰 <b>Cartera vencida:</b> ${formatMonto(cartera.cartera_total)}\n`;
    mensaje += `📄 ${cartera.total_facturas} facturas · 👥 ${cartera.total_clientes} clientes\n\n`;
    mensaje += `<b>Por segmento:</b>\n`;
    mensaje += `🟢 Verde (vence pronto): ${cartera.por_segmento.VERDE}\n`;
    mensaje += `🟡 Amarillo (1-15 días): ${cartera.por_segmento.AMARILLO}\n`;
    mensaje += `🟠 Naranja (16-30 días): ${cartera.por_segmento.NARANJA}\n`;
    mensaje += `🔴 Rojo (30+ días): ${cartera.por_segmento.ROJO}\n\n`;
  } else {
    mensaje += `⚠️ No se pudo conectar con Softec.\n\n`;
  }

  const totalAlertas =
    alertas.promesas_vencidas +
    alertas.pendientes_aprobacion +
    alertas.pagos_sin_registrar;

  if (totalAlertas > 0 || alertas.acuerdos_vencen_hoy > 0) {
    mensaje += `🚨 <b>Acciones del día:</b>\n`;
    if (alertas.pendientes_aprobacion > 0)
      mensaje += `• ${alertas.pendientes_aprobacion} mensajes esperando aprobación\n`;
    if (alertas.acuerdos_vencen_hoy > 0)
      mensaje += `• ${alertas.acuerdos_vencen_hoy} promesas de pago vencen hoy\n`;
    if (alertas.promesas_vencidas > 0)
      mensaje += `• ${alertas.promesas_vencidas} promesas vencidas sin cobrar\n`;
    if (alertas.pagos_sin_registrar > 0)
      mensaje += `• ${alertas.pagos_sin_registrar} pagos bancarios por aplicar\n`;
    mensaje += `\n`;
  } else {
    mensaje += `✅ Sin alertas activas\n\n`;
  }

  if (alertas.enviadas_hoy > 0) {
    mensaje += `📤 Ayer se enviaron ${alertas.enviadas_hoy} mensajes\n\n`;
  }

  if (tareas.hoy.length > 0) {
    mensaje += `📋 <b>Tus tareas hoy (${tareas.hoy.length}):</b>\n`;
    for (const t of tareas.hoy.slice(0, 8)) {
      mensaje += t.hora ? `• ${t.hora} — ${t.titulo}\n` : `• ${t.titulo}\n`;
    }
    if (tareas.hoy.length > 8) {
      mensaje += `• <i>+${tareas.hoy.length - 8} más</i>\n`;
    }
    mensaje += `\n`;
  }

  if (tareas.atrasadas.length > 0) {
    mensaje += `⏰ <b>Atrasadas (${tareas.atrasadas.length}):</b>\n`;
    for (const t of tareas.atrasadas.slice(0, 5)) {
      mensaje += `• ${t.titulo} <i>(vencía ${t.fecha})</i>\n`;
    }
    if (tareas.atrasadas.length > 5) {
      mensaje += `• <i>+${tareas.atrasadas.length - 5} más</i>\n`;
    }
    mensaje += `\n`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cobros.sguipak.com';
  mensaje += `🔗 <a href="${appUrl}">Abrir sistema de cobranzas</a>`;

  await enviarMensajeGrupo(mensaje);
}
