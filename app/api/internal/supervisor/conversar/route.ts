/**
 * Endpoint interno: el Supervisor de Cobros, consultable por HTTP.
 *
 * Lo usa el CEO orquestador (servicio aparte en el servidor de agentes) para
 * preguntarle a Cobros temas estratégicos sin acoplar código: el CEO enruta una
 * pregunta de área "cobros" a este endpoint, que responde con deepseek + contexto
 * de cartera (misma lógica que el bot conversacional @CobrosSupervisorBot).
 *
 * Arquitectura híbrida (2026-06-05): cada área es dueña de su razonamiento y lo
 * expone por HTTP; el CEO solo enruta y agrega. Ver project-ceo-orquestador.
 *
 * Auth: header x-internal-secret == INTERNAL_CRON_SECRET (mismo de los crons).
 *
 * Body: { "pregunta": "¿cómo está la cartera?" }
 * Resp: { ok, area:'cobros', text, model, latencyMs }
 */

import { NextRequest, NextResponse } from 'next/server';
import { esRequestInternoValido } from '@/lib/auth/internal';
import { conversarSupervisor } from '@/lib/supervisor/conversacion';
import { logError } from '@/lib/db/cobranzas';

export async function POST(req: NextRequest) {
  if (!esRequestInternoValido(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { pregunta?: string; contexto?: string };
  try {
    body = (await req.json()) as { pregunta?: string; contexto?: string };
  } catch {
    return NextResponse.json({ error: 'bad-json' }, { status: 400 });
  }

  const pregunta = (body.pregunta || '').trim();
  if (!pregunta) {
    return NextResponse.json({ error: 'falta el campo "pregunta"' }, { status: 400 });
  }
  // `contexto` = turnos previos del hilo que manda el CEO; sirve para resolver follow-ups
  // ("no son 50mil?") sin perder el cliente activo. Opcional (compat hacia atrás).
  const contexto = (body.contexto || '').trim();

  try {
    const { text, model, latencyMs } = await conversarSupervisor(pregunta, contexto);
    return NextResponse.json({ ok: true, area: 'cobros', text, model, latencyMs });
  } catch (err) {
    await logError('supervisor-conversar', err, { pregunta: pregunta.substring(0, 200) });
    return NextResponse.json(
      { ok: false, error: 'Error procesando la consulta del supervisor' },
      { status: 502 }
    );
  }
}
