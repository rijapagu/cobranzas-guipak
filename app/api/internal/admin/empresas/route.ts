import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { esRequestAdminValido } from '@/lib/auth/internal';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { hashPassword } from '@/lib/auth/password';
import { invalidarCacheErp } from '@/lib/erp';

const AltaSchema = z.object({
  nombre: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'slug en minúsculas, números y guiones'),
  rnc: z.string().max(20).optional(),
  erp_tipo: z.enum(['CSV', 'NINGUNO']).default('CSV'),
  plan: z.enum(['ESTANDAR', 'PREMIUM']).default('ESTANDAR'),
  admin_email: z.string().email().max(200),
  admin_nombre: z.string().min(2).max(100),
  admin_password: z.string().min(10).max(100),
});

/**
 * POST /api/internal/admin/empresas
 * Alta de un tenant: crea la empresa + su primer usuario ADMIN.
 * (Onboarding manual hasta la Etapa 6 — self-service.)
 *
 * Auth: header `x-internal-secret` = INTERNAL_ADMIN_SECRET (igual que /migrate).
 *
 * GET lista las empresas (id, nombre, slug, erp_tipo, activa) para el operador.
 */
export async function POST(req: NextRequest) {
  if (!esRequestAdminValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AltaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }
  const alta = parsed.data;

  try {
    // Unicidad previa con mensajes claros (slug y email)
    const slugExiste = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM empresas WHERE slug = ? LIMIT 1',
      [alta.slug]
    );
    if (slugExiste.length > 0) {
      return NextResponse.json({ error: `Ya existe una empresa con slug "${alta.slug}"` }, { status: 409 });
    }
    const emailExiste = await cobranzasQuery<{ id: number }>(
      'SELECT id FROM usuarios WHERE email = ? LIMIT 1',
      [alta.admin_email]
    );
    if (emailExiste.length > 0) {
      return NextResponse.json({ error: `Ya existe un usuario con email ${alta.admin_email}` }, { status: 409 });
    }

    const empresa = await cobranzasExecute(
      `INSERT INTO empresas (nombre, slug, rnc, activa, plan, modo_datos, erp_tipo)
       VALUES (?, ?, ?, 1, ?, 'COMPARTIDA', ?)`,
      [alta.nombre, alta.slug, alta.rnc ?? null, alta.plan, alta.erp_tipo]
    );
    const empresaId = empresa.insertId;

    const passwordHash = await hashPassword(alta.admin_password);
    const usuario = await cobranzasExecute(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, activo, empresa_id)
       VALUES (?, ?, ?, 'ADMIN', 1, ?)`,
      [alta.admin_email, alta.admin_nombre, passwordHash, empresaId]
    );

    invalidarCacheErp(empresaId);
    await logAccion(null, 'EMPRESA_CREADA', 'empresa', String(empresaId), {
      nombre: alta.nombre,
      slug: alta.slug,
      erp_tipo: alta.erp_tipo,
      admin_email: alta.admin_email,
    }, undefined, empresaId);

    return NextResponse.json({
      ok: true,
      empresa_id: empresaId,
      usuario_admin_id: usuario.insertId,
      siguiente_paso:
        'El admin puede entrar en /login, configurar SMTP/WhatsApp en /configuracion/empresa e importar su cartera en /configuracion/importar-cartera.',
    });
  } catch (error) {
    console.error('[ALTA-EMPRESA] Error:', error);
    return NextResponse.json({ error: 'Error creando empresa' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!esRequestAdminValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const empresas = await cobranzasQuery(
    'SELECT id, nombre, slug, rnc, activa, plan, modo_datos, erp_tipo, created_at FROM empresas ORDER BY id'
  );
  return NextResponse.json({ empresas });
}
