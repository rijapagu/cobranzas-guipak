/**
 * Cron: delegación Supervisor→Asistente — "lote de cobranza dirigida".
 *
 * El Supervisor encola borradores de correo para una cohorte estratégica (top por
 * exposición, ROJO/CRÍTICO y empeorando) y notifica al CEO. El equipo aprueba.
 *
 * Sugerido: semanal, lunes 6:00 AM AST (10:00 UTC).
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/supervisor-lote
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   0 10 * * 1   (lunes 6:00 AM AST = 10:00 UTC)
 *
 * Requisitos: migraciones 025/026/027 aplicadas; GATEWAY_BASE_URL accesible;
 * SUPERVISOR_BOT_TOKEN configurado; plantillas de correo activas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ejecutarSupervisorLote } from '@/lib/queue/jobs/supervisor-lote';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarSupervisorLote();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/supervisor-lote]', error);
    return NextResponse.json(
      { error: 'Error ejecutando lote de cobranza dirigida' },
      { status: 500 }
    );
  }
}
