import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { testSoftecConnection } from '@/lib/db/softec';
import { enviarMensajeGrupo } from '@/lib/telegram/client';
import { procesarLinea } from './matcher';
import type { LineaExtracto } from '@/lib/types/conciliacion';

interface ConciliacionPendiente {
  id: number;
  fecha_transaccion: string;
  descripcion: string;
  monto: number;
  moneda: string;
  referencia: string | null;
  cuenta_origen: string | null;
  estado: string;
  archivo_origen: string;
}

export async function crearTareasConciliacion(stats: {
  conciliadas: number;
  por_aplicar: number;
  desconocidas: number;
  cheques_devueltos: number;
  monto_conciliado: number;
  monto_desconocido: number;
  monto_devuelto: number;
  multi_recibo: number;
  archivo: string;
  banco: string;
}): Promise<number> {
  let tareasCreadas = 0;
  const hoy = new Date().toISOString().split('T')[0];

  // Tareas para DESCONOCIDO
  if (stats.desconocidas > 0) {
    const desconocidas = await cobranzasQuery<ConciliacionPendiente>(
      `SELECT id, fecha_transaccion, descripcion, monto, moneda, referencia, cuenta_origen, estado, archivo_origen
       FROM cobranza_conciliacion
       WHERE estado = 'DESCONOCIDO' AND archivo_origen = ?
       ORDER BY monto DESC`,
      [stats.archivo]
    );

    for (const d of desconocidas) {
      const ref = `conc-desc-${d.id}`;
      const existe = await cobranzasQuery<{ id: number }>(
        "SELECT id FROM cobranza_tareas WHERE origen='CONCILIACION' AND origen_ref = ? LIMIT 1",
        [ref]
      );
      if (existe.length > 0) continue;

      const fmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(d.monto);
      await cobranzasExecute(
        `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, prioridad, creado_por, origen, origen_ref)
         VALUES (?, ?, 'SEGUIMIENTO', ?, 'MEDIA', 'sistema-conciliacion', 'CONCILIACION', ?)`,
        [
          `Depósito ${fmt} sin recibo en Softec`,
          `Banco: ${stats.banco}\nDescripción: ${d.descripcion}\nRef: ${d.referencia || '-'}\nCuenta: ${d.cuenta_origen || '-'}\nFecha banco: ${d.fecha_transaccion}\n\nVerificar si ya se registró el recibo (RC) en Softec. El sistema re-verificará automáticamente.`,
          hoy,
          ref,
        ]
      );
      tareasCreadas++;
    }
  }

  // Tareas para CHEQUE_DEVUELTO
  if (stats.cheques_devueltos > 0) {
    const devueltos = await cobranzasQuery<ConciliacionPendiente>(
      `SELECT id, fecha_transaccion, descripcion, monto, moneda, referencia, estado, archivo_origen
       FROM cobranza_conciliacion
       WHERE estado = 'CHEQUE_DEVUELTO' AND archivo_origen = ?`,
      [stats.archivo]
    );

    for (const ch of devueltos) {
      const ref = `conc-chdev-${ch.id}`;
      const existe = await cobranzasQuery<{ id: number }>(
        "SELECT id FROM cobranza_tareas WHERE origen='CONCILIACION' AND origen_ref = ? LIMIT 1",
        [ref]
      );
      if (existe.length > 0) continue;

      const fmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(ch.monto);
      await cobranzasExecute(
        `INSERT INTO cobranza_tareas
         (titulo, descripcion, tipo, fecha_vencimiento, prioridad, creado_por, origen, origen_ref)
         VALUES (?, ?, 'CHEQUE_DEVUELTO', ?, 'ALTA', 'sistema-conciliacion', 'CONCILIACION', ?)`,
        [
          `Cheque devuelto ${fmt}`,
          `Ref: ${ch.referencia || '-'}\nDescripción: ${ch.descripcion}\nFecha: ${ch.fecha_transaccion}\n\nPasos:\n1. Desaplicar pago en Softec\n2. Contactar al cliente para reposición del cheque\n3. Marcar como hecha cuando se resuelva`,
          hoy,
          ref,
        ]
      );
      tareasCreadas++;
    }
  }

  return tareasCreadas;
}

export async function notificarConciliacionDesdeBD(
  archivo: string,
  banco: string,
  multiRecibo: number,
  tareasCreadas: number
): Promise<void> {
  const rows = await cobranzasQuery<{ estado: string; total: number; cantidad: number }>(
    `SELECT estado, SUM(monto) as total, COUNT(*) as cantidad
     FROM cobranza_conciliacion WHERE archivo_origen = ?
     GROUP BY estado`,
    [archivo]
  );

  const byEstado = (e: string) => rows.find(r => r.estado === e);
  const conc = byEstado('CONCILIADO');
  const pa = byEstado('POR_APLICAR');
  const desc = byEstado('DESCONOCIDO');
  const chdev = byEstado('CHEQUE_DEVUELTO');

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(n);

  let msg = `📊 <b>Extracto cargado: ${banco}</b>\n`;
  msg += `📁 ${archivo}\n\n`;

  if (conc) {
    msg += `✅ ${conc.cantidad} conciliadas — ${fmt(Number(conc.total))}\n`;
    if (multiRecibo > 0) {
      msg += `   ↳ ${multiRecibo} con múltiples recibos (libramientos)\n`;
    }
  }
  if (pa) msg += `⏳ ${pa.cantidad} por aplicar — ${fmt(Number(pa.total))}\n`;
  if (desc) msg += `❓ ${desc.cantidad} desconocidas — ${fmt(Number(desc.total))}\n`;
  if (chdev) msg += `⚠️ ${chdev.cantidad} cheques devueltos — ${fmt(Number(chdev.total))}\n`;

  if (tareasCreadas > 0) {
    msg += `\n📋 Se crearon <b>${tareasCreadas} tareas</b> de seguimiento.`;
    if (desc) {
      msg += `\nEl sistema re-verificará los desconocidos periódicamente.`;
    }
  }

  try {
    await enviarMensajeGrupo(msg);
  } catch (error) {
    console.error('[CONCILIACION-TELEGRAM] Error enviando notificación:', error);
  }
}

