import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getConfig, setConfig } from '@/lib/db/configuracion';
import { logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';

// Renombrada de 'prompt_agente' a 'prompt_tono': esta clave solo controla el TONO
// (persona, estilo). Las reglas operativas viven siempre en código (REGLAS_OPERATIVAS
// en lib/telegram/agent-prompt.ts) y no son editables desde aquí — así una edición
// del tono nunca puede desactivar una regla de seguridad (CP-02, etc).
// La fila vieja 'prompt_agente' queda inerte en la DB, sin migración destructiva.
const CLAVE = 'prompt_tono';

export async function GET() {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  try {
    const prompt = await getConfig(CLAVE, empresaIdDeSesion(session));
    return NextResponse.json({ prompt });
  } catch {
    return NextResponse.json({ prompt: null });
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  try {
    const { prompt } = await request.json();
    if (typeof prompt !== 'string' || prompt.trim().length < 10) {
      return NextResponse.json({ error: 'El prompt debe tener al menos 10 caracteres' }, { status: 400 });
    }

    const empresaId = empresaIdDeSesion(session);
    await setConfig(CLAVE, prompt.trim(), 'Tono del agente IA (persona/estilo, no reglas)', session.email, empresaId);
    await logAccion(session.email, 'PROMPT_TONO_ACTUALIZADO', 'config', CLAVE, {
      longitud: prompt.trim().length,
    }, undefined, empresaId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[CONFIG-PROMPT] Error:', error);
    return NextResponse.json({ error: 'Error guardando prompt' }, { status: 500 });
  }
}
