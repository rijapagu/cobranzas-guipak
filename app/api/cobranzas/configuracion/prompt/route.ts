import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getConfig, setConfig } from '@/lib/db/configuracion';
import { logAccion } from '@/lib/db/cobranzas';

const CLAVE = 'prompt_agente';

export async function GET() {
  const session = await getSession();
  if (!session || session.rol !== 'ADMIN') {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
  }

  try {
    const prompt = await getConfig(CLAVE);
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

    await setConfig(CLAVE, prompt.trim(), 'Prompt del agente IA (system prompt)', session.email);
    await logAccion(session.email, 'PROMPT_AGENTE_ACTUALIZADO', 'config', CLAVE, {
      longitud: prompt.trim().length,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[CONFIG-PROMPT] Error:', error);
    return NextResponse.json({ error: 'Error guardando prompt' }, { status: 500 });
  }
}
