/**
 * Envío de una gestión APROBADA desde el bot de Telegram.
 * Reusa la lógica de Fase 6 (lib/email/sender + lib/evolution/client).
 *
 * CP-02: Verifica que esté APROBADO + aprobado_por NOT NULL antes de enviar.
 * CP-06: Verifica saldo en Softec si cache > 4 horas.
 * CP-08: Log antes de cada acción.
 */

import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery } from '@/lib/db/softec';
import { enviarEmail } from '@/lib/email/sender';
import { differenceInHours } from 'date-fns';

interface GestionRow {
  id: number;
  estado: string;
  aprobado_por: string | null;
  canal: string;
  codigo_cliente: string;
  ij_inum: number;
  saldo_pendiente: number;
  asunto_email: string | null;
  mensaje_propuesto_email: string | null;
  mensaje_final_email: string | null;
  ultima_consulta_softec: string;
}

export interface ResultadoEnvio {
  ok: boolean;
  destinatario?: string;
  error?: string;
  message_id?: string;
}

export async function enviarGestion(gestionId: number): Promise<ResultadoEnvio> {
  const rows = await cobranzasQuery<GestionRow>(
    'SELECT id, estado, aprobado_por, canal, codigo_cliente, ij_inum, saldo_pendiente, asunto_email, mensaje_propuesto_email, mensaje_final_email, ultima_consulta_softec FROM cobranza_gestiones WHERE id = ?',
    [gestionId]
  );

  if (rows.length === 0) return { ok: false, error: 'Gestión no encontrada' };
  const gestion = rows[0];

  // CP-02: Solo APROBADO con aprobado_por
  if (gestion.estado !== 'APROBADO' && gestion.estado !== 'EDITADO') {
    return { ok: false, error: `Estado inválido: ${gestion.estado}` };
  }
  if (!gestion.aprobado_por) {
    return { ok: false, error: 'Falta aprobado_por (CP-02)' };
  }

  // CP-06: Validar saldo si cache > 4 horas
  const horasCache = differenceInHours(
    new Date(),
    new Date(gestion.ultima_consulta_softec)
  );
  if (horasCache > 4) {
    const saldo = await softecQuery<{ saldo: number }>(
      "SELECT (IJ_TOT - IJ_TOTAPPL) AS saldo FROM ijnl WHERE IJ_INUM = ? AND IJ_TYPEDOC='IN' AND IJ_INVTORF='T' LIMIT 1",
      [gestion.ij_inum]
    );
    const saldoActual = Number(saldo[0]?.saldo) || 0;
    if (saldoActual <= 0) {
      await cobranzasExecute(
        "UPDATE cobranza_gestiones SET estado='DESCARTADO', motivo_descarte='FACTURA_PAGADA' WHERE id = ?",
        [gestionId]
      );
      return { ok: false, error: 'La factura ya fue pagada (CP-06)' };
    }
  }

  // Buscar email del cliente
  const codigo = String(gestion.codigo_cliente).trim();
  const clienteSoftec = await softecQuery<{ email: string | null; nombre: string }>(
    "SELECT IC_EMAIL AS email, IC_NAME AS nombre FROM icust WHERE IC_CODE = ? LIMIT 1",
    [codigo]
  );

  let emailDestino = clienteSoftec[0]?.email ? String(clienteSoftec[0].email).trim() : '';
  const nombreCliente = clienteSoftec[0]?.nombre
    ? String(clienteSoftec[0].nombre).trim()
    : codigo;

  if (!emailDestino) {
    const enr = await cobranzasQuery<{ email: string | null }>(
      'SELECT email FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
      [codigo]
    );
    if (enr[0]?.email) emailDestino = enr[0].email.trim();
  }

  if (!emailDestino) {
    await cobranzasExecute(
      "UPDATE cobranza_gestiones SET estado='FALLIDO', motivo_descarte='SIN_EMAIL' WHERE id = ?",
      [gestionId]
    );
    return { ok: false, error: 'Cliente sin email registrado' };
  }

  const cuerpo = gestion.mensaje_final_email || gestion.mensaje_propuesto_email || '';
  const asunto = gestion.asunto_email || `Cobranza Guipak — Factura ${gestion.ij_inum}`;

  // CP-08 log
  await logAccion(
    gestion.aprobado_por,
    'ENVIAR_EMAIL_TELEGRAM',
    'gestion',
    String(gestionId),
    { email: emailDestino, asunto }
  );

  try {
    const result = await enviarEmail(emailDestino, asunto, cuerpo);

    await cobranzasExecute(
      `UPDATE cobranza_gestiones
       SET estado='ENVIADO', fecha_envio=NOW(), email_message_id=?
       WHERE id = ?`,
      [result.messageId || null, gestionId]
    );

    // Registrar en cobranza_conversaciones
    await cobranzasExecute(
      `INSERT INTO cobranza_conversaciones (codigo_cliente, ij_inum, canal, direccion, contenido, gestion_id)
       VALUES (?, ?, 'EMAIL', 'ENVIADO', ?, ?)`,
      [codigo, gestion.ij_inum, `${asunto}\n\n${cuerpo}`, gestionId]
    );

    return {
      ok: true,
      destinatario: `${nombreCliente} <${emailDestino}>`,
      message_id: result.messageId,
    };
  } catch (err) {
    await cobranzasExecute(
      "UPDATE cobranza_gestiones SET estado='FALLIDO', motivo_descarte=? WHERE id = ?",
      [err instanceof Error ? err.message.substring(0, 200) : 'Error', gestionId]
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
