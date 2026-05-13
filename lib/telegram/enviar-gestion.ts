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
import { enviarWhatsApp } from '@/lib/evolution/client';
import { downloadPdfBuffer } from '@/lib/drive/client';
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
  mensaje_propuesto_wa: string | null;
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
    'SELECT id, estado, aprobado_por, canal, codigo_cliente, ij_inum, saldo_pendiente, asunto_email, mensaje_propuesto_email, mensaje_propuesto_wa, mensaje_final_email, ultima_consulta_softec FROM cobranza_gestiones WHERE id = ?',
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
      "SELECT (IJ_TOT - IJ_TOTAPPL) AS saldo FROM v_cobr_ijnl WHERE IJ_INUM = ? AND IJ_TYPEDOC='IN' AND IJ_INVTORF='T' LIMIT 1",
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

  const codigo = String(gestion.codigo_cliente).trim();
  const clienteSoftec = await softecQuery<{ email: string | null; telefono: string | null; nombre: string }>(
    "SELECT IC_EMAIL AS email, IC_PHONE AS telefono, IC_NAME AS nombre FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1",
    [codigo]
  );
  const nombreCliente = clienteSoftec[0]?.nombre
    ? String(clienteSoftec[0].nombre).trim()
    : codigo;

  const enr = await cobranzasQuery<{ email: string | null; whatsapp: string | null }>(
    'SELECT email, whatsapp FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigo]
  );
  const emailDestino = (clienteSoftec[0]?.email ? String(clienteSoftec[0].email).trim() : '') ||
    (enr[0]?.email ? enr[0].email.trim() : '');
  const telefonoDestino = (enr[0]?.whatsapp ? enr[0].whatsapp.trim() : '') ||
    (clienteSoftec[0]?.telefono ? String(clienteSoftec[0].telefono).trim() : '');

  // Intentar adjuntar PDF de Drive si existe
  const docRows = await cobranzasQuery<{ google_drive_id: string; nombre_archivo: string | null }>(
    'SELECT google_drive_id, nombre_archivo FROM cobranza_facturas_documentos WHERE ij_inum = ? LIMIT 1',
    [gestion.ij_inum]
  );
  const docRow = docRows[0] || null;

  if (gestion.canal === 'WHATSAPP') {
    // ─── Envío WhatsApp ────────────────────────────────────────────
    if (!telefonoDestino) {
      await cobranzasExecute(
        "UPDATE cobranza_gestiones SET estado='FALLIDO', motivo_descarte='SIN_WHATSAPP' WHERE id = ?",
        [gestionId]
      );
      return { ok: false, error: 'Cliente sin número de WhatsApp registrado' };
    }

    const textoWa = gestion.mensaje_propuesto_wa || '';
    if (!textoWa) {
      return { ok: false, error: 'No hay mensaje de WhatsApp en esta gestión' };
    }

    await logAccion(
      gestion.aprobado_por,
      'ENVIAR_WHATSAPP_TELEGRAM',
      'gestion',
      String(gestionId),
      { telefono: telefonoDestino }
    );

    try {
      // Si hay PDF en Drive, agregar el link de vista al final del mensaje
      let mensajeFinal = textoWa;
      if (docRow?.google_drive_id) {
        const urlPdf = `https://drive.google.com/file/d/${docRow.google_drive_id}/view`;
        mensajeFinal += `\n\n📄 Factura: ${urlPdf}`;
      }

      const result = await enviarWhatsApp(telefonoDestino, mensajeFinal);

      await cobranzasExecute(
        `UPDATE cobranza_gestiones SET estado='ENVIADO', fecha_envio=NOW(), email_message_id=? WHERE id = ?`,
        [result.messageId || null, gestionId]
      );
      await cobranzasExecute(
        `INSERT INTO cobranza_conversaciones (codigo_cliente, ij_inum, canal, direccion, contenido, gestion_id)
         VALUES (?, ?, 'WHATSAPP', 'ENVIADO', ?, ?)`,
        [codigo, gestion.ij_inum, mensajeFinal, gestionId]
      );

      return {
        ok: true,
        destinatario: `${nombreCliente} (${telefonoDestino})`,
        message_id: result.messageId,
      };
    } catch (err) {
      await cobranzasExecute(
        "UPDATE cobranza_gestiones SET estado='FALLIDO', motivo_descarte=? WHERE id = ?",
        [err instanceof Error ? err.message.substring(0, 200) : 'Error', gestionId]
      );
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ─── Envío Email (default) ─────────────────────────────────────
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
    { email: emailDestino, asunto, tiene_pdf: !!docRow }
  );

  try {
    // Intentar descargar PDF si existe en Drive (best-effort — no bloquea el envío)
    let adjuntos: import('@/lib/email/sender').EmailAttachment[] | undefined;
    if (docRow?.google_drive_id) {
      const pdfBuffer = await downloadPdfBuffer(docRow.google_drive_id);
      if (pdfBuffer) {
        adjuntos = [{
          filename: docRow.nombre_archivo || `factura-${gestion.ij_inum}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }];
      }
    }

    const result = await enviarEmail(emailDestino, asunto, cuerpo, adjuntos);

    if (result.status === 'failed') {
      await cobranzasExecute(
        "UPDATE cobranza_gestiones SET estado='FALLIDO', motivo_descarte=? WHERE id = ?",
        [(result.error || 'Error SMTP').substring(0, 200), gestionId]
      );
      return { ok: false, error: result.error || 'Error enviando email' };
    }

    await cobranzasExecute(
      `UPDATE cobranza_gestiones SET estado='ENVIADO', fecha_envio=NOW(), email_message_id=? WHERE id = ?`,
      [result.messageId || null, gestionId]
    );
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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
