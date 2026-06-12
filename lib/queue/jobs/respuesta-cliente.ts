/**
 * Mensajes entrantes de clientes esperando respuesta — Asistente Cobros #5
 *
 * Cron frecuente (sugerido cada 30 min) que detecta mensajes ENTRANTES en
 * cobranza_conversaciones recientes que el equipo no ha respondido aun y
 * crea tareas en /tareas para responder.
 *
 * No genera la respuesta automatica con LLM — el equipo puede usar el bot
 * @CobrosGuipakBot ("genera respuesta para X") para el draft, o responder
 * directamente. La tarea solo asegura que el mensaje no queda olvidado.
 *
 * Heuristica de "esperando respuesta":
 * - Mensaje ENTRANTE en las ultimas 4 horas
 * - SIN mensaje SALIENTE del codigo_cliente posterior
 * - NO ya tiene tarea RESPUESTA_CLIENTE activa con origen_ref='conv:{id}'
 *
 * Ventana 4 horas: balance entre cobertura y duplicacion (si la tarea
 * anterior fue marcada HECHA pero el cliente vuelve a escribir, el nuevo
 * mensaje crea otra tarea — correcto). Si el cron corre cada 30 min, ese
 * lapso garantiza que en una jornada laboral cualquier mensaje cae al
 * menos una vez.
 *
 * Idempotencia: skip si ya hay tarea RESPUESTA_CLIENTE PENDIENTE/EN_PROGRESO
 * con origen_ref='conv:{conversacion_id}'.
 *
 * Memoria: project_cobros_frontera_asistente_supervisor.md
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

const VENTANA_HORAS = Number(process.env.RESPUESTA_CLIENTE_VENTANA_HORAS ?? 4);
const PREVIEW_LEN = 200;

interface MensajeEntrante {
  id: number;
  codigo_cliente: string;
  canal: 'WHATSAPP' | 'EMAIL';
  contenido: string;
  created_at: string;
}

interface StatsRespuestaCliente {
  entrantes_evaluados: number;
  con_respuesta_posterior: number;
  candidatas_a_responder: number;
  tareas_creadas: number;
  skip_ya_existe: number;
  skip_sin_codigo: number;
}

function truncar(s: string, max: number): string {
  if (!s) return '';
  const limpio = s.replace(/\s+/g, ' ').trim();
  return limpio.length > max ? limpio.slice(0, max - 1) + '…' : limpio;
}

export async function ejecutarRespuestaCliente(): Promise<StatsRespuestaCliente> {
  const stats: StatsRespuestaCliente = {
    entrantes_evaluados: 0,
    con_respuesta_posterior: 0,
    candidatas_a_responder: 0,
    tareas_creadas: 0,
    skip_ya_existe: 0,
    skip_sin_codigo: 0,
  };

  // Mensajes entrantes recientes
  const entrantes = await cobranzasQuery<MensajeEntrante>(
    `SELECT id, codigo_cliente, canal, contenido,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
     FROM cobranza_conversaciones
     WHERE empresa_id = 1 AND direccion='RECIBIDO'
       AND created_at >= (NOW() - INTERVAL ? HOUR)
       AND codigo_cliente IS NOT NULL
       AND codigo_cliente != ''
     ORDER BY created_at ASC`,
    [VENTANA_HORAS]
  );

  stats.entrantes_evaluados = entrantes.length;
  if (entrantes.length === 0) return stats;

  // Por cada mensaje entrante, queremos saber si hay un mensaje SALIENTE
  // del mismo cliente posterior (significa que ya se respondio).
  // Optimizacion: batch query que para cada codigo retorna MAX(fecha) de
  // mensaje SALIENTE en la ventana ampliada (8h para cubrir cualquier reply).
  const codigosUnicos = [...new Set(entrantes.map((m) => String(m.codigo_cliente).trim()))];
  const placeholdersCodigos = codigosUnicos.map(() => '?').join(',');

  const salientesRows = await cobranzasQuery<{
    codigo_cliente: string;
    ultima_saliente: string | null;
  }>(
    `SELECT codigo_cliente, MAX(created_at) AS ultima_saliente
     FROM cobranza_conversaciones
     WHERE empresa_id = 1 AND codigo_cliente IN (${placeholdersCodigos})
       AND direccion='ENVIADO'
       AND created_at >= (NOW() - INTERVAL ? HOUR)
     GROUP BY codigo_cliente`,
    [...codigosUnicos, VENTANA_HORAS + 4]
  );
  const ultimaSalienteMap = new Map(
    salientesRows.map((r) => [
      String(r.codigo_cliente).trim(),
      r.ultima_saliente ? new Date(r.ultima_saliente).getTime() : 0,
    ])
  );

  // Idempotencia: tareas ya activas
  const refsBuscadas = entrantes.map((m) => `conv:${m.id}`);
  const placeholdersRefs = refsBuscadas.map(() => '?').join(',');
  const tareasExistentes = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_tareas
     WHERE empresa_id = 1
       AND origen='RESPUESTA_CLIENTE'
       AND origen_ref IN (${placeholdersRefs})
       AND estado IN ('PENDIENTE','EN_PROGRESO')`,
    refsBuscadas
  );
  const yaConTarea = new Set(tareasExistentes.map((t) => t.origen_ref));

  // Filtrar entrantes que ya tienen respuesta o tarea activa
  const candidatas: MensajeEntrante[] = [];
  for (const m of entrantes) {
    const codigo = String(m.codigo_cliente).trim();
    if (!codigo) {
      stats.skip_sin_codigo++;
      continue;
    }
    const fechaEntrante = new Date(m.created_at).getTime();
    const ultimaSal = ultimaSalienteMap.get(codigo) ?? 0;
    if (ultimaSal > fechaEntrante) {
      stats.con_respuesta_posterior++;
      continue;
    }
    if (yaConTarea.has(`conv:${m.id}`)) {
      stats.skip_ya_existe++;
      continue;
    }
    candidatas.push(m);
  }

  stats.candidatas_a_responder = candidatas.length;
  if (candidatas.length === 0) return stats;

  // Para los candidatos, obtener nombres de cliente
  const codigosDefinitivos = [
    ...new Set(candidatas.map((m) => String(m.codigo_cliente).trim())),
  ];
  const placeholdersDef = codigosDefinitivos.map(() => '?').join(',');

  const nombresRows = await cobranzasQuery<{
    codigo_cliente: string;
    nombre_cliente: string | null;
  }>(
    `SELECT DISTINCT codigo_cliente, nombre_cliente
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND codigo_cliente IN (${placeholdersDef})`,
    codigosDefinitivos
  );
  const nombreMap = new Map<string, string>();
  for (const r of nombresRows) {
    if (r.nombre_cliente) {
      nombreMap.set(String(r.codigo_cliente).trim(), String(r.nombre_cliente).trim());
    }
  }

  for (const m of candidatas) {
    const codigo = String(m.codigo_cliente).trim();
    const nombre = nombreMap.get(codigo) || `Cliente ${codigo}`;
    const canalTxt = m.canal === 'WHATSAPP' ? 'WhatsApp' : 'correo';
    const preview = truncar(m.contenido, PREVIEW_LEN);

    // Prioridad: depende de palabras clave en el mensaje
    const contenidoLower = m.contenido.toLowerCase();
    const esUrgente =
      /urgente|reclamo|queja|cancelacion|cancela|legal|abogado|denuncia/i.test(contenidoLower);
    const prometePago =
      /pago|deposite|transferi|deposit[eo]|pagar[ée]/i.test(contenidoLower);
    const prioridad: 'ALTA' | 'MEDIA' = esUrgente || prometePago ? 'ALTA' : 'MEDIA';

    const tonoDescriptor = esUrgente
      ? '⚠ Tono urgente — atender hoy'
      : prometePago
      ? '💰 Menciona pago — confirmar acuerdo'
      : 'Mensaje recibido — responder';

    const titulo = `Responder a ${canalTxt} de ${nombre}`;
    const descripcion =
      `${nombre} (${codigo}) escribio via ${canalTxt} a las ` +
      `${m.created_at}:\n\n` +
      `"${preview}"\n\n` +
      `${tonoDescriptor}.\n\n` +
      `Opciones:\n` +
      `• Pedirle al bot @CobrosGuipakBot que genere una respuesta: ` +
      `"genera respuesta para ${nombre}".\n` +
      `• Responder manualmente desde /conversaciones o desde Telegram.\n` +
      `• Si el cliente promete pago, registrar acuerdo en /clientes/${codigo}.\n\n` +
      `Marcar tarea HECHA tras responder. Conversacion ID #${m.id}.`;

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (1, ?, ?, 'SEGUIMIENTO', CURDATE(), ?, ?, 'sistema',
               'cron-respuesta-cliente', 'RESPUESTA_CLIENTE', ?)`,
      [titulo, descripcion, codigo, prioridad, `conv:${m.id}`]
    );
    stats.tareas_creadas++;
  }

  return stats;
}
