import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { testSoftecConnection } from '@/lib/db/softec';
import { enviarMensajeGrupo, enviarMensajePrivado } from '@/lib/telegram/client';
import { esDiaLaborable, fechaAST } from '@/lib/horario';
import { procesarLinea } from './matcher';
import { toYmd, addDiasYmd } from '@/lib/utils/fechas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { ultimoExtracto, listarDepositosPendientes } from './acciones';
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

const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function nombreDiaEnEspanol(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return `${DIAS_ES[dow]} ${d} ${MESES_ES[(m || 1) - 1]}`;
}

/** El día hábil más reciente ANTES de `hoy` (retrocede sábados/domingos). */
function diaHabilAnterior(hoy: string): string {
  let candidato = addDiasYmd(hoy, -1);
  while (!esDiaLaborable(new Date(`${candidato}T12:00:00Z`))) {
    candidato = addDiasYmd(candidato, -1);
  }
  return candidato;
}

/**
 * Le pide el extracto bancario al GRUPO si aún no ha llegado.
 *
 * La conciliación es la primera responsabilidad del asistente de cobros —antes
 * que cobrar—, pero no puede empezarla solo: el extracto lo baja una persona
 * del banco. Esto cierra ese hueco pidiéndolo, en vez de esperar callado.
 *
 * Al GRUPO, no al privado del ADMIN (cambiado 2026-09-03): así Daria también
 * puede subirlo si Ricardo no está, y el ciclo completo (pedir → cargar →
 * listar sin dueño → asignar → aprobar) vive en un solo chat en vez de partido
 * entre el privado del ADMIN y el grupo. Si el envío al grupo falla, cae al
 * privado de cada ADMIN vinculado (comportamiento anterior, ahora solo de
 * respaldo).
 *
 * `modo:'peticion'` es el aviso de la mañana; `modo:'recordatorio'` es el
 * empujón de media mañana si para entonces sigue sin llegar — mismo chequeo
 * de "¿falta?", texto más corto y sin repetir el "cuánto llevamos".
 *
 * "Falta" ya no es solo "¿se cargó algo hoy?": también cuenta si YA hay
 * movimientos del último día hábil registrados (aunque se hayan cargado en
 * otro momento) — evita pedir de nuevo si ayer por la tarde ya se cubrió el
 * día. Se calla en fin de semana. No hay estado propio que mantener: la
 * propia tabla de conciliación es el registro de si llegó.
 */
