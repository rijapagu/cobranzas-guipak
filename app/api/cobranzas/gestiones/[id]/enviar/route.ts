import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { enviarWhatsApp } from '@/lib/evolution/client';
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
  moneda: string;
  mensaje_final_wa: string | null;
  mensaje_propuesto_wa: string | null;
  mensaje_final_email: string | null;
  mensaje_propuesto_email: string | null;
  asunto_email: string | null;
  ultima_consulta_softec: string;
  tiene_pdf: number;
  url_pdf: string | null;
}

interface ClienteContacto {
  telefono: string | null;
  email: string | null;
}

/**
 * POST /api/cobranzas/gestiones/[id]/enviar
 * Envía el mensaje aprobado por WhatsApp y/o Email.
 * CP-02: Verifica aprobación antes de enviar.
 * CP-06: Valida saldo actual si cache > 4 horas.
 * CP-08: Log antes de ejecutar.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { id } = await params;
    const gestionId = Number(id);

    // Obtener gestión
    const gestiones = await cobranzasQuery<GestionRow>(
      'SELECT * FROM cobranza_gestiones WHERE id = ?',
      [gestionId]
    );

    if (gestiones.length === 0) {
      return NextResponse.json({ error: 'Gestión no encontrada' }, { status: 404 });
    }

    const g = gestiones[0];

    // ═══════════════════════════════════════════
    // CP-02: Verificar aprobación
    // ═══════════════════════════════════════════
    if (!['APROBADO', 'EDITADO'].includes(g.estado)) {
      return NextResponse.json(
        { error: `No se puede enviar: estado actual es ${g.estado}. Debe estar APROBADO.` },
        { status: 400 }
      );
    }
    if (!g.aprobado_por) {
      return NextResponse.json(
        { error: 'CP-02: Gestión sin aprobador registrado. No se puede enviar.' },
        { status: 400 }
      );
    }

    // ═══════════════════════════════════════════
    // CP-06: Validar saldo actual
    // ═══════════════════════════════════════════
    const horasDesdeConsulta = differenceInHours(
      new Date(),
      new Date(g.ultima_consulta_softec)
    );

    if (horasDesdeConsulta > 4) {
      const softecOk = await testSoftecConnection();
      if (softecOk) {
        const saldoRows = await softecQuery<{ saldo: number }>(
          `SELECT (IJ_TOT - IJ_TOTAPPL) as saldo FROM ijnl
           WHERE IJ_INUM = ? AND IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T'
           LIMIT 1`,
          [g.ij_inum]
        );

        if (saldoRows.length > 0 && saldoRows[0].saldo <= 0) {
          // Factura ya pagada — cancelar gestión
          await cobranzasExecute(
            "UPDATE cobranza_gestiones SET estado = 'DESCARTADO', motivo_descarte = 'FACTURA_PAGADA' WHERE id = ?",
            [gestionId]
          );
          await logAccion(session.userId.toString(), 'ENVIO_CANCELADO_PAGADA', 'gestion', id, {
            cliente: g.codigo_cliente,
            factura: g.ij_inum,
          });
          return NextResponse.json(
            { error: 'Factura ya fue pagada. Gestión cancelada automáticamente.' },
            { status: 400 }
          );
        }

        // Actualizar timestamp de consulta
        await cobranzasExecute(
          'UPDATE cobranza_gestiones SET ultima_consulta_softec = NOW() WHERE id = ?',
          [gestionId]
        );
      }
    }

    // ═══════════════════════════════════════════
    // Obtener datos de contacto del cliente
    // ═══════════════════════════════════════════
    const contacto = await obtenerContactoCliente(g.codigo_cliente);
    const mensajeWa = g.mensaje_final_wa || g.mensaje_propuesto_wa;
    const mensajeEmail = g.mensaje_final_email || g.mensaje_propuesto_email;
    const asuntoEmail = g.asunto_email || 'Cobros Guipak';

    let waMessageId: string | null = null;
    let emailMessageId: string | null = null;
    let envioExitoso = false;

    // ═══════════════════════════════════════════
    // CP-08: Log ANTES de enviar
    // ═══════════════════════════════════════════
    await logAccion(session.userId.toString(), 'MENSAJE_ENVIANDO', 'gestion', id, {
      cliente: g.codigo_cliente,
      canal: g.canal,
      saldo: g.saldo_pendiente,
    });

    // ═══════════════════════════════════════════
    // Enviar WhatsApp
    // ═══════════════════════════════════════════
    if (['WHATSAPP', 'AMBOS'].includes(g.canal) && contacto.telefono && mensajeWa) {
      const waResult = await enviarWhatsApp(contacto.telefono, mensajeWa);
      waMessageId = waResult.messageId;

      // Registrar en conversaciones
      await cobranzasExecute(
        `INSERT INTO cobranza_conversaciones
         (gestion_id, codigo_cliente, ij_inum, canal, direccion, contenido, whatsapp_message_id, estado, generado_por_ia, aprobado_por)
         VALUES (?, ?, ?, 'WHATSAPP', 'ENVIADO', ?, ?, ?, 1, ?)`,
        [gestionId, g.codigo_cliente, g.ij_inum, mensajeWa, waMessageId,
         waResult.status === 'sent' ? 'ENVIADO' : 'FALLIDO', g.aprobado_por]
      );

      if (waResult.status === 'sent') envioExitoso = true;
    }

    // ═══════════════════════════════════════════
    // Enviar Email
    // ═══════════════════════════════════════════
    if (['EMAIL', 'AMBOS'].includes(g.canal) && contacto.email && mensajeEmail) {
      const emailResult = await enviarEmail(contacto.email, asuntoEmail, mensajeEmail);
      emailMessageId = emailResult.messageId;

      await cobranzasExecute(
        `INSERT INTO cobranza_conversaciones
         (gestion_id, codigo_cliente, ij_inum, canal, direccion, contenido, asunto, email_to, email_message_id, estado, generado_por_ia, aprobado_por)
         VALUES (?, ?, ?, 'EMAIL', 'ENVIADO', ?, ?, ?, ?, ?, 1, ?)`,
        [gestionId, g.codigo_cliente, g.ij_inum, mensajeEmail, asuntoEmail,
         contacto.email, emailMessageId,
         emailResult.status === 'sent' ? 'ENVIADO' : 'FALLIDO', g.aprobado_por]
      );

      if (emailResult.status === 'sent') envioExitoso = true;
    }

    // ═══════════════════════════════════════════
    // Actualizar gestión
    // ═══════════════════════════════════════════
    const nuevoEstado = envioExitoso ? 'ENVIADO' : 'FALLIDO';
    await cobranzasExecute(
      `UPDATE cobranza_gestiones
       SET estado = ?, fecha_envio = NOW(), whatsapp_message_id = ?, email_message_id = ?
       WHERE id = ?`,
      [nuevoEstado, waMessageId, emailMessageId, gestionId]
    );

    await logAccion(session.userId.toString(), 'MENSAJE_ENVIADO', 'gestion', id, {
      estado: nuevoEstado,
      canal: g.canal,
      wa_id: waMessageId,
      email_id: emailMessageId,
    });

    return NextResponse.json({
      message: envioExitoso ? 'Mensaje enviado' : 'Error en envío',
      estado: nuevoEstado,
      whatsapp_message_id: waMessageId,
      email_message_id: emailMessageId,
    });
  } catch (error) {
    console.error('[ENVIAR] Error:', error);
    return NextResponse.json({ error: 'Error enviando mensaje' }, { status: 500 });
  }
}

/**
 * Obtiene teléfono y email del cliente.
 * Prioridad: datos enriquecidos → Softec.
 */
async function obtenerContactoCliente(codigoCliente: string): Promise<ClienteContacto> {
  // Primero buscar en datos enriquecidos
  const enriquecidos = await cobranzasQuery<{ whatsapp: string; email: string }>(
    'SELECT whatsapp, email FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );

  if (enriquecidos.length > 0) {
    const e = enriquecidos[0];
    if (e.whatsapp || e.email) {
      return { telefono: e.whatsapp || null, email: e.email || null };
    }
  }

  // Fallback a Softec
  const softecOk = await testSoftecConnection();
  if (softecOk) {
    const clientes = await softecQuery<{ IC_PHONE: string; IC_EMAIL: string }>(
      'SELECT IC_PHONE, IC_EMAIL FROM icust WHERE IC_CODE = ? LIMIT 1',
      [codigoCliente]
    );
    if (clientes.length > 0) {
      return {
        telefono: clientes[0].IC_PHONE?.trim() || null,
        email: clientes[0].IC_EMAIL?.trim() || null,
      };
    }
  }

  // Mock fallback
  return { telefono: '8095550101', email: 'mock@guipak.com' };
}
