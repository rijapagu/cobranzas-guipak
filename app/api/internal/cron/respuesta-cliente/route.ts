/**
 * Cron: detectar mensajes entrantes de clientes sin respuesta (Asistente #5).
 *
 * Sugerido: cada 30 min (mas frecuente que los otros crons porque mensaje
 * entrante = atencion rapida). Detecta entrantes en ventana de 4h sin
 * respuesta del equipo y crea tarea en /tareas.
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/respuesta-cliente
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   star slash 30 espacio asterisco * * *   (cada 30 min)
 *
 * Env var opcional:
 *   RESPUESTA_CLIENTE_VENTANA_HORAS   default 4
 *
 * Requisito: migracion 024_origenes_asistente_resto.sql aplicada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarRespuestaCliente } from '@/lib/queue/jobs/respuesta-cliente';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarRespuestaCliente();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/respuesta-cliente]', error);
    return NextResponse.json(
      { error: 'Error ejecutando respuesta-cliente' },
      { status: 500 }
    );
  }
}
