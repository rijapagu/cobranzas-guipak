/**
 * Cron: detectar clientes vencidos sin datos de contacto (Asistente Cobros #9).
 *
 * Sugerido: 8:15 AM AST (despues del empuje matutino 8:00).
 *
 * Configurar en Dokploy Scheduled Jobs:
 *   URL:    https://cobros.sguipak.com/api/internal/cron/datos-faltantes
 *   Method: POST
 *   Header: x-internal-secret: <INTERNAL_CRON_SECRET>
 *   Cron:   15 12 * * *   (8:15 AM AST = 12:15 UTC)
 *
 * Env vars opcionales:
 *   DATOS_FALTANTES_SALDO_MIN_DOP    default 10000. Umbral minimo saldo neto.
 *   DATOS_FALTANTES_SALDO_ALTA_DOP   default 100000. Umbral para prioridad ALTA.
 *
 * Requisito: migracion 024_origenes_asistente_resto.sql aplicada.
 */

import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarDatosFaltantes } from '@/lib/queue/jobs/datos-faltantes';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const stats = await ejecutarDatosFaltantes();
    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      stats,
    });
  } catch (error) {
    console.error('[cron/datos-faltantes]', error);
    return NextResponse.json(
      { error: 'Error ejecutando deteccion de datos faltantes' },
      { status: 500 }
    );
  }
}
