/**
 * Cron: detectar correos/WAs enviados sin respuesta (Asistente Cobros #11).
 *
 * Sugerido: 8:30 AM AST. Detecta gestiones aprobadas hace >=5 dias (config)
 * sin respuesta del cliente y sin gestion posterior — el correo se "perdio"
 * y hay que cerrar el loop manualmente (re-enviar por otro canal, llamar).
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/sin-respuesta
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   30 12 * * *   (8:30 AM AST = 12:30 UTC)
 *
 * Env var opcional:
 *   SIN_RESPUESTA_DIAS_UMBRAL   default 5 dias
 *
 * Requisito: migracion 024_origenes_asistente_resto.sql aplicada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ejecutarSinRespuesta } from '@/lib/queue/jobs/sin-respuesta';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarSinRespuesta();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/sin-respuesta]', error);
    return NextResponse.json(
      { error: 'Error ejecutando deteccion sin-respuesta' },
      { status: 500 }
    );
  }
}
