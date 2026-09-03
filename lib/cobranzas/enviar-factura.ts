/**
 * Envío manual de una factura PDF a un cliente por email o WhatsApp.
 * Extraído de app/api/cobranzas/documentos/enviar/route.ts para compartirlo
 * con la tool conversacional enviar_factura_cliente.
 */
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import { enviarEmail } from '@/lib/email/sender';
import { enviarWhatsApp } from '@/lib/evolution/client';
import { downloadPdfBuffer } from '@/lib/drive/client';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { configDeEmpresa } from '@/lib/empresas/config';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface ActorEnvioFactura {
  userId: string;
  userEmail: string;
}

export interface ResultadoEnvioFactura {
  ok: boolean;
  mensaje: string;
}

interface DocumentoFactura {
  id: number;
  ij_inum: number;
  codigo_cliente: string;
  google_drive_id: string;
  nombre_archivo: string | null;
}

export async function enviarFacturaCliente(
  datos: { documentoId: number; canal: 'EMAIL' | 'WHATSAPP'; destinatario: string },
  actor: ActorEnvioFactura,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoEnvioFactura> {
  const docs = await cobranzasQuery<DocumentoFactura>(
    'SELECT id, ij_inum, codigo_cliente, google_drive_id, nombre_archivo FROM cobranza_facturas_documentos WHERE id = ? AND empresa_id = ? LIMIT 1',
    [datos.documentoId, empresaId]
  );
  if (docs.length === 0) return { ok: false, mensaje: `Documento ${datos.documentoId} no encontrado.` };
  const doc = docs[0];

  const adapter = await adaptadorParaEmpresa(empresaId);
  const clienteErp = await adapter.cliente(doc.codigo_cliente).catch(() => null);
  const nombreCliente = clienteErp?.nombre ?? doc.codigo_cliente;
  const { identidad } = await configDeEmpresa(empresaId);
  const destinatario = datos.destinatario.trim();

  await logAccion(actor.userId, 'ENVIAR_FACTURA_MANUAL', 'documento', String(doc.id), {
    canal: datos.canal, destinatario, ij_inum: doc.ij_inum, codigo_cliente: doc.codigo_cliente,
  });

  if (datos.canal === 'EMAIL') {
    const pdfBuffer = await downloadPdfBuffer(doc.google_drive_id);
    if (!pdfBuffer) return { ok: false, mensaje: 'No se pudo descargar el PDF desde Google Drive.' };

    const asunto = `Factura ${doc.ij_inum} — ${nombreCliente} — ${identidad.alias}`;
    const cuerpo = `Estimado/a cliente,\n\nAdjunto encontrará la factura #${doc.ij_inum}.\n\nSi tiene alguna pregunta sobre esta factura, no dude en contactarnos.\n\nSaludos cordiales,\n${identidad.firma}`;
    const adjuntos = [{
      filename: doc.nombre_archivo || `factura-${doc.ij_inum}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf' as const,
    }];

    const resultado = await enviarEmail(destinatario, asunto, cuerpo, adjuntos, undefined, empresaId);
    if (resultado.status !== 'sent') {
      return { ok: false, mensaje: `No se pudo enviar el email: ${resultado.error || 'error SMTP'}.` };
    }
    return { ok: true, mensaje: `Factura ${doc.ij_inum} enviada por email a ${destinatario}.` };
  }

  // WHATSAPP
  const urlPdf = `https://drive.google.com/file/d/${doc.google_drive_id}/view`;
  const textoWa = `Buen día, le compartimos la factura #${doc.ij_inum} de ${identidad.alias}:\n\n📄 ${urlPdf}\n\nCualquier duda estamos a la orden.`;

  const resultado = await enviarWhatsApp(destinatario, textoWa, empresaId);
  if (resultado.status !== 'sent') {
    return { ok: false, mensaje: `No se pudo enviar el WhatsApp: ${resultado.error || 'error Evolution API'}.` };
  }
  return { ok: true, mensaje: `Factura ${doc.ij_inum} enviada por WhatsApp a ${destinatario}.` };
}
