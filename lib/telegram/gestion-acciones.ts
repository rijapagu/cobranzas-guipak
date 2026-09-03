/**
 * Acciones sobre una gestión (aprobar/descartar/escalar) ejecutadas por un
 * humano vía Telegram — botón inline o comando en texto libre del agente
 * conversacional. Una sola implementación para los dos caminos de entrada
 * (`manejarCallback` en el webhook, y las tools `aprobar_gestion`/
 * `descartar_gestion`/`escalar_gestion` en tools.ts) para que no puedan
 * divergir en las reglas de CP-02/CP-08.
 *
 * CP-02: aprobar/descartar exigen rol supervisor — paridad con los endpoints
 * web /gestiones/[id]/aprobar y /descartar. Escalar no exige rol, igual que
 * escalar/route.ts (solo pide sesión autenticada).
 */
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { enviarGestion } from './enviar-gestion';

export interface ActorGestion {
  userId: string;
  /** Ya formateado (ej. "telegram:ricardo") — se guarda tal cual en aprobado_por. */
  userEmail: string;
  esSupervisor: boolean;
}

export interface ResultadoAccionGestion {
  ok: boolean;
  mensaje: string;
}

interface GestionMinima {
  id: number;
  estado: string;
  codigo_cliente: string;
  saldo_pendiente: number;
}

async function gestionPendiente(gestionId: number): Promise<GestionMinima | null> {
  const rows = await cobranzasQuery<GestionMinima>(
    'SELECT id, estado, codigo_cliente, saldo_pendiente FROM cobranza_gestiones WHERE id = ? AND empresa_id = ?',
    [gestionId, EMPRESA_GUIPAK]
  );
  return rows[0] || null;
}

/**
 * Cierra la tarea espejo de cadencia asociada a la gestión (Camino A, junio
 * 2026), igual que ya hacían los endpoints web /gestiones/[id]/aprobar y
 * /descartar. Faltaba aquí desde que se creó este archivo (2026-09-03): al
 * aprobar/descartar por Telegram, la tarea espejo quedaba huérfana en
 * PENDIENTE para siempre, aunque la gestión ya estaba resuelta. Best-effort:
 * si no hay tarea espejo, el UPDATE afecta 0 filas y no falla nada más.
 */
async function cerrarTareaEspejo(
  gestionId: number,
  actorEmail: string,
  estado: 'HECHA' | 'CANCELADA',
  notas: string
): Promise<void> {
  await cobranzasExecute(
    `UPDATE cobranza_tareas
     SET estado=?, completada_at=NOW(), completada_por=?, notas_completado=?
     WHERE origen='CADENCIA' AND origen_ref=? AND estado='PENDIENTE' AND empresa_id=?`,
    [estado, actorEmail, notas, `gestion:${gestionId}`, EMPRESA_GUIPAK]
  );
}

export async function aprobarGestion(
  gestionId: number,
  actor: ActorGestion
): Promise<ResultadoAccionGestion> {
  if (!actor.esSupervisor) {
    return { ok: false, mensaje: 'Solo un supervisor puede aprobar gestiones.' };
  }
  const gestion = await gestionPendiente(gestionId);
  if (!gestion) return { ok: false, mensaje: `Gestión ${gestionId} no encontrada.` };
  if (gestion.estado !== 'PENDIENTE') {
    return { ok: false, mensaje: `La gestión ${gestionId} ya está en estado ${gestion.estado}.` };
  }

  await logAccion(actor.userId, 'GESTION_APROBADA_TELEGRAM', 'gestion', String(gestionId), {
    cliente: gestion.codigo_cliente,
    saldo: Number(gestion.saldo_pendiente),
  });

  await cobranzasExecute(
    `UPDATE cobranza_gestiones
     SET estado='APROBADO', aprobado_por=?, fecha_aprobacion=NOW(),
         mensaje_final_email = COALESCE(mensaje_final_email, mensaje_propuesto_email)
     WHERE id = ?`,
    [actor.userEmail, gestionId]
  );
  await cerrarTareaEspejo(gestionId, actor.userEmail, 'HECHA', 'Aprobada desde Telegram');

  let mensaje = `Gestión ${gestionId} aprobada.`;
  try {
    const envio = await enviarGestion(gestionId);
    mensaje += envio.ok
      ? ` Enviado a ${envio.destinatario || 'cliente'}.`
      : ` No se pudo enviar: ${envio.error}`;
  } catch (err) {
    mensaje += ` Error al enviar: ${err instanceof Error ? err.message : 'desconocido'}.`;
  }
  return { ok: true, mensaje };
}

