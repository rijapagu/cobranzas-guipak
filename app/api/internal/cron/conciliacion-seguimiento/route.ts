import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { verificarDesconocidos, recordatorioChequesDevueltos } from '@/lib/conciliacion/seguimiento';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
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
