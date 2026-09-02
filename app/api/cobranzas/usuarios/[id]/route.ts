import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { hashPassword } from '@/lib/auth/password';
import {
  sincronizarVinculoTelegram,
  rolTelegramDesdeApp,
  TelegramYaVinculado,
  type RolApp,
} from '@/lib/usuarios/vinculo-telegram';

/**
 * Edición y baja de usuarios. Solo ADMIN, y siempre acotado a la empresa
 * de la sesión.
 *
 * Dos guardas contra dejarse fuera uno mismo: nadie puede cambiarse el rol
 * ni desactivarse. Si el único ADMIN se degrada a COBRADOR, la empresa se
 * queda sin quien administre y volvemos al SQL a mano.
 */

const EditarSchema = z.object({
  nombre: z.string().min(2).max(100).optional(),
  rol: z.enum(['ADMIN', 'SUPERVISOR', 'COBRADOR']).optional(),
  activo: z.union([z.boolean(), z.number()]).transform(v => (v ? 1 : 0)).optional(),
  /** Opcional: si viene, se restablece la contraseña. */
  password: z.string().min(10).max(100).optional(),
  /** Vínculo con Telegram: un número lo crea o actualiza, `null` lo quita. */
  telegram_user_id: z.coerce.number().int().positive().nullable().optional(),
  telegram_username: z.string().max(64).nullable().optional(),
});

/** Devuelve el usuario si pertenece a la empresa de la sesión; si no, null. */
async function usuarioDeLaEmpresa(id: number, empresaId: number) {
  const rows = await cobranzasQuery<{ id: number; email: string; nombre: string; rol: string; activo: number }>(
    'SELECT id, email, nombre, rol, activo FROM usuarios WHERE id = ? AND empresa_id = ? LIMIT 1',
    [id, empresaId]
  );
  return rows[0] ?? null;
}

