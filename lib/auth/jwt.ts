import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-fallback';
const TOKEN_EXPIRY = '24h';

export interface JwtPayload {
  userId: number;
  email: string;
  nombre: string;
  rol: 'ADMIN' | 'SUPERVISOR' | 'COBRADOR';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
