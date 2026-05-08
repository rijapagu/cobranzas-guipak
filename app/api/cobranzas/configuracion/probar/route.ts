import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logAccion } from '@/lib/db/cobranzas';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';

/**
 * POST /api/cobranzas/configuracion/probar
 * Prueba conexión a un servicio externo.
 * Solo ADMIN puede usar.
 *
 * Body: { servicio: 'softec' | 'smtp' | 'evolution' | 'claude' }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  try {
    const { servicio } = await request.json();

    let resultado: { ok: boolean; mensaje: string; detalle?: Record<string, unknown> };

    switch (servicio) {
      case 'softec':
        resultado = await probarSoftec();
        break;
      case 'smtp':
        resultado = await probarSMTP();
        break;
      case 'evolution':
        resultado = await probarEvolution();
        break;
      case 'claude':
        resultado = await probarClaude();
        break;
      default:
        return NextResponse.json({ error: 'Servicio no válido' }, { status: 400 });
    }

    await logAccion(session.email, 'CONEXION_PROBADA', 'config', servicio, {
      resultado: resultado.ok ? 'EXITOSA' : 'FALLIDA',
      mensaje: resultado.mensaje,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[CONFIG-PROBAR] Error:', error);
    return NextResponse.json({
      ok: false,
      mensaje: error instanceof Error ? error.message : 'Error desconocido',
    });
  }
}

async function probarSoftec(): Promise<{ ok: boolean; mensaje: string; detalle?: Record<string, unknown> }> {
  const host = process.env.DB_SOFTEC_HOST;
  if (!host) return { ok: false, mensaje: 'No hay host configurado' };

  let pool: mysql.Pool | null = null;
  try {
    pool = mysql.createPool({
      host,
      port: Number(process.env.DB_SOFTEC_PORT) || 3306,
      database: process.env.DB_SOFTEC_NAME || 'guipak',
      user: process.env.DB_SOFTEC_USER || '',
      password: process.env.DB_SOFTEC_PASS || '',
      connectTimeout: 10000,
      connectionLimit: 1,
    });

    await pool.execute('SELECT 1');

    // Contar facturas pendientes (CP-04)
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as facturas, COUNT(DISTINCT IJ_CCODE) as clientes,
             ROUND(SUM(IJ_TOT - IJ_TOTAPPL), 2) as cartera
      FROM v_cobr_ijnl
      WHERE IJ_TYPEDOC = 'IN' AND IJ_INVTORF = 'T' AND IJ_PAID = 'F'
        AND (IJ_TOT - IJ_TOTAPPL) > 0 AND IJ_DUEDATE < CURDATE()
    `);

    const data = (rows as Record<string, unknown>[])[0];
    return {
      ok: true,
      mensaje: `Conexión exitosa. ${data.facturas} facturas vencidas, ${data.clientes} clientes, RD$${Number(data.cartera).toLocaleString()}`,
      detalle: data as Record<string, unknown>,
    };
  } catch (err) {
    return {
      ok: false,
      mensaje: `Error: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
    };
  } finally {
    if (pool) await pool.end();
  }
}

async function probarSMTP(): Promise<{ ok: boolean; mensaje: string }> {
  const host = process.env.SMTP_HOST;
  if (!host) return { ok: false, mensaje: 'No hay host SMTP configurado' };

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
      connectionTimeout: 10000,
    });

    await transporter.verify();
    return { ok: true, mensaje: `Conexión SMTP exitosa a ${host}:${process.env.SMTP_PORT}` };
  } catch (err) {
    return {
      ok: false,
      mensaje: `Error SMTP: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
    };
  }
}

async function probarEvolution(): Promise<{ ok: boolean; mensaje: string }> {
  const url = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  if (!url || !apiKey) return { ok: false, mensaje: 'URL o API Key no configurados' };

  try {
    const res = await fetch(`${url}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return { ok: false, mensaje: `Error HTTP ${res.status}: ${res.statusText}` };
    }

    const data = await res.json();
    const instances = Array.isArray(data) ? data.length : 0;
    return {
      ok: true,
      mensaje: `Conexión exitosa. ${instances} instancia${instances !== 1 ? 's' : ''} encontrada${instances !== 1 ? 's' : ''}.`,
    };
  } catch (err) {
    return {
      ok: false,
      mensaje: `Error: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
    };
  }
}

async function probarClaude(): Promise<{ ok: boolean; mensaje: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, mensaje: 'API Key no configurada' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Responde solo OK' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { ok: false, mensaje: `Error API: ${res.status} — ${(errData as { error?: { message?: string } }).error?.message || res.statusText}` };
    }

    return { ok: true, mensaje: 'API Key válida. Claude AI está disponible.' };
  } catch (err) {
    return {
      ok: false,
      mensaje: `Error: ${err instanceof Error ? err.message : 'Fallo de conexión'}`,
    };
  }
}
