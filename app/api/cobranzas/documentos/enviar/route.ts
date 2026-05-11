import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import { softecQuery } from '@/lib/db/softec';
import { enviarEmail } from '@/lib/email/sender';
import { enviarWhatsApp } from '@/lib/evolution/client';
import { downloadPdfBuffer } from '@/lib/drive/client';

/**
 * POST /api/cobranzas/documentos/enviar
 * Envía una factura PDF a un cliente por email o WhatsApp.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { documento_id, canal, destinatario } = await request.json();

    if (!documento_id || !canal || !destinatario) {
      return NextResponse.json(
        { error: 'Campos requeridos: documento_id, canal (EMAIL|WHATSAPP), destinatario' },
        { status: 400 }
      );
    }

    if (canal !== 'EMAIL' && canal !== 'WHATSAPP') {
      return NextResponse.json({ error: 'Canal debe ser EMAIL o WHATSAPP' }, { status: 400 });
    }

    const docs = await cobranzasQuery<{
      id: number;
      ij_inum: number;
      codigo_cliente: string;
      google_drive_id: string;
      nombre_archivo: string | null;
      url_pdf: string;
    }>(
      'SELECT id, ij_inum, codigo_cliente, google_drive_id, nombre_archivo, url_pdf FROM cobranza_facturas_documentos WHERE id = ? LIMIT 1',
      [documento_id]
    );

    if (docs.length === 0) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const doc = docs[0];

    const clienteRows = await softecQuery<{ nombre: string }>(
      'SELECT IC_NAME AS nombre FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1',
      [doc.codigo_cliente]
    );
    const nombreCliente = clienteRows[0]?.nombre
      ? String(clienteRows[0].nombre).trim()
      : doc.codigo_cliente;

    await logAccion(session.email, 'ENVIAR_FACTURA_MANUAL', 'documento', String(doc.id), {
      canal, destinatario, ij_inum: doc.ij_inum, codigo_cliente: doc.codigo_cliente,
    });

    if (canal === 'EMAIL') {
      const pdfBuffer = await downloadPdfBuffer(doc.google_drive_id);
      const adjuntos = pdfBuffer
        ? [{
            filename: doc.nombre_archivo || `factura-${doc.ij_inum}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf' as const,
          }]
        : undefined;

      const asunto = `Factura ${doc.ij_inum} — ${nombreCliente} — Suministros Guipak`;
      const cuerpo = `Estimado/a cliente,\n\nAdjunto encontrará la factura #${doc.ij_inum}.\n\nSi tiene alguna pregunta sobre esta factura, no dude en contactarnos.\n\nSaludos cordiales,\nDepartamento de Cobros\nSuministros Guipak, S.R.L.`;

      if (!adjuntos) {
        return NextResponse.json({ error: 'No se pudo descargar el PDF desde Google Drive' }, { status: 500 });
      }

      await enviarEmail(destinatario.trim(), asunto, cuerpo, adjuntos);

      return NextResponse.json({
        ok: true,
        mensaje: `Factura ${doc.ij_inum} enviada por email a ${destinatario}`,
      });
    }

    // WHATSAPP
    const urlPdf = `https://drive.google.com/file/d/${doc.google_drive_id}/view`;
    const textoWa = `Buen día, le compartimos la factura #${doc.ij_inum} de Suministros Guipak:\n\n📄 ${urlPdf}\n\nCualquier duda estamos a la orden.`;

    await enviarWhatsApp(destinatario.trim(), textoWa);

    return NextResponse.json({
      ok: true,
      mensaje: `Factura ${doc.ij_inum} enviada por WhatsApp a ${destinatario}`,
    });
  } catch (error) {
    console.error('[DOCUMENTOS-ENVIAR] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error enviando factura' },
      { status: 500 }
    );
  }
}
