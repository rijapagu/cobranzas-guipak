import { NextRequest, NextResponse } from 'next/server';
import { ejecutarCadenciasHorarias } from '@/lib/queue/jobs/cadencias';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
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
