import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { generarTokenPortal } from '@/lib/cobranzas/portal';

/**
 * POST /api/cobranzas/portal/generar-token
 * Genera un token de acceso al portal de autogestión para un cliente.
 * CP-07: Token único con expiración de 30 días.
 *
 * La lógica vive en lib/cobranzas/portal.ts — compartida con la tool
 * generar_link_portal del agente conversacional.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { codigo_cliente } = await request.json();

    if (!codigo_cliente) {
      return NextResponse.json({ error: 'codigo_cliente requerido' }, { status: 400 });
    }

    const resultado = await generarTokenPortal(
      codigo_cliente,
      { userId: session.email, userEmail: session.email },
      empresaIdDeSesion(session)
    );

    return NextResponse.json({
      token: resultado.token,
      url: resultado.url,
      expiracion: resultado.expiracion,
    });
  } catch (error) {
    console.error('[PORTAL-TOKEN] Error:', error);
    return NextResponse.json({ error: 'Error generando token' }, { status: 500 });
  }
}

/**
 * GET /api/cobranzas/portal/generar-token?codigo_cliente=X
 * Lista tokens activos de un cliente.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const codigo = request.nextUrl.searchParams.get('codigo_cliente');
  if (!codigo) {
    return NextResponse.json({ error: 'codigo_cliente requerido' }, { status: 400 });
  }

  const tokens = await cobranzasQuery<{
    id: number;
    token: string;
    fecha_expiracion: string;
    activo: number;
    ultimo_acceso: string | null;
    created_at: string;
  }>(
    `SELECT id, token, fecha_expiracion, activo, ultimo_acceso, created_at
     FROM cobranza_portal_tokens
     WHERE codigo_cliente = ? AND empresa_id = ?
     ORDER BY created_at DESC
     LIMIT 5`,
    [codigo, empresaIdDeSesion(session)]
  );

  return NextResponse.json({ tokens });
}
