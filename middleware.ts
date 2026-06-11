import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Rutas públicas exactas (login) y por prefijo. Las rutas bajo estos prefijos
// validan su propio secreto internamente (webhooks, crons) o son públicas por
// diseño con token propio (portal de clientes).
const PUBLIC_EXACT = ['/login', '/api/auth/login'];
const PUBLIC_PREFIXES = ['/portal/', '/api/portal/', '/api/webhooks/', '/api/internal/'];

// Solo assets estáticos reales, nunca rutas /api/. Un punto en la URL ya no
// exime de autenticación (antes era un bypass de auth).
const STATIC_EXT = /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff2?)$/i;

async function verifyJwt(token: string): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    // Fail-closed: sin secreto válido nadie pasa.
    throw new Error('JWT_SECRET no está configurado o tiene menos de 32 caracteres');
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_EXACT.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    (!pathname.startsWith('/api/') && STATIC_EXT.test(pathname))
  ) {
    return NextResponse.next();
  }

  // Protección CSRF: en mutaciones autenticadas por cookie, el Origin del
  // navegador debe coincidir con el host. Una página maliciosa que dispare
  // un POST con la cookie de la víctima envía su propio Origin y se bloquea.
  // (Si Origin no viene — clientes no-navegador — se permite: esos clientes
  // no llevan la cookie de sesión.)
  const metodo = request.method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo)) {
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== request.nextUrl.host) {
          return NextResponse.json({ error: 'Origin no permitido' }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: 'Origin inválido' }, { status: 403 });
      }
    }
  }

  const token = request.cookies.get('cobranzas_token')?.value;
  const valido = token ? await verifyJwt(token) : false;

  if (!valido) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(loginUrl);
    if (token) response.cookies.delete('cobranzas_token');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
