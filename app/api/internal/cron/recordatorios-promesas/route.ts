/**
 * Cron: recordatorios de promesas de pago (Asistente Cobros tareas #3/#4/#12).
 *
 * Sugerido: corre cada manana 7:30 AM AST, antes del empuje matutino 8:00 AM.
 * Genera tareas en /tareas para promesas que vencen hoy, ayer/anteayer
 * (verificar) e incumplidas hace mas de 2 dias.
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/recordatorios-promesas
 *   Method: POST
 *   Header: x-internal-secret: <valor de INTERNAL_CRON_SECRET en Dokploy>
 *   Cron:   30 11 * * *   (7:30 AM AST = 11:30 UTC)
 */

import { NextRequest, NextResponse } from 'next/server';
import { ejecutarRecordatoriosPromesas } from '@/lib/queue/jobs/recordatorios-promesas';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarRecordatoriosPromesas();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/recordatorios-promesas]', error);
    return NextResponse.json(
      { error: 'Error ejecutando recordatorios de promesas' },
      { status: 500 }
    );
  }
}
