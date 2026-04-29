import { enviarMensajeGrupo } from '@/lib/telegram/client';

interface DashboardData {
  cartera_total: number;
  total_facturas: number;
  total_clientes: number;
  por_segmento: { VERDE: number; AMARILLO: number; NARANJA: number; ROJO: number };
}

interface AlertasData {
  promesas_vencidas: number;
  pendientes_aprobacion: number;
  pagos_sin_registrar: number;
  sin_gestion_30dias: number;
}

async function fetchDashboard(): Promise<DashboardData | null> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/api/cobranzas/dashboard`, {
      headers: { 'x-internal-secret': process.env.INTERNAL_CRON_SECRET || '' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchAlertas(): Promise<AlertasData | null> {
  try {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/api/cobranzas/alertas`, {
      headers: { 'x-internal-secret': process.env.INTERNAL_CRON_SECRET || '' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      promesas_vencidas: data.filter((a: { tipo: string }) => a.tipo === 'PROMESA_VENCIDA').length,
      pendientes_aprobacion: data.filter((a: { tipo: string }) => a.tipo === 'PENDIENTE_APROBACION').length,
      pagos_sin_registrar: data.filter((a: { tipo: string }) => a.tipo === 'PAGO_SIN_REGISTRAR').length,
      sin_gestion_30dias: data.filter((a: { tipo: string }) => a.tipo === 'SIN_GESTION_30_DIAS').length,
    };
  } catch {
    return null;
  }
}

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    maximumFractionDigits: 0,
  }).format(monto);
}

export async function ejecutarEmpujeMatutino(): Promise<void> {
  const [dashboard, alertas] = await Promise.all([fetchDashboard(), fetchAlertas()]);

  const hoy = new Date().toLocaleDateString('es-DO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Santo_Domingo',
  });

  let mensaje = `📊 <b>Resumen de Cobranzas — ${hoy}</b>\n\n`;

  if (dashboard) {
    mensaje += `💰 <b>Cartera vencida:</b> ${formatMonto(dashboard.cartera_total)}\n`;
    mensaje += `📄 <b>Facturas:</b> ${dashboard.total_facturas} | <b>Clientes:</b> ${dashboard.total_clientes}\n\n`;
    mensaje += `<b>Por segmento:</b>\n`;
    mensaje += `🟢 Verde: ${dashboard.por_segmento.VERDE}\n`;
    mensaje += `🟡 Amarillo: ${dashboard.por_segmento.AMARILLO}\n`;
    mensaje += `🟠 Naranja: ${dashboard.por_segmento.NARANJA}\n`;
    mensaje += `🔴 Rojo: ${dashboard.por_segmento.ROJO}\n\n`;
  } else {
    mensaje += `⚠️ No se pudieron cargar datos de cartera.\n\n`;
  }

  if (alertas) {
    const totalAlertas =
      alertas.promesas_vencidas +
      alertas.pendientes_aprobacion +
      alertas.pagos_sin_registrar +
      alertas.sin_gestion_30dias;

    if (totalAlertas > 0) {
      mensaje += `🚨 <b>Alertas (${totalAlertas}):</b>\n`;
      if (alertas.promesas_vencidas > 0)
        mensaje += `• ${alertas.promesas_vencidas} promesas vencidas sin cobrar\n`;
      if (alertas.pendientes_aprobacion > 0)
        mensaje += `• ${alertas.pendientes_aprobacion} mensajes pendientes de aprobación\n`;
      if (alertas.pagos_sin_registrar > 0)
        mensaje += `• ${alertas.pagos_sin_registrar} pagos bancarios sin registrar\n`;
      if (alertas.sin_gestion_30dias > 0)
        mensaje += `• ${alertas.sin_gestion_30dias} clientes sin gestión 30+ días\n`;
    } else {
      mensaje += `✅ Sin alertas activas\n`;
    }
  }

  mensaje += `\n🔗 <a href="${process.env.NEXT_PUBLIC_APP_URL}">Abrir sistema de cobranzas</a>`;

  await enviarMensajeGrupo(mensaje);
}
