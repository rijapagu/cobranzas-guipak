import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { ejecutarEmpujeMatutino } from '@/lib/queue/jobs/empuje-matutino';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ejecutarEmpujeMatutino();
    return NextResponse.json({ ok: true, ejecutado: new Date().toISOString() });
  } catch (error) {
    console.error('[cron/empuje-matutino]', error);
    return NextResponse.json(
      { error: 'Error ejecutando empuje matutino' },
      { status: 500 }
    );
  }
}
