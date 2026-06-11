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
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarRecordatoriosPromesas } from '@/lib/queue/jobs/recordatorios-promesas';
import { verificarAcuerdos } from '@/lib/queue/jobs/verificar-acuerdos';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Resolver acuerdos PENDIENTE → CUMPLIDO/INCUMPLIDO contra Softec.
    //    Va primero para que las tareas de recordatorio solo se creen sobre
    //    acuerdos que siguen realmente pendientes.
    const acuerdos = await verificarAcuerdos();

    // 2. Crear tareas de recordatorio para lo que sigue pendiente.
    const stats = await ejecutarRecordatoriosPromesas();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      acuerdos_verificados: acuerdos,
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