export async function verificarDesconocidos(): Promise<{
  verificados: number;
  resueltos: number;
  detalles: { id: number; monto: number; cliente: string }[];
}> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { verificados: 0, resueltos: 0, detalles: [] };

  const pendientes = await cobranzasQuery<ConciliacionPendiente>(
    `SELECT id, fecha_transaccion, descripcion, monto, moneda, referencia, cuenta_origen, estado, archivo_origen
     FROM cobranza_conciliacion
     WHERE estado = 'DESCONOCIDO'
     ORDER BY id`
  );

  if (pendientes.length === 0) return { verificados: 0, resueltos: 0, detalles: [] };

  const resueltos: { id: number; monto: number; cliente: string }[] = [];

  for (const p of pendientes) {
    const linea: LineaExtracto = {
      fecha_transaccion: String(p.fecha_transaccion).substring(0, 10),
      descripcion: p.descripcion || '',
      referencia: p.referencia || '',
      cuenta_origen: p.cuenta_origen || '',
      monto: Number(p.monto),
      moneda: p.moneda || 'DOP',
    };

    const match = await procesarLinea(linea);

    if (match.estado === 'CONCILIADO') {
      await cobranzasExecute(
        `UPDATE cobranza_conciliacion
         SET estado = 'CONCILIADO', ir_recnum = ?, codigo_cliente = ?, updated_at = NOW()
         WHERE id = ?`,
        [match.ir_recnum, match.codigo_cliente, p.id]
      );

      if (match.es_multi && match.detalles) {
        for (const det of match.detalles) {
          await cobranzasExecute(
            `INSERT INTO cobranza_conciliacion_detalle
               (conciliacion_id, ir_recnum, codigo_cliente, nombre_cliente, monto)
             VALUES (?, ?, ?, ?, ?)`,
            [p.id, det.ir_recnum, det.codigo_cliente, det.nombre_cliente, det.monto]
          );
        }
      }

      // Cerrar la tarea asociada
      const ref = `conc-desc-${p.id}`;
      await cobranzasExecute(
        `UPDATE cobranza_tareas
         SET estado = 'HECHA', completada_at = NOW(), completada_por = 'sistema-conciliacion',
             notas_completado = 'Auto-conciliado: recibo encontrado en Softec'
         WHERE origen = 'CONCILIACION' AND origen_ref = ? AND estado != 'HECHA'`,
        [ref]
      );

      resueltos.push({
        id: p.id,
        monto: Number(p.monto),
        cliente: match.codigo_cliente || (match.detalles?.map(d => d.codigo_cliente).join(', ') || '?'),
      });
    }
  }

  if (resueltos.length > 0) {
    const fmt = (n: number) =>
      new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(n);

    let msg = `🔄 <b>Seguimiento conciliación</b>\n\n`;
    msg += `${resueltos.length} transacción(es) auto-conciliada(s):\n`;
    for (const r of resueltos.slice(0, 10)) {
      msg += `  ✅ ${fmt(r.monto)} → cliente ${r.cliente}\n`;
    }
    if (resueltos.length > 10) {
      msg += `  ... y ${resueltos.length - 10} más\n`;
    }
    msg += `\nQuedan ${pendientes.length - resueltos.length} desconocida(s) pendientes.`;

    try {
      await enviarMensajeGrupo(msg);
    } catch (error) {
      console.error('[CONCILIACION-SEGUIMIENTO] Error notificando:', error);
    }

    await logAccion('sistema', 'CONCILIACION_AUTO_RESUELTA', 'conciliacion', '0', {
      resueltos: resueltos.length,
      total_pendientes: pendientes.length,
    });
  }

  return {
    verificados: pendientes.length,
    resueltos: resueltos.length,
    detalles: resueltos,
  };
}

export async function recordatorioChequesDevueltos(): Promise<number> {
  const pendientes = await cobranzasQuery<{
    id: number;
    titulo: string;
    descripcion: string;
    fecha_vencimiento: string;
    created_at: string;
  }>(
    `SELECT id, titulo, descripcion, fecha_vencimiento, created_at
     FROM cobranza_tareas
     WHERE tipo = 'CHEQUE_DEVUELTO' AND origen = 'CONCILIACION' AND estado IN ('PENDIENTE', 'EN_PROGRESO')
     ORDER BY created_at`
  );

  if (pendientes.length === 0) return 0;

  const hoy = new Date();
  const viejos = pendientes.filter(t => {
    const creado = new Date(t.created_at);
    const dias = Math.floor((hoy.getTime() - creado.getTime()) / (1000 * 60 * 60 * 24));
    return dias >= 3 && dias % 3 === 0; // recordar cada 3 días
  });

  if (viejos.length === 0) return 0;

  let msg = `⚠️ <b>Cheques devueltos sin resolver</b>\n\n`;
  for (const t of viejos) {
    const creado = new Date(t.created_at);
    const dias = Math.floor((hoy.getTime() - creado.getTime()) / (1000 * 60 * 60 * 24));
    msg += `• ${t.titulo} — ${dias} días sin resolver\n`;
  }
  msg += `\nTotal pendientes: ${pendientes.length}`;

  try {
    await enviarMensajeGrupo(msg);
  } catch (error) {
    console.error('[CONCILIACION-CHEQUES] Error recordatorio:', error);
  }

  return viejos.length;
}
