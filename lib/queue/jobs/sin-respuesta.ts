/**
 * Correos enviados sin respuesta — Asistente Cobros #11
 *
 * Cron diario (sugerido 8:30 AM AST) que detecta correos/WhatsApps de
 * cobranza enviados hace N dias (default 5) que el cliente NO respondio Y
 * el equipo NO escaló posteriormente. Crea tarea: "Cliente X no respondio
 * — ¿re-enviar o llamar?".
 *
 * Razon: una gestion enviada y sin respuesta tras varios dias significa
 * que el correo se perdio (spam, mal email, cliente desentendido). Hay que
 * cerrar el loop manualmente: re-enviar por otro canal, llamar, o
 * escalar.
 *
 * Heuristica para "no respondio":
 * - Gestion aprobada hace >= UMBRAL_DIAS (default 5)
 * - SIN mensaje ENTRANTE del cliente en cobranza_conversaciones posterior
 *   a la fecha de aprobacion
 * - SIN gestion APROBADA mas reciente (significa que el equipo ya hizo
 *   otra cosa)
 *
 * Idempotencia: skip si ya hay tarea SIN_RESPUESTA con
 * origen_ref='gestion:{id}'.
 *
 * Memoria: project_cobros_frontera_asistente_supervisor.md
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

const UMBRAL_DIAS_SIN_RESPUESTA = Number(
  process.env.SIN_RESPUESTA_DIAS_UMBRAL ?? 5
);
const MAX_GESTIONES_POR_RUN = 200;

interface GestionSinRespuesta {
  id: number;
  codigo_cliente: string;
  ij_inum: number;
  canal: 'EMAIL' | 'WHATSAPP';
  saldo_pendiente: number;
  dias_vencido: number;
  fecha_aprobacion: string;
  dias_sin_respuesta: number;
}

interface StatsSinRespuesta {
  gestiones_evaluadas: number;
  con_respuesta: number;
  con_gestion_posterior: number;
  candidatas_sin_respuesta: number;
  tareas_creadas: number;
  skip_ya_existe: number;
}

function formatearMontoDOP(monto: number): string {
  return `RD$${monto.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function formatearFecha(fechaIso: string): string {
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const d = new Date(fechaIso);
  return `${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;
}

export async function ejecutarSinRespuesta(): Promise<StatsSinRespuesta> {
  const stats: StatsSinRespuesta = {
    gestiones_evaluadas: 0,
    con_respuesta: 0,
    con_gestion_posterior: 0,
    candidatas_sin_respuesta: 0,
    tareas_creadas: 0,
    skip_ya_existe: 0,
  };

  // Gestiones aprobadas hace >= UMBRAL_DIAS pero no demasiado viejas
  // (>30 dias significa que ya quedo enterrado, no vale la pena re-enviar
  // el mismo correo — la cadencia ya escaló a otro paso si correspondía).
  const candidatas = await cobranzasQuery<GestionSinRespuesta>(
    `SELECT
       g.id,
       g.codigo_cliente,
       g.ij_inum,
       g.canal,
       g.saldo_pendiente,
       g.dias_vencido,
       DATE_FORMAT(g.fecha_aprobacion, '%Y-%m-%d') AS fecha_aprobacion,
       DATEDIFF(CURDATE(), g.fecha_aprobacion) AS dias_sin_respuesta
     FROM cobranza_gestiones g
     WHERE g.empresa_id = 1 AND g.estado IN ('APROBADO','EDITADO')
       AND g.canal IN ('EMAIL','WHATSAPP')
       AND DATEDIFF(CURDATE(), g.fecha_aprobacion) BETWEEN ? AND 30
     ORDER BY g.fecha_aprobacion ASC
     LIMIT ?`,
    [UMBRAL_DIAS_SIN_RESPUESTA, MAX_GESTIONES_POR_RUN]
  );

  stats.gestiones_evaluadas = candidatas.length;
  if (candidatas.length === 0) return stats;

  const codigosUnicos = [...new Set(candidatas.map((g) => g.codigo_cliente))];
  const codigosPlaceholders = codigosUnicos.map(() => '?').join(',');

  // Clientes que SI respondieron en el periodo (de cualquier gestion).
  // Optimizacion: 1 query batch que para cada codigo retorna max(fecha) de
  // mensaje ENTRANTE en los ultimos 30 dias.
  const respuestasRows = await cobranzasQuery<{
    codigo_cliente: string;
    ultima_respuesta: string | null;
  }>(
    `SELECT codigo_cliente, MAX(created_at) AS ultima_respuesta
     FROM cobranza_conversaciones
     WHERE empresa_id = 1 AND codigo_cliente IN (${codigosPlaceholders})
       AND direccion='RECIBIDO'
       AND created_at >= (CURDATE() - INTERVAL 30 DAY)
     GROUP BY codigo_cliente`,
    codigosUnicos
  );
  const ultimaRespuestaMap = new Map(
    respuestasRows.map((r) => [
      String(r.codigo_cliente).trim(),
      r.ultima_respuesta ? new Date(r.ultima_respuesta).getTime() : 0,
    ])
  );

  // Gestiones posteriores a las candidatas (significa que el equipo ya
  // mando otra cosa, atendio el caso de otra manera). Batch.
  const gestionesPosterioresRows = await cobranzasQuery<{
    codigo_cliente: string;
    ultima_gestion: string | null;
  }>(
    `SELECT codigo_cliente, MAX(fecha_aprobacion) AS ultima_gestion
     FROM cobranza_gestiones
     WHERE empresa_id = 1 AND codigo_cliente IN (${codigosPlaceholders})
       AND estado IN ('APROBADO','EDITADO')
       AND fecha_aprobacion >= (CURDATE() - INTERVAL 30 DAY)
     GROUP BY codigo_cliente`,
    codigosUnicos
  );
  const ultimaGestionMap = new Map(
    gestionesPosterioresRows.map((r) => [
      String(r.codigo_cliente).trim(),
      r.ultima_gestion ? new Date(r.ultima_gestion).getTime() : 0,
    ])
  );

  // Idempotencia: cargar tareas SIN_RESPUESTA activas para estas gestiones
  const refsBuscadas = candidatas.map((g) => `gestion:${g.id}`);
  const tareasExistentes = await cobranzasQuery<{ origen_ref: string }>(
    `SELECT origen_ref
     FROM cobranza_tareas
     WHERE empresa_id = 1
       AND origen='SIN_RESPUESTA'
       AND origen_ref IN (${refsBuscadas.map(() => '?').join(',')})
       AND estado IN ('PENDIENTE','EN_PROGRESO')`,
    refsBuscadas
  );
  const yaConTarea = new Set(tareasExistentes.map((t) => t.origen_ref));

  // Nombres clientes — query batch a cobranza_clientes_enriquecidos primero,
  // luego sera Softec si falta. Por simplicidad usamos Softec via JOIN luego.
  // Aqui solo guardamos los codigos -> hacemos query final mas abajo si
  // hay candidatos definitivos.

  const definitivasSinRespuesta: GestionSinRespuesta[] = [];

  for (const g of candidatas) {
    const codigo = String(g.codigo_cliente).trim();
    const fechaGestion = new Date(g.fecha_aprobacion).getTime();
    const ultimaResp = ultimaRespuestaMap.get(codigo) ?? 0;
    const ultimaGestion = ultimaGestionMap.get(codigo) ?? 0;

    if (ultimaResp > fechaGestion) {
      stats.con_respuesta++;
      continue;
    }
    if (ultimaGestion > fechaGestion) {
      stats.con_gestion_posterior++;
      continue;
    }
    if (yaConTarea.has(`gestion:${g.id}`)) {
      stats.skip_ya_existe++;
      continue;
    }

    stats.candidatas_sin_respuesta++;
    definitivasSinRespuesta.push(g);
  }

  if (definitivasSinRespuesta.length === 0) return stats;

  // Obtener nombres de los clientes de las gestiones definitivas
  const codigosDefinitivos = [
    ...new Set(definitivasSinRespuesta.map((g) => String(g.codigo_cliente).trim())),
  ];
  const placeholdersDef = codigosDefinitivos.map(() => '?').join(',');

  // Buscar nombres desde cobranza_cliente_inteligencia (mas rapido que softec)
  // o caer a un campo "nombre" estandar — al menos un identificador para mostrar.
  // Si no se encuentra, usar codigo solamente.
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

  for (const g of definitivasSinRespuesta) {
    const codigo = String(g.codigo_cliente).trim();
    const nombre = nombreMap.get(codigo) || `Cliente ${codigo}`;
    const canalTxt = g.canal === 'WHATSAPP' ? 'WhatsApp' : 'correo';
    const prioridad: 'ALTA' | 'MEDIA' =
      Number(g.saldo_pendiente) > 100_000 || Number(g.dias_vencido) > 45 ? 'ALTA' : 'MEDIA';

    const titulo = `Sin respuesta a ${canalTxt} — ${nombre}`;
    const descripcion =
      `${nombre} (${codigo}) no respondio al ${canalTxt} enviado el ` +
      `${formatearFecha(g.fecha_aprobacion)} (hace ${g.dias_sin_respuesta} dias).\n\n` +
      `Factura #${g.ij_inum} | Saldo ${formatearMontoDOP(Number(g.saldo_pendiente))} | ` +
      `Mora ${g.dias_vencido}d\n\n` +
      `Opciones:\n` +
      `• Re-enviar por OTRO canal (si fue correo, probar WhatsApp; si fue WhatsApp, llamar).\n` +
      `• Llamada directa si el cliente es importante.\n` +
      `• Si tras esta tarea sigue sin respuesta, considerar escalar (gestion directa o legal).\n\n` +
      `Marcar HECHA cuando se cierre el loop.`;

    await cobranzasExecute(
      `INSERT INTO cobranza_tareas
         (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, codigo_cliente, ij_inum,
          prioridad, asignada_a, creado_por, origen, origen_ref)
       VALUES (1, ?, ?, 'SEGUIMIENTO', CURDATE(), ?, ?, ?, 'sistema',
               'cron-sin-respuesta', 'SIN_RESPUESTA', ?)`,
      [titulo, descripcion, codigo, g.ij_inum, prioridad, `gestion:${g.id}`]
    );
    stats.tareas_creadas++;
  }

  return stats;
}
