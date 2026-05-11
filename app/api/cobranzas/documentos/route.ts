import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';

/**
 * GET /api/cobranzas/documentos
 * Lista documentos de facturas con filtros.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const busqueda = searchParams.get('busqueda')?.trim();
  const soloSinPdf = searchParams.get('sin_pdf') === '1';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const limit = Math.min(100, Number(searchParams.get('limit')) || 50);
  const offset = (page - 1) * limit;

  try {
    // Obtener documentos registrados
    let where = 'WHERE 1=1';
    const params: (string | number)[] = [];

    if (busqueda) {
      where += ' AND (ij_inum LIKE ? OR codigo_cliente LIKE ? OR nombre_archivo LIKE ?)';
      const q = `%${busqueda}%`;
      params.push(q, q, q);
    }

    if (soloSinPdf) {
      // Filtrar facturas que no tienen documento registrado (uso futuro)
      where += ' AND google_drive_id IS NULL';
    }

    // LIMIT/OFFSET se interpolan directamente (valores numéricos controlados)
    // para evitar ER_WRONG_ARGUMENTS en MySQL < 8 con prepared statements.
    const docs = await cobranzasQuery<{
      id: number;
      ij_local: string;
      ij_inum: number;
      codigo_cliente: string;
      google_drive_id: string;
      url_pdf: string;
      nombre_archivo: string;
      fecha_escaneo: string;
      subido_por: string | null;
      origen: string;
      created_at: string;
    }>(
      `SELECT id, ij_local, ij_inum, codigo_cliente, google_drive_id, url_pdf,
              nombre_archivo, fecha_escaneo, subido_por, origen, created_at
       FROM cobranza_facturas_documentos ${where}
       ORDER BY created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const countResult = await cobranzasQuery<{ total: number }>(
      `SELECT COUNT(*) as total FROM cobranza_facturas_documentos ${where}`,
      params
    );

    // Estadísticas
    const stats = await cobranzasQuery<{
      total_docs: number;
      crm_webhook: number;
      manual: number;
    }>(`
      SELECT
        COUNT(*) as total_docs,
        SUM(CASE WHEN origen = 'CRM_WEBHOOK' THEN 1 ELSE 0 END) as crm_webhook,
        SUM(CASE WHEN origen = 'MANUAL' THEN 1 ELSE 0 END) as manual
      FROM cobranza_facturas_documentos
    `);

    return NextResponse.json({
      documentos: docs,
      total: countResult[0]?.total || 0,
      page,
      limit,
      estadisticas: stats[0] || { total_docs: 0, crm_webhook: 0, manual: 0 },
    });
  } catch (error) {
    console.error('[DOCUMENTOS] Error:', error);
    return NextResponse.json({ error: 'Error consultando documentos' }, { status: 500 });
  }
}

/**
 * POST /api/cobranzas/documentos
 * Subida manual de documento (vinculación de factura con PDF en Drive).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { ij_inum, codigo_cliente, google_drive_id, url_pdf, nombre_archivo } = await request.json();

    if (!ij_inum || !codigo_cliente || !google_drive_id) {
      return NextResponse.json(
        { error: 'Campos requeridos: ij_inum, codigo_cliente, google_drive_id' },
        { status: 400 }
      );
    }

    const pdfUrl = url_pdf || `https://drive.google.com/file/d/${google_drive_id}/view`;

    // Verificar duplicado
    const existente = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM cobranza_facturas_documentos WHERE ij_inum = ? LIMIT 1',
      [ij_inum]
    );

    if (existente.length > 0) {
      await cobranzasExecute(
        `UPDATE cobranza_facturas_documentos
         SET google_drive_id = ?, url_pdf = ?, nombre_archivo = ?, subido_por = ?, origen = 'MANUAL'
         WHERE id = ?`,
        [google_drive_id, pdfUrl, nombre_archivo || `factura-${ij_inum}.pdf`, session.email, existente[0].id]
      );

      await logAccion(session.email, 'DOCUMENTO_ACTUALIZADO_MANUAL', 'factura_documento', existente[0].id.toString(), {
        ij_inum, codigo_cliente, google_drive_id,
      });

      return NextResponse.json({ ok: true, id: existente[0].id, accion: 'actualizado' });
    }

    const result = await cobranzasExecute(
      `INSERT INTO cobranza_facturas_documentos
       (ij_local, ij_inum, codigo_cliente, google_drive_id, url_pdf, nombre_archivo, fecha_escaneo, subido_por, origen)
       VALUES ('001', ?, ?, ?, ?, ?, NOW(), ?, 'MANUAL')`,
      [ij_inum, codigo_cliente, google_drive_id, pdfUrl, nombre_archivo || `factura-${ij_inum}.pdf`, session.email]
    );

    await logAccion(session.email, 'DOCUMENTO_SUBIDO_MANUAL', 'factura_documento', result.insertId.toString(), {
      ij_inum, codigo_cliente, google_drive_id,
    });

    return NextResponse.json({ ok: true, id: result.insertId, accion: 'creado' });
  } catch (error) {
    console.error('[DOCUMENTOS] Error POST:', error);
    return NextResponse.json({ error: 'Error registrando documento' }, { status: 500 });
  }
}
