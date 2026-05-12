import { NextRequest, NextResponse } from 'next/server';
import { listPdfsInFolder } from '@/lib/drive/client';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery } from '@/lib/db/softec';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const stats = await scanDriveFacturas();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error('[scan-drive-facturas] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function scanDriveFacturas() {
  const stats = { encontrados: 0, nuevos: 0, yaExistentes: 0, sinFactura: 0 };

  const archivos = await listPdfsInFolder(200);
  stats.encontrados = archivos.length;

  if (archivos.length === 0) {
    console.log('[scan-drive] Sin archivos PDF en carpeta de facturas');
    return stats;
  }

  const existentes = await cobranzasQuery<{ google_drive_id: string }>(
    'SELECT google_drive_id FROM cobranza_facturas_documentos WHERE google_drive_id IS NOT NULL'
  );
  const yaRegistrados = new Set(existentes.map((e) => e.google_drive_id));

  for (const archivo of archivos) {
    if (yaRegistrados.has(archivo.id)) {
      stats.yaExistentes++;
      continue;
    }

    const ij_inum = extraerNumeroFactura(archivo.name);
    if (!ij_inum) {
      continue;
    }

    const facturas = await softecQuery<{ IJ_CCODE: string; IJ_LOCAL: string }>(
      'SELECT IJ_CCODE, IJ_LOCAL FROM v_cobr_ijnl WHERE IJ_INUM = ? LIMIT 1',
      [ij_inum]
    );

    if (facturas.length === 0) {
      stats.sinFactura++;
      continue;
    }

    const codigoCliente = String(facturas[0].IJ_CCODE).trim();
    const urlPdf = archivo.webViewLink || `https://drive.google.com/file/d/${archivo.id}/view`;

    await cobranzasExecute(
      `INSERT INTO cobranza_facturas_documentos
         (ij_local, ij_inum, codigo_cliente, google_drive_id, url_pdf, nombre_archivo, fecha_escaneo, origen)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'SCAN_DRIVE')`,
      [
        facturas[0].IJ_LOCAL || '01',
        ij_inum,
        codigoCliente,
        archivo.id,
        urlPdf,
        archivo.name,
        archivo.createdTime ? new Date(archivo.createdTime) : new Date(),
      ]
    );

    await cobranzasExecute(
      `UPDATE cobranza_gestiones SET tiene_pdf = 1, url_pdf = ?
       WHERE ij_inum = ? AND estado IN ('PENDIENTE', 'APROBADO')`,
      [urlPdf, ij_inum]
    );

    stats.nuevos++;
  }

  console.log(
    `[scan-drive] ${stats.encontrados} archivos | ${stats.nuevos} nuevos | ${stats.yaExistentes} ya existentes | ${stats.sinFactura} sin factura en Softec`
  );

  if (stats.nuevos > 0) {
    await logAccion('sistema', 'SCAN_DRIVE_FACTURAS', 'sistema', 'run', stats);
  }

  return stats;
}

function extraerNumeroFactura(filename: string): number | null {
  const match = filename.match(/^(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return num > 0 ? num : null;
}
