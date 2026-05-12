import { NextRequest, NextResponse } from 'next/server';
import { verificarDesconocidos, recordatorioChequesDevueltos } from '@/lib/conciliacion/seguimiento';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [resultado, recordatorios] = await Promise.all([
      verificarDesconocidos(),
      recordatorioChequesDevueltos(),
    ]);

    return NextResponse.json({
      ok: true,
      ejecutado: new Date().toISOString(),
      desconocidos: resultado,
      recordatorios_cheques: recordatorios,
    });
  } catch (error) {
    console.error('[cron/conciliacion-seguimiento]', error);
    return NextResponse.json(
      { error: 'Error ejecutando seguimiento de conciliación' },
      { status: 500 }
    );
  }
}
