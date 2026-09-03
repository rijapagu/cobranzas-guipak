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
  return { ok: true, mensaje: `Gestión ${gestionId} descartada.` };
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
