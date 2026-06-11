import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarCadenciasHorarias } from '@/lib/queue/jobs/cadencias';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const stats = await ejecutarCadenciasHorarias();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error('[cron/cadencias-horarias] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