/**
 * PUT /api/cobranzas/usuarios/[id]
 * Cambia nombre, rol, estado y/o contraseña.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo un administrador puede editar usuarios' }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
  }

  const empresaId = empresaIdDeSesion(session);
  const usuario = await usuarioDeLaEmpresa(idNum, empresaId);
  if (!usuario) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = EditarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const cambios = parsed.data;
  const esUnoMismo = idNum === session.userId;

  if (esUnoMismo && cambios.rol !== undefined && cambios.rol !== usuario.rol) {
    return NextResponse.json(
      { error: 'No puedes cambiar tu propio rol. Pídeselo a otro administrador.' },
      { status: 400 }
    );
  }
  if (esUnoMismo && cambios.activo === 0) {
    return NextResponse.json({ error: 'No puedes desactivarte a ti mismo.' }, { status: 400 });
  }

  // Si se baja al último ADMIN activo, la empresa se queda sin administrador.
  const dejaDeSerAdmin =
    usuario.rol === 'ADMIN' && ((cambios.rol !== undefined && cambios.rol !== 'ADMIN') || cambios.activo === 0);
  if (dejaDeSerAdmin) {
    const otros = await cobranzasQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1 AND id <> ?",
      [empresaId, idNum]
    );
    if ((otros[0]?.n ?? 0) === 0) {
      return NextResponse.json(
        { error: 'Es el único administrador activo. Nombra otro antes de cambiarlo.' },
        { status: 400 }
      );
    }
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (cambios.nombre !== undefined) {
    updates.push('nombre = ?');
    values.push(cambios.nombre);
  }
  if (cambios.rol !== undefined) {
    updates.push('rol = ?');
    values.push(cambios.rol);
  }
  if (cambios.activo !== undefined) {
    updates.push('activo = ?');
    values.push(cambios.activo);
  }
  if (cambios.password !== undefined) {
    updates.push('password_hash = ?');
    values.push(await hashPassword(cambios.password));
  }

  const tocaTelegram = cambios.telegram_user_id !== undefined;
  if (updates.length === 0 && !tocaTelegram) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  if (updates.length > 0) {
    values.push(idNum, empresaId);
    await cobranzasExecute(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ? AND empresa_id = ?`,
      values
    );
  }

  // El rol de Telegram se deriva del rol de la app, así que un cambio de rol
  // o de estado también tiene que bajar al vínculo — si no, alguien degradado
  // a COBRADOR seguiría aprobando desde el chat.
  const rolFinal = cambios.rol ?? (usuario.rol as RolApp);
  const activoFinal = cambios.activo ?? usuario.activo;
  let avisoTelegram: string | undefined;

  try {
    if (tocaTelegram) {
      await sincronizarVinculoTelegram({
        usuarioId: idNum,
        empresaId,
        telegramUserId: cambios.telegram_user_id ?? null,
        telegramUsername: cambios.telegram_username,
        rolApp: rolFinal,
        activo: activoFinal,
      });
    } else if (cambios.rol !== undefined || cambios.activo !== undefined) {
      await cobranzasExecute(
        `UPDATE cobranza_telegram_usuarios SET rol = ?, activo = ?
         WHERE usuario_id = ? AND empresa_id = ?`,
        [rolTelegramDesdeApp(rolFinal), activoFinal, idNum, empresaId]
      );
    }
  } catch (error) {
    avisoTelegram =
      error instanceof TelegramYaVinculado
        ? `Se guardaron los cambios, pero el id de Telegram ${cambios.telegram_user_id} ya está vinculado a otra persona.`
        : 'Se guardaron los cambios, pero no se pudo actualizar el vínculo de Telegram.';
    console.error('[USUARIOS] Error sincronizando Telegram:', error);
  }

  // El detalle nombra los campos tocados, nunca la contraseña.
  await logAccion(
    String(session.userId),
    'USUARIO_EDITADO',
    'usuario',
    String(idNum),
    {
      email: usuario.email,
      campos: Object.keys(cambios),
      password_restablecida: cambios.password !== undefined,
      rol_anterior: cambios.rol !== undefined ? usuario.rol : undefined,
      rol_nuevo: cambios.rol,
      telegram: tocaTelegram
        ? cambios.telegram_user_id === null
          ? 'desvinculado'
          : 'vinculado'
        : undefined,
    },
    undefined,
    empresaId
  );

  return NextResponse.json({ ok: true, aviso: avisoTelegram });
}

/**
 * DELETE /api/cobranzas/usuarios/[id]
 * Baja lógica: deja el usuario en `activo = 0`. No se borra nunca — su rastro
 * en la bitácora y en las gestiones que aprobó tiene que seguir teniendo dueño.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo un administrador puede desactivar usuarios' }, { status: 403 });
  }

  const { id } = await params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
  }
  if (idNum === session.userId) {
    return NextResponse.json({ error: 'No puedes desactivarte a ti mismo.' }, { status: 400 });
  }

  const empresaId = empresaIdDeSesion(session);
  const usuario = await usuarioDeLaEmpresa(idNum, empresaId);
  if (!usuario) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (usuario.rol === 'ADMIN') {
    const otros = await cobranzasQuery<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usuarios WHERE empresa_id = ? AND rol = 'ADMIN' AND activo = 1 AND id <> ?",
      [empresaId, idNum]
    );
    if ((otros[0]?.n ?? 0) === 0) {
      return NextResponse.json(
        { error: 'Es el único administrador activo. Nombra otro antes de desactivarlo.' },
        { status: 400 }
      );
    }
  }

  await cobranzasExecute(
    'UPDATE usuarios SET activo = 0 WHERE id = ? AND empresa_id = ?',
    [idNum, empresaId]
  );

  // Quitar el acceso tiene que cerrar las dos puertas: si el vínculo de
  // Telegram queda activo, la persona sigue operando desde el chat.
  await cobranzasExecute(
    'UPDATE cobranza_telegram_usuarios SET activo = 0 WHERE usuario_id = ? AND empresa_id = ?',
    [idNum, empresaId]
  );

  await logAccion(
    String(session.userId),
    'USUARIO_DESACTIVADO',
    'usuario',
    String(idNum),
    { email: usuario.email, nombre: usuario.nombre },
    undefined,
    empresaId
  );

  return NextResponse.json({ ok: true });
}
