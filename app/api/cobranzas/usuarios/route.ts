import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { hashPassword } from '@/lib/auth/password';
import { sincronizarVinculoTelegram, TelegramYaVinculado } from '@/lib/usuarios/vinculo-telegram';

/**
 * Gestión de usuarios del equipo.
 *
 * Hasta ahora dar de alta a alguien exigía dos INSERT a mano contra la base
 * (uno en `usuarios` con el hash de bcrypt generado aparte), así que en la
 * práctica no se podía delegar. Esto lo abre desde la aplicación.
 *
 * Solo ADMIN: crear un usuario es repartir acceso al sistema, no configurar
 * una plantilla. Un SUPERVISOR puede aprobar cobros pero no decidir quién más
 * entra.
 *
 * Todo va acotado por `empresa_id` de la sesión — un ADMIN de un tenant no ve
 * ni toca los usuarios de otro.
 */

const CrearSchema = z.object({
  email: z.string().email().max(200),
  nombre: z.string().min(2).max(100),
  password: z.string().min(10).max(100),
  rol: z.enum(['ADMIN', 'SUPERVISOR', 'COBRADOR']).default('COBRADOR'),
  activo: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).default(1),
  /** Opcional: si viene, además se le da acceso al bot de Telegram. */
  telegram_user_id: z.coerce.number().int().positive().nullable().optional(),
  telegram_username: z.string().max(64).nullable().optional(),
});

/**
 * GET /api/cobranzas/usuarios
 * Lista los usuarios de la empresa. Nunca devuelve el hash de la contraseña.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo un administrador puede ver los usuarios' }, { status: 403 });
  }

  const usuarios = await cobranzasQuery(
    `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.ultimo_login, u.created_at,
            t.telegram_user_id, t.telegram_username, t.rol AS telegram_rol
     FROM usuarios u
     LEFT JOIN cobranza_telegram_usuarios t
            ON t.usuario_id = u.id AND t.empresa_id = u.empresa_id
     WHERE u.empresa_id = ?
     ORDER BY u.activo DESC, FIELD(u.rol, 'ADMIN', 'SUPERVISOR', 'COBRADOR'), u.nombre`,
    [empresaIdDeSesion(session)]
  );

  return NextResponse.json({ usuarios });
}

/**
 * POST /api/cobranzas/usuarios
 * Crea un usuario nuevo en la empresa de la sesión.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo un administrador puede crear usuarios' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = CrearSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const u = parsed.data;
  const email = u.email.trim().toLowerCase();

  // El email es único a nivel global, no por empresa: si ya existe en otro
  // tenant el INSERT falla igual, así que se avisa antes y con claridad.
  const existe = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
    [email]
  );
  if (existe.length > 0) {
    return NextResponse.json({ error: `Ya existe un usuario con el correo ${email}` }, { status: 409 });
  }

  const passwordHash = await hashPassword(u.password);
  const empresaId = empresaIdDeSesion(session);

  let id: number;
  try {
    const result = await cobranzasExecute(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, activo, empresa_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, u.nombre, passwordHash, u.rol, u.activo, empresaId]
    );
    id = result.insertId;
  } catch (error) {
    // La comprobación de arriba cubre el caso normal; esto atrapa la carrera
    // entre dos altas simultáneas del mismo correo.
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: `Ya existe un usuario con el correo ${email}` }, { status: 409 });
    }
    console.error('[USUARIOS] Error creando usuario:', error);
    return NextResponse.json({ error: 'Error creando el usuario' }, { status: 500 });
  }

  // El vínculo de Telegram va aparte y no debe tumbar el alta: si falla, el
  // usuario ya existe y puede entrar a la web; se avisa para que se reintente.
  let avisoTelegram: string | undefined;
  if (u.telegram_user_id) {
    try {
      await sincronizarVinculoTelegram({
        usuarioId: id,
        empresaId,
        telegramUserId: u.telegram_user_id,
        telegramUsername: u.telegram_username,
        rolApp: u.rol,
        activo: u.activo,
      });
    } catch (error) {
      avisoTelegram =
        error instanceof TelegramYaVinculado
          ? `El usuario se creó, pero el id de Telegram ${u.telegram_user_id} ya está vinculado a otra persona.`
          : 'El usuario se creó, pero no se pudo vincular su Telegram.';
      console.error('[USUARIOS] Error vinculando Telegram:', error);
    }
  }

  await logAccion(
    String(session.userId),
    'USUARIO_CREADO',
    'usuario',
    String(id),
    {
      email,
      nombre: u.nombre,
      rol: u.rol,
      activo: u.activo,
      telegram_vinculado: Boolean(u.telegram_user_id) && !avisoTelegram,
    },
    undefined,
    empresaId
  );

  return NextResponse.json({ ok: true, id, aviso: avisoTelegram });
}
