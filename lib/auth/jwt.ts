import jwt from 'jsonwebtoken';

const TOKEN_EXPIRY = '24h';

// Sin fallback: si el secreto falta o es débil, la auth no funciona (fail-closed).
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET no está configurado o tiene menos de 32 caracteres. ' +
        'Genera uno con: openssl rand -base64 48'
    );
  }
  return secret;
}

export interface JwtPayload {
  userId: number;
  email: string;
  nombre: string;
  rol: 'ADMIN' | 'SUPERVISOR' | 'COBRADOR';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  // getJwtSecret() fuera del try: un error de configuración debe propagarse,
  // solo un token inválido/expirado devuelve null.
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
