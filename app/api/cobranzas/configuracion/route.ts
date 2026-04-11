import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';

/**
 * GET /api/cobranzas/configuracion
 * Retorna el estado actual de las integraciones (sin exponer passwords).
 * Solo ADMIN puede acceder.
 */
export async function GET() {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  const config = {
    softec: {
      host: process.env.DB_SOFTEC_HOST || '',
      port: Number(process.env.DB_SOFTEC_PORT) || 3306,
      database: process.env.DB_SOFTEC_NAME || 'guipak',
      user: process.env.DB_SOFTEC_USER || '',
      hasPassword: !!process.env.DB_SOFTEC_PASS,
      configured: !!(process.env.DB_SOFTEC_HOST && process.env.DB_SOFTEC_USER && process.env.DB_SOFTEC_PASS),
    },
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER || '',
      from: process.env.SMTP_FROM || '',
      hasPassword: !!process.env.SMTP_PASS,
      configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    },
    evolution: {
      url: process.env.EVOLUTION_API_URL || '',
      instance: process.env.EVOLUTION_INSTANCE || '',
      hasApiKey: !!process.env.EVOLUTION_API_KEY,
      configured: !!(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY),
    },
    claude: {
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      configured: !!process.env.ANTHROPIC_API_KEY,
    },
    drive: {
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  };

  return NextResponse.json(config);
}

/**
 * PUT /api/cobranzas/configuracion
 * Actualiza variables de entorno en runtime.
 * NOTA: Los cambios se pierden al reiniciar. Para persistir, configurar en Dokploy.
 * Solo ADMIN puede modificar.
 */
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { seccion, valores } = body;

    if (!seccion || !valores) {
      return NextResponse.json({ error: 'seccion y valores requeridos' }, { status: 400 });
    }

    const envMap: Record<string, Record<string, string>> = {
      softec: {
        host: 'DB_SOFTEC_HOST',
        port: 'DB_SOFTEC_PORT',
        database: 'DB_SOFTEC_NAME',
        user: 'DB_SOFTEC_USER',
        password: 'DB_SOFTEC_PASS',
      },
      smtp: {
        host: 'SMTP_HOST',
        port: 'SMTP_PORT',
        user: 'SMTP_USER',
        password: 'SMTP_PASS',
        from: 'SMTP_FROM',
      },
      evolution: {
        url: 'EVOLUTION_API_URL',
        apiKey: 'EVOLUTION_API_KEY',
        instance: 'EVOLUTION_INSTANCE',
      },
      claude: {
        apiKey: 'ANTHROPIC_API_KEY',
      },
      drive: {
        clientId: 'GOOGLE_CLIENT_ID',
        clientSecret: 'GOOGLE_CLIENT_SECRET',
        refreshToken: 'GOOGLE_REFRESH_TOKEN',
        folderId: 'GOOGLE_DRIVE_FOLDER_ID',
      },
    };

    const mapping = envMap[seccion];
    if (!mapping) {
      return NextResponse.json({ error: 'Sección no válida' }, { status: 400 });
    }

    // Actualizar variables en runtime
    const actualizadas: string[] = [];
    for (const [key, value] of Object.entries(valores)) {
      const envVar = mapping[key];
      if (envVar && typeof value === 'string' && value.trim()) {
        process.env[envVar] = value.trim();
        actualizadas.push(key);
      }
    }

    await logAccion(session.email, 'CONFIGURACION_ACTUALIZADA', 'config', seccion, {
      campos_actualizados: actualizadas,
      nota: 'Cambio en runtime — reiniciar para aplicar permanentemente en Dokploy',
    });

    return NextResponse.json({
      ok: true,
      actualizadas,
      nota: 'Los cambios aplican inmediatamente pero se pierden al reiniciar. Configure las variables en Dokploy para persistir.',
    });
  } catch (error) {
    console.error('[CONFIG] Error:', error);
    return NextResponse.json({ error: 'Error actualizando configuración' }, { status: 500 });
  }
}
