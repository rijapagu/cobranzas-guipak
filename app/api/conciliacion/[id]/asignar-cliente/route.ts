import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion } from '@/lib/tenant';
import { asignarClienteADeposito } from '@/lib/conciliacion/acciones';

const asignarSchema = z.object({
  codigo_cliente: z.string().min(1),
  nombre_cliente: z.string().min(1),
});

/**
 * POST /api/conciliacion/[id]/asignar-cliente
 * Asigna cliente a entrada DESCONOCIDA.
 * CP-05: Primera vez siempre MANUAL.
 * CP-08: Log.
 *
 * La lógica vive en lib/conciliacion/acciones.ts — compartida con la tool
 * asignar_deposito_a_cliente del agente conversacional, para que CP-05/CP-08
 * no puedan divergir entre la web y el chat.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores' }, { status: 403 });
    }

    const { id } = await params;
    const entryId = Number(id);
    const body = await request.json();
    const parsed = asignarSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'codigo_cliente y nombre_cliente requeridos' }, { status: 400 });
    }

    const { codigo_cliente, nombre_cliente } = parsed.data;

    const resultado = await asignarClienteADeposito(
      entryId,
      codigo_cliente,
      nombre_cliente,
      { userId: session.userId.toString(), userEmail: session.email },
      empresaIdDeSesion(session)
    );

    if (!resultado.ok) {
      const status = resultado.mensaje.includes('no encontrado') ? 404 : 400;
      return NextResponse.json({ error: resultado.mensaje }, { status });
    }

    return NextResponse.json({
      message: `Cliente asignado: ${nombre_cliente}`,
      nuevo_estado: 'POR_APLICAR',
    });
  } catch (error) {
    console.error('[CONCILIACION-ASIGNAR] Error:', error);
    return NextResponse.json({ error: 'Error asignando cliente' }, { status: 500 });
  }
}
