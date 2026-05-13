import { NextRequest, NextResponse } from 'next/server';
import { enviarReporteDiario } from '@/lib/reportes/reporte-diario';
import { logAccion } from '@/lib/db/cobranzas';

/**
 * POST /api/internal/cron/reporte-diario
 * Genera y envía el reporte diario de cobranzas por email.
 * Autenticado con INTERNAL_CRON_SECRET.
 *
 * Configurar en Dokploy como cron:
 *   Schedule: 0 12 * * 1-5   (8:00 AM AST = 12:00 UTC, lunes a viernes)
 *   URL: POST https://cobros.sguipak.com/api/internal/cron/reporte-diario
 *   Header: x-cron-secret: <INTERNAL_CRON_SECRET>
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const resultado = await enviarReporteDiario();

    await logAccion(
      'sistema',
      'REPORTE_DIARIO_ENVIADO',
      'sistema',
      'reporte-diario',
      {
        ok: resultado.ok,
        destinatario: resultado.destinatario,
        error: resultado.error,
      }
    );

    if (!resultado.ok) {
      console.error('[cron/reporte-diario] Fallo al enviar:', resultado.error);
      return NextResponse.json({ ok: false, error: resultado.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, destinatario: resultado.destinatario });
  } catch (error) {
    console.error('[cron/reporte-diario] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    );
  }
}
