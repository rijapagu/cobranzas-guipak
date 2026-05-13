import { NextRequest, NextResponse } from 'next/server';
import { ejecutarInteligenciaClientes } from '@/lib/queue/jobs/inteligencia-clientes';

/**
 * POST /api/internal/cron/inteligencia-clientes
 * Endpoint para disparo manual del job de scoring (Dokploy cron o admin).
 * Protegido con CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const resultado = await ejecutarInteligenciaClientes();
    return NextResponse.json({ ok: true, ...resultado });
  } catch (error) {
    console.error('[cron/inteligencia-clientes]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: 'POST con header x-cron-secret para ejecutar el scoring de inteligencia de clientes',
  });
}
