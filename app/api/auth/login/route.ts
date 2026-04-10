import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { verifyPassword } from '@/lib/auth/password';
import { signToken } from '@/lib/auth/jwt';
import { getTokenCookieOptions } from '@/lib/auth/session';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface UserRow {
  id: number;
  email: string;
  nombre: string;
  password_hash: string;
  rol: 'ADMIN' | 'SUPERVISOR' | 'COBRADOR';
  activo: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    const users = await cobranzasQuery<UserRow>(
      'SELECT id, email, nombre, password_hash, rol, activo FROM usuarios WHERE email = ? LIMIT 1',
      [email]
    );

    if (users.length === 0) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      );
    }

    const user = users[0];

    if (!user.activo) {
      return NextResponse.json(
        { error: 'Usuario desactivado' },
        { status: 403 }
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Credenciales inválidas' },
        { status: 401 }
      );
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      nombre: user.nombre,
      rol: user.rol,
    });

    await cobranzasExecute(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?',
      [user.id]
    );

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
    });

    response.cookies.set(getTokenCookieOptions(token));
    return response;
  } catch (error) {
    console.error('[AUTH] Error en login:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
