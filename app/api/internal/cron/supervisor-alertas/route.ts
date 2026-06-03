/**
 * Cron: despertador del Supervisor Cobros — "top-10 cliente cruza umbral" (#2).
 *
 * Corre DESPUÉS del scoring nocturno (inteligencia-clientes, 1 AM AST).
 * Sugerido: 1:30 AM AST (5:30 UTC).
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/supervisor-alertas
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   30 5 * * *   (1:30 AM AST = 5:30 UTC)
 *
 * Requisitos:
 *   - Migración 025_supervisor_alertas.sql aplicada.
 *   - GATEWAY_BASE_URL apuntando al gateway IA (Robocop) accesible desde el VPS.
 *   - Modelo SUPERVISOR_LOCAL_MODEL disponible en Ollama (default deepseek-analyst).
 */

import { NextRequest, NextResponse } from 'next/server';
import { ejecutarSupervisorAlertas } from '@/lib/queue/jobs/supervisor-alertas';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarSupervisorAlertas();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/supervisor-alertas]', error);
    return NextResponse.json(
      { error: 'Error ejecutando despertador del Supervisor' },
      { status: 500 }
    );
  }
}
