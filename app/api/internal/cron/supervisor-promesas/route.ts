/**
 * Cron: despertador del Supervisor Cobros — "promesa grande incumplida" (#3).
 *
 * Sugerido: 1:35 AM AST (5:35 UTC), tras el scoring y el despertador top-10.
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/supervisor-promesas
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   35 5 * * *   (1:35 AM AST = 5:35 UTC)
 *
 * Requisitos:
 *   - Migraciones 025 y 026 aplicadas.
 *   - GATEWAY_BASE_URL accesible desde el VPS; modelo SUPERVISOR_LOCAL_MODEL listo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarSupervisorPromesas } from '@/lib/queue/jobs/supervisor-promesas';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarSupervisorPromesas();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/supervisor-promesas]', error);
    return NextResponse.json(
      { error: 'Error ejecutando despertador de promesas incumplidas' },
      { status: 500 }
    );
  }
}
