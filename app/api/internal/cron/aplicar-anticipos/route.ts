/**
 * Cron: aplicar anticipos pendientes (Asistente Cobros tarea #8).
 *
 * Sugerido: 7:45 AM AST (despues de recordatorios-promesas 7:30, antes del
 * empuje matutino 8:00). Genera tareas en /tareas para que el equipo aplique
 * los anticipos detectados a las facturas pendientes correspondientes.
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/aplicar-anticipos
 *   Method: POST
 *   Header: x-internal-secret: <valor de INTERNAL_CRON_SECRET en Dokploy>
 *   Cron:   45 11 * * *   (7:45 AM AST = 11:45 UTC)
 *
 * Env var opcional:
 *   SALDO_FAVOR_UMBRAL_MIN_DOP   default 1000. Saldos por debajo no generan tarea.
 *
 * Requisito previo: aplicar migracion 023_origen_saldo_favor.sql (anade
 * 'SALDO_FAVOR' al ENUM de cobranza_tareas.origen).
 */

import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarAplicarAnticipos } from '@/lib/queue/jobs/aplicar-anticipos';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarAplicarAnticipos();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/aplicar-anticipos]', error);
    return NextResponse.json(
      { error: 'Error ejecutando aplicar anticipos' },
      { status: 500 }
    );
  }
}
