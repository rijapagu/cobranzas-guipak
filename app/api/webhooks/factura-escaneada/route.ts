import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { verifyPdf } from '@/lib/drive/client';

/**
 * POST /api/webhooks/factura-escaneada
 * Recibe webhook del CRM cuando se escanea/sube una factura a Google Drive.
 * No requiere session auth (viene del CRM externo).
 *
 * Body esperado:
 * {
 *   "numero_factura": "IN-456",
 *   "ij_inum": 456,
 *   "codigo_cliente": "0000274",
 *   "google_drive_id": "1BxiM...",
 *   "url_pdf": "https://drive.google.com/...",
 *   "fecha_escaneo": "2026-04-09T10:00:00Z"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { ij_inum, codigo_cliente, google_drive_id, url_pdf, fecha_escaneo } = body;

    // Validación básica
    if (!ij_inum || !codigo_cliente || !google_drive_id) {
      return NextResponse.json(
        { error: 'Campos requeridos: ij_inum, codigo_cliente, google_drive_id' },
        { status: 400 }
      );
    }

    // Verificar que el PDF existe en Drive
    const pdfCheck = await verifyPdf(google_drive_id);
    const nombreArchivo = pdfCheck.name || `factura-${ij_inum}.pdf`;

    const pdfUrl = url_pdf || `https://drive.google.com/file/d/${google_drive_id}/view`;
    const fechaEscaneo = fecha_escaneo ? new Date(fecha_escaneo) : new Date();

    // Verificar si ya existe un documento para esta factura
    const existentes = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM cobranza_facturas_documentos WHERE ij_inum = ? LIMIT 1',
      [ij_inum]
    );

    if (existentes.length > 0) {
      // Actualizar el documento existente
      await cobranzasExecute(
        `UPDATE cobranza_facturas_documentos
         SET google_drive_id = ?, url_pdf = ?, nombre_archivo = ?, fecha_escaneo = ?, origen = 'CRM_WEBHOOK'
         WHERE id = ?`,
        [google_drive_id, pdfUrl, nombreArchivo, fechaEscaneo, existentes[0].id]
      );

      await logAccion(null, 'DOCUMENTO_ACTUALIZADO', 'factura_documento', existentes[0].id.toString(), {
        ij_inum, codigo_cliente, google_drive_id, origen: 'CRM_WEBHOOK',
      });
    } else {
      // Insertar nuevo documento
      const result = await cobranzasExecute(
        `INSERT INTO cobranza_facturas_documentos
         (ij_local, ij_inum, codigo_cliente, google_drive_id, url_pdf, nombre_archivo, fecha_escaneo, origen)
         VALUES ('001', ?, ?, ?, ?, ?, ?, 'CRM_WEBHOOK')`,
        [ij_inum, codigo_cliente, google_drive_id, pdfUrl, nombreArchivo, fechaEscaneo]
      );

      await logAccion(null, 'DOCUMENTO_REGISTRADO', 'factura_documento', result.insertId.toString(), {
        ij_inum, codigo_cliente, google_drive_id, origen: 'CRM_WEBHOOK',
      });
    }

    // Actualizar tiene_pdf en gestiones pendientes de esta factura
    await cobranzasExecute(
      `UPDATE cobranza_gestiones
       SET tiene_pdf = 1, url_pdf = ?
       WHERE ij_inum = ? AND estado IN ('PENDIENTE', 'APROBADO')`,
      [pdfUrl, ij_inum]
    );

    return NextResponse.json({
      ok: true,
      mensaje: existentes.length > 0 ? 'Documento actualizado' : 'Documento registrado',
      ij_inum,
    });
  } catch (error) {
    console.error('[WEBHOOK-FACTURA] Error:', error);
    return NextResponse.json(
      { error: 'Error procesando webhook de factura' },
      { status: 500 }
    );
  }
}
