import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { configEmpresaParaUi, guardarConfigEmpresa } from '@/lib/empresas/config';

const ConfigSchema = z.object({
  identidad: z
    .object({
      nombre: z.string().min(2).max(200),
      alias: z.string().min(2).max(60),
      firma: z.string().min(2).max(500),
    })
    .partial()
    .optional(),
  smtp: z
    .object({
      host: z.string().min(3).max(200),
      port: z.number().int().min(1).max(65535),
      user: z.string().min(3).max(200),
      // vacía = conservar la contraseña ya guardada
      pass: z.string().max(200).optional(),
      from: z.string().email().max(200).optional(),
      nombreRemitente: z.string().max(100).optional(),
    })
    .nullable()
    .optional(),
  evolution: z
    .object({
      url: z.string().url().max(300),
      apikey: z.string().max(300).optional(),
      instance: z.string().min(1).max(100),
    })
    .nullable()
    .optional(),
});

/**
 * GET /api/cobranzas/configuracion/empresa
 * Configuración de integraciones de la empresa de la sesión (sin secretos).
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const config = await configEmpresaParaUi(empresaIdDeSesion(session));
  return NextResponse.json(config);
}

/**
 * PUT /api/cobranzas/configuracion/empresa
 * Guarda identidad/SMTP/WhatsApp de la empresa. Solo ADMIN/SUPERVISOR.
 * La empresa 1 (Guipak) se gestiona por variables de entorno → 409.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!['SUPERVISOR', 'ADMIN'].includes(session.rol?.toUpperCase() ?? '')) {
    return NextResponse.json({ error: 'Solo administradores pueden editar la configuración' }, { status: 403 });
  }

  const empresaId = empresaIdDeSesion(session);
  if (empresaId === EMPRESA_GUIPAK) {
    return NextResponse.json(
      { error: 'La configuración de esta empresa se gestiona en el servidor (variables de entorno)' },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', detalle: parsed.error.issues }, { status: 400 });
  }

  try {
    await guardarConfigEmpresa(empresaId, parsed.data);
    await logAccion(String(session.userId), 'CONFIG_EMPRESA_ACTUALIZADA', 'empresa', String(empresaId), {
      secciones: Object.keys(parsed.data),
    }, undefined, empresaId);

    return NextResponse.json({ ok: true, config: await configEmpresaParaUi(empresaId) });
  } catch (error) {
    console.error('[CONFIG-EMPRESA] Error:', error);
    return NextResponse.json({ error: 'Error guardando configuración' }, { status: 500 });
  }
}
