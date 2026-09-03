/**
 * Generación de tokens de acceso al portal de autogestión del cliente.
 * Extraído de app/api/cobranzas/portal/generar-token/route.ts para
 * compartirlo con la tool conversacional generar_link_portal.
 * CP-07: token único con expiración de 30 días.
 */
import { cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import crypto from 'crypto';

export interface ActorPortal {
  userId: string;
  userEmail: string;
}

export interface ResultadoTokenPortal {
  ok: boolean;
  mensaje: string;
  token?: string;
  url?: string;
  expiracion?: string;
}

export async function generarTokenPortal(
  codigoCliente: string,
  actor: ActorPortal,
  empresaId: number = EMPRESA_GUIPAK
): Promise<ResultadoTokenPortal> {
  const rawToken = crypto.randomUUID();
  const hmac = crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET || 'default-secret');
  hmac.update(rawToken);
  const token = `${rawToken}-${hmac.digest('hex').substring(0, 12)}`;

  const expiracion = new Date();
  expiracion.setDate(expiracion.getDate() + 30);

  await cobranzasExecute(
    'UPDATE cobranza_portal_tokens SET activo = 0 WHERE codigo_cliente = ? AND empresa_id = ? AND activo = 1',
    [codigoCliente, empresaId]
  );

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_portal_tokens (empresa_id, codigo_cliente, token, fecha_expiracion, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [empresaId, codigoCliente, token, expiracion]
  );

  const baseUrl = process.env.NEXTAUTH_URL || 'https://cobros.sguipak.com';
  const portalUrl = `${baseUrl}/portal/${token}`;

  await logAccion(actor.userId, 'TOKEN_PORTAL_GENERADO', 'portal_token', result.insertId.toString(), {
    codigo_cliente: codigoCliente,
    expiracion: expiracion.toISOString(),
  });

  return {
    ok: true,
    mensaje: `Link del portal para ${codigoCliente}, válido 30 días.`,
    token,
    url: portalUrl,
    expiracion: expiracion.toISOString(),
  };
}
