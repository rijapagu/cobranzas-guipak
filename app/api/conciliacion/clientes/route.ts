import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { empresaIdDeSesion } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import type { ClienteOption } from '@/lib/types/conciliacion';

/**
 * GET /api/conciliacion/clientes
 * Clientes reales de la cartera, para el selector de "asignar cliente" en
 * la pantalla de Conciliación — antes usaba lib/mock/conciliacion-mock.ts
 * (10 clientes ficticios hardcodeados), así que incluso la vía web de
 * asignación no ofrecía la cartera real.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const empresaId = empresaIdDeSesion(session);
    const adapter = await adaptadorParaEmpresa(empresaId);
    const clientes = await adapter.clientes();

    const opciones: ClienteOption[] = clientes.map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre,
    }));

    return NextResponse.json({ clientes: opciones });
  } catch (error) {
    console.error('[CONCILIACION-CLIENTES] Error:', error);
    return NextResponse.json({ clientes: [] });
  }
}
