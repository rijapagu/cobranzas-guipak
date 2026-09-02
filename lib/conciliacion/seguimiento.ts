import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { testSoftecConnection } from '@/lib/db/softec';
import { enviarMensajeGrupo, enviarMensajePrivado } from '@/lib/telegram/client';
import { esDiaLaborable, fechaAST } from '@/lib/horario';
import { procesarLinea } from './matcher';
import { toYmd } from '@/lib/utils/fechas';
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
       WHERE empresa_id = 1 AND estado = 'DESCONOCIDO' AND archivo_origen = ?
       ORDER BY monto DESC`,
      [stats.archivo]
    );

    for (const d of desconocidas) {
      const ref = `conc-desc-${d.id}`;
      const existe = await cobranzasQuery<{ id: number }>(
        "SELECT id FROM cobranza_tareas WHERE empresa_id = 1 AND origen='CONCILIACION' AND origen_ref = ? LIMIT 1",
        [ref]
      );
      if (existe.length > 0) continue;

      const fmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(d.monto);
      await cobranzasExecute(
        `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, prioridad, creado_por, origen, origen_ref)
         VALUES (1, ?, ?, 'SEGUIMIENTO', ?, 'MEDIA', 'sistema-conciliacion', 'CONCILIACION', ?)`,
        [
          `Depósito ${fmt} sin recibo en Softec`,
          `Banco: ${stats.banco}\nDescripción: ${d.descripcion}\nRef: ${d.referencia || '-'}\nCuenta: ${d.cuenta_origen || '-'}\nFecha banco: ${toYmd(d.fecha_transaccion)}\n\nVerificar si ya se registró el recibo (RC) en Softec. El sistema re-verificará automáticamente.`,
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
       WHERE empresa_id = 1 AND estado = 'CHEQUE_DEVUELTO' AND archivo_origen = ?`,
      [stats.archivo]
    );

    for (const ch of devueltos) {
      const ref = `conc-chdev-${ch.id}`;
      const existe = await cobranzasQuery<{ id: number }>(
        "SELECT id FROM cobranza_tareas WHERE empresa_id = 1 AND origen='CONCILIACION' AND origen_ref = ? LIMIT 1",
        [ref]
      );
      if (existe.length > 0) continue;

      const fmt = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(ch.monto);
      await cobranzasExecute(
        `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, prioridad, creado_por, origen, origen_ref)
         VALUES (1, ?, ?, 'CHEQUE_DEVUELTO', ?, 'ALTA', 'sistema-conciliacion', 'CONCILIACION', ?)`,
        [
          `Cheque devuelto ${fmt}`,
          `Ref: ${ch.referencia || '-'}\nDescripción: ${ch.descripcion}\nFecha: ${toYmd(ch.fecha_transaccion)}\n\nPasos:\n1. Desaplicar pago en Softec\n2. Contactar al cliente para reposición del cheque\n3. Marcar como hecha cuando se resuelva`,
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
     FROM cobranza_conciliacion WHERE empresa_id = 1 AND archivo_origen = ?
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
     WHERE empresa_id = 1 AND estado = 'DESCONOCIDO'
     ORDER BY id`
  );

  if (pendientes.length === 0) return { verificados: 0, resueltos: 0, detalles: [] };

  const resueltos: { id: number; monto: number; cliente: string }[] = [];

  for (const p of pendientes) {
    const linea: LineaExtracto = {
      // toYmd: mysql2 devuelve DATE como objeto Date; String(...) producía
      // "Wed Jun 10" y el DATEDIFF del matcher nunca encontraba nada.
      fecha_transaccion: toYmd(p.fecha_transaccion),
      descripcion: p.descripcion || '',
      referencia: p.referencia || '',
      cuenta_origen: p.cuenta_origen || '',
      monto: Number(p.monto),
      moneda: p.moneda || 'DOP',
    };

    const match = await procesarLinea(linea, 1);

    if (match.estado === 'CONCILIADO') {
      await cobranzasExecute(
        `UPDATE cobranza_conciliacion
         SET estado = 'CONCILIADO', ir_recnum = ?, codigo_cliente = ?, updated_at = NOW()
         WHERE id = ? AND empresa_id = 1`,
        [match.ir_recnum, match.codigo_cliente, p.id]
      );

      if (match.es_multi && match.detalles) {
        for (const det of match.detalles) {
          await cobranzasExecute(
            `INSERT INTO cobranza_conciliacion_detalle
               (empresa_id, conciliacion_id, ir_recnum, codigo_cliente, nombre_cliente, monto)
             VALUES (1, ?, ?, ?, ?, ?)`,
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
         WHERE empresa_id = 1 AND origen = 'CONCILIACION' AND origen_ref = ? AND estado != 'HECHA'`,
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
     WHERE empresa_id = 1 AND tipo = 'CHEQUE_DEVUELTO' AND origen = 'CONCILIACION' AND estado IN ('PENDIENTE', 'EN_PROGRESO')
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

/**
 * Le pide el extracto bancario al administrador si hoy todavía no ha llegado.
 *
 * La conciliación es la primera responsabilidad del asistente de cobros —antes
 * que cobrar—, pero no puede empezarla solo: el extracto lo baja una persona
 * del banco. Esto cierra ese hueco pidiéndolo, en vez de esperar callado.
 *
 * Va al chat PRIVADO del administrador, no al grupo: responderle adjuntando el
 * fichero ahí es lo natural, y el webhook ya sabe recibirlo
 * (`manejarDocumento`). Se calla en fin de semana y se calla si hoy ya se cargó
 * alguno — no hay estado que mantener, la propia tabla de conciliación es el
 * registro de si llegó.
 */
export async function pedirExtractoSiFalta(): Promise<{
  pedido: boolean;
  motivo: string;
  dias?: number;
}> {
  if (!esDiaLaborable()) return { pedido: false, motivo: 'fin de semana' };

  const filas = await cobranzasQuery<{ ultima: string | null }>(
    'SELECT MAX(created_at) AS ultima FROM cobranza_conciliacion WHERE empresa_id = 1'
  );
  const ultimaRaw = filas[0]?.ultima;
  const hoy = fechaAST();

  let dias = 0;
  if (ultimaRaw) {
    const ultima = new Date(ultimaRaw);
    if (fechaAST(ultima) === hoy) {
      return { pedido: false, motivo: 'ya se cargó un extracto hoy' };
    }
    dias = Math.max(
      1,
      Math.round((Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${fechaAST(ultima)}T12:00:00Z`)) / 86400000)
    );
  }

  // A quién: el ADMIN activo con Telegram vinculado. Se busca por el rol de la
  // APP y no por el del chat, porque el del chat es derivado y no distingue
  // ADMIN de SUPERVISOR.
  const destinatarios = await cobranzasQuery<{ telegram_user_id: number; nombre: string }>(
    `SELECT t.telegram_user_id, u.nombre
     FROM cobranza_telegram_usuarios t
     JOIN usuarios u ON u.id = t.usuario_id AND u.empresa_id = t.empresa_id
     WHERE t.empresa_id = 1 AND t.activo = 1 AND u.activo = 1 AND u.rol = 'ADMIN'`
  );
  if (destinatarios.length === 0) {
    return { pedido: false, motivo: 'ningún ADMIN con Telegram vinculado' };
  }

  const cuantoLlevamos =
    dias === 0
      ? 'Todavía no tengo ningún extracto cargado.'
      : dias === 1
        ? 'El último que cargamos fue ayer.'
        : `Llevamos <b>${dias} días</b> sin cargar ninguno.`;

  const msg =
    `🏦 <b>¿Me pasas el extracto del banco?</b>\n\n` +
    `${cuantoLlevamos}\n\n` +
    `Mándamelo por aquí en <b>Excel</b> o <b>CSV</b> y lo concilio en el momento: ` +
    `te digo cuántos depósitos casaron solos, cuáles quedan por aplicar y cuáles ` +
    `no tienen dueño. Si viene algún cheque devuelto, te aviso aparte.\n\n` +
    `<i>Puedes escribir el banco en el pie del adjunto (ej.: BHD).</i>`;

  let enviados = 0;
  for (const d of destinatarios) {
    if (await enviarMensajePrivado(d.telegram_user_id, msg)) enviados++;
  }

  if (enviados === 0) {
    // Falla si esa persona nunca le dio a Iniciar al bot: sin eso Telegram no
    // deja que el bot escriba primero.
    return { pedido: false, motivo: 'no se pudo entregar a ningún ADMIN' };
  }

  await logAccion('sistema', 'EXTRACTO_SOLICITADO', 'conciliacion', '0', {
    destinatarios: enviados,
    dias_sin_extracto: dias,
  });

  return { pedido: true, motivo: `pedido a ${enviados} administrador(es)`, dias };
}
