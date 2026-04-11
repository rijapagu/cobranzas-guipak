import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import crypto from 'crypto';

/**
 * POST /api/cobranzas/portal/generar-token
 * Genera un token de acceso al portal de autogestión para un cliente.
 * CP-07: Token único con expiración de 30 días.
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

    // Generar token único — CP-07
    const rawToken = crypto.randomUUID();
    const hmac = crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || 'default-secret');
    hmac.update(rawToken);
    const token = `${rawToken}-${hmac.digest('hex').substring(0, 12)}`;

    // Expiración 30 días
    const expiracion = new Date();
    expiracion.setDate(expiracion.getDate() + 30);

    // Desactivar tokens previos del mismo cliente
    await cobranzasExecute(
      'UPDATE cobranza_portal_tokens SET activo = 0 WHERE codigo_cliente = ? AND activo = 1',
      [codigo_cliente]
    );

    // Insertar nuevo token
    const result = await cobranzasExecute(
      `INSERT INTO cobranza_portal_tokens (codigo_cliente, token, fecha_expiracion, activo)
       VALUES (?, ?, ?, 1)`,
      [codigo_cliente, token, expiracion]
    );

    const baseUrl = process.env.NEXTAUTH_URL || 'https://cobros.sguipak.com';
    const portalUrl = `${baseUrl}/portal/${token}`;

    await logAccion(session.email, 'TOKEN_PORTAL_GENERADO', 'portal_token', result.insertId.toString(), {
      codigo_cliente, expiracion: expiracion.toISOString(),
    });

    return NextResponse.json({
      token,
      url: portalUrl,
      expiracion: expiracion.toISOString(),
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
     WHERE codigo_cliente = ?
     ORDER BY created_at DESC
     LIMIT 5`,
    [codigo]
  );

  return NextResponse.json({ tokens });
}