export async function descartarGestion(
  gestionId: number,
  actor: ActorGestion,
  motivo: string
): Promise<ResultadoAccionGestion> {
  if (!actor.esSupervisor) {
    return { ok: false, mensaje: 'Solo un supervisor puede descartar gestiones.' };
  }
  const gestion = await gestionPendiente(gestionId);
  if (!gestion) return { ok: false, mensaje: `Gestión ${gestionId} no encontrada.` };
  if (gestion.estado !== 'PENDIENTE') {
    return { ok: false, mensaje: `La gestión ${gestionId} ya está en estado ${gestion.estado}.` };
  }

  await logAccion(actor.userId, 'GESTION_DESCARTADA_TELEGRAM', 'gestion', String(gestionId), {
    motivo,
    cliente: gestion.codigo_cliente,
  });
  await cobranzasExecute(
    "UPDATE cobranza_gestiones SET estado='DESCARTADO', motivo_descarte=?, aprobado_por=? WHERE id = ?",
    [motivo, actor.userEmail, gestionId]
  );
  await cerrarTareaEspejo(gestionId, actor.userEmail, 'CANCELADA', `Descartada desde Telegram: ${motivo}`);
  return { ok: true, mensaje: `Gestión ${gestionId} descartada.` };
}

/**
 * Edita el texto propuesto de una gestión PENDIENTE antes de aprobarla.
 * asunto_email se sobreescribe directo (no tiene columna "propuesto" aparte);
 * texto_email/texto_whatsapp escriben mensaje_final_* preservando el
 * mensaje_propuesto_* original — mismo esquema que ya usa aprobarGestion()
 * (COALESCE) y enviarGestion() (final || propuesto) para no divergir.
 */
export async function editarGestion(
  gestionId: number,
  actor: ActorGestion,
  cambios: { asunto?: string; textoEmail?: string; textoWhatsapp?: string }
): Promise<ResultadoAccionGestion> {
  if (!cambios.asunto && !cambios.textoEmail && !cambios.textoWhatsapp) {
    return { ok: false, mensaje: 'No diste ningún cambio — indica asunto, texto de email o texto de WhatsApp.' };
  }
  const gestion = await gestionPendiente(gestionId);
  if (!gestion) return { ok: false, mensaje: `Gestión ${gestionId} no encontrada.` };
  if (gestion.estado !== 'PENDIENTE') {
    return { ok: false, mensaje: `Solo se puede editar una gestión PENDIENTE — la ${gestionId} está ${gestion.estado}.` };
  }

  const sets: string[] = [];
  const params: string[] = [];
  if (cambios.asunto) { sets.push('asunto_email = ?'); params.push(cambios.asunto); }
  if (cambios.textoEmail) { sets.push('mensaje_final_email = ?'); params.push(cambios.textoEmail); }
  if (cambios.textoWhatsapp) { sets.push('mensaje_final_wa = ?'); params.push(cambios.textoWhatsapp); }

  await logAccion(actor.userId, 'GESTION_EDITADA_TELEGRAM', 'gestion', String(gestionId), {
    cliente: gestion.codigo_cliente,
    campos: Object.keys(cambios),
  });
  await cobranzasExecute(`UPDATE cobranza_gestiones SET ${sets.join(', ')} WHERE id = ?`, [...params, gestionId]);

  return { ok: true, mensaje: `Gestión ${gestionId} actualizada. Sigue PENDIENTE — apruébala cuando quieras enviarla.` };
}

export async function escalarGestion(
  gestionId: number,
  actor: ActorGestion,
  notas: string
): Promise<ResultadoAccionGestion> {
  const gestion = await gestionPendiente(gestionId);
  if (!gestion) return { ok: false, mensaje: `Gestión ${gestionId} no encontrada.` };
  if (gestion.estado !== 'PENDIENTE') {
    return {
      ok: false,
      mensaje: `No se puede escalar: la gestión ${gestionId} ya está en estado ${gestion.estado}.`,
    };
  }

  await logAccion(actor.userId, 'GESTION_ESCALADA_TELEGRAM', 'gestion', String(gestionId), {
    notas,
    cliente: gestion.codigo_cliente,
  });
  await cobranzasExecute(
    "UPDATE cobranza_gestiones SET estado='ESCALADO', motivo_descarte=?, aprobado_por=? WHERE id = ?",
    [notas ? `ESCALADO: ${notas}` : 'Escalado a gestión manual', actor.userEmail, gestionId]
  );
  return { ok: true, mensaje: `Gestión ${gestionId} escalada para seguimiento manual.` };
}