export async function pedirExtractoSiFalta(
  modo: 'peticion' | 'recordatorio' = 'peticion'
): Promise<{ pedido: boolean; motivo: string; dias?: number }> {
  if (!esDiaLaborable()) return { pedido: false, motivo: 'fin de semana' };

  const filas = await cobranzasQuery<{ ultima_carga: string | null; ultima_transaccion: string | null }>(
    'SELECT MAX(created_at) AS ultima_carga, MAX(fecha_transaccion) AS ultima_transaccion FROM cobranza_conciliacion WHERE empresa_id = 1'
  );
  const fila = filas[0];
  const hoy = fechaAST();

  if (fila?.ultima_carga && fechaAST(new Date(fila.ultima_carga)) === hoy) {
    return { pedido: false, motivo: 'ya se cargó un extracto hoy' };
  }

  const diaEsperado = diaHabilAnterior(hoy);
  if (fila?.ultima_transaccion && toYmd(fila.ultima_transaccion) >= diaEsperado) {
    return { pedido: false, motivo: `ya hay movimientos de ${diaEsperado} o después registrados` };
  }

  const dias = fila?.ultima_carga
    ? Math.max(
        1,
        Math.round(
          (Date.parse(`${hoy}T12:00:00Z`) - Date.parse(`${fechaAST(new Date(fila.ultima_carga))}T12:00:00Z`)) /
            86400000
        )
      )
    : 0;

  const nombreDia = nombreDiaEnEspanol(diaEsperado);
  const cuantoLlevamos =
    dias === 0
      ? 'Todavía no tengo ningún extracto cargado.'
      : dias === 1
        ? 'El último que cargamos fue ayer.'
        : `Llevamos <b>${dias} días</b> sin cargar ninguno.`;

  const msg =
    modo === 'recordatorio'
      ? `🏦 ¿Alguien tiene a mano el extracto de <b>${nombreDia}</b>? Todavía no me ha llegado.\n\n` +
        `Respondan a este mensaje con el Excel/CSV y lo concilio en el momento.`
      : `🏦 <b>¿Me pasan el extracto del banco de ${nombreDia}?</b>\n\n` +
        `${cuantoLlevamos}\n\n` +
        `Respondan a ESTE mensaje con el <b>Excel</b> o <b>CSV</b> y lo concilio en el momento: ` +
        `les digo cuántos depósitos casaron solos, cuáles quedan por aplicar y cuáles ` +
        `no tienen dueño. Si viene algún cheque devuelto, aviso aparte.\n\n` +
        `<i>Pueden escribir el banco en el pie del adjunto (ej.: BHD).</i>`;

  let entregado = false;
  try {
    await enviarMensajeGrupo(msg);
    entregado = true;
  } catch (error) {
    console.error('[CONCILIACION-EXTRACTO] Error enviando al grupo, cae a privado de ADMIN:', error);
  }

  if (!entregado) {
    // A quién en el fallback: el ADMIN activo con Telegram vinculado. Se
    // busca por el rol de la APP y no por el del chat, porque el del chat es
    // derivado y no distingue ADMIN de SUPERVISOR.
    const destinatarios = await cobranzasQuery<{ telegram_user_id: number }>(
      `SELECT t.telegram_user_id
       FROM cobranza_telegram_usuarios t
       JOIN usuarios u ON u.id = t.usuario_id AND u.empresa_id = t.empresa_id
       WHERE t.empresa_id = 1 AND t.activo = 1 AND u.activo = 1 AND u.rol = 'ADMIN'`
    );
    for (const d of destinatarios) {
      // Falla si esa persona nunca le dio a Iniciar al bot: sin eso Telegram
      // no deja que el bot escriba primero.
      if (await enviarMensajePrivado(d.telegram_user_id, msg)) entregado = true;
    }
  }

  if (!entregado) {
    return { pedido: false, motivo: 'no se pudo entregar ni al grupo ni a ningún ADMIN' };
  }

  await logAccion('sistema', 'EXTRACTO_SOLICITADO', 'conciliacion', '0', {
    modo,
    dias_sin_extracto: dias,
  });

  return { pedido: true, motivo: `pedido (${modo})`, dias };
}

/**
 * Aviso de media tarde: si el extracto de HOY sigue con depósitos DESCONOCIDO
 * o POR_APLICAR sin resolver, empuja al grupo con la lista. Se apaga con
 * `NUDGE_DEPOSITOS=off` si en la práctica resulta ruido en vez de ayuda.
 * No toca cheques devueltos (esos ya tienen su propio recordatorio cada 3
 * días — recordatorioChequesDevueltos).
 */
export async function recordarDepositosSinDueno(): Promise<{ avisado: boolean; motivo: string }> {
  if ((process.env.NUDGE_DEPOSITOS ?? '').toLowerCase() === 'off') {
    return { avisado: false, motivo: 'apagado por NUDGE_DEPOSITOS=off' };
  }
  if (!esDiaLaborable()) return { avisado: false, motivo: 'fin de semana' };

  const extracto = await ultimoExtracto(EMPRESA_GUIPAK);
  if (!extracto) return { avisado: false, motivo: 'no hay ningún extracto cargado' };
  if (fechaAST(new Date(extracto.cargadoAt)) !== fechaAST()) {
    return { avisado: false, motivo: 'el último extracto no es de hoy' };
  }

  const pendientes = await listarDepositosPendientes({
    estado: 'TODOS',
    archivo: extracto.archivo,
    limite: 50,
  });
  const relevantes = pendientes.filter((d) => d.estado !== 'CHEQUE_DEVUELTO');
  if (relevantes.length === 0) return { avisado: false, motivo: 'todo resuelto' };

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(n);

  let msg = `👋 Del extracto de hoy quedan <b>${relevantes.length}</b> depósito(s) sin resolver:\n\n`;
  for (const d of relevantes.slice(0, 8)) {
    msg += `• #${d.id} — ${fmt(Number(d.monto))} — ${d.estado === 'DESCONOCIDO' ? 'sin dueño' : 'por aplicar'}\n`;
  }
  if (relevantes.length > 8) msg += `... y ${relevantes.length - 8} más\n`;
  msg += `\nRespóndanme quién es cada uno y los cierro.`;

  try {
    await enviarMensajeGrupo(msg);
    return { avisado: true, motivo: `${relevantes.length} pendientes` };
  } catch (error) {
    console.error('[CONCILIACION-NUDGE] Error enviando al grupo:', error);
    return { avisado: false, motivo: 'error enviando al grupo' };
  }
}
