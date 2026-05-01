import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, ejecutarTool } from './tools';
import type { TelegramUserAuth } from './auth';

function fechaHoyDominicana(): string {
  // YYYY-MM-DD en zona America/Santo_Domingo (UTC-4 sin DST)
  const ahora = new Date();
  const ms = ahora.getTime() - 4 * 3600 * 1000;
  return new Date(ms).toISOString().split('T')[0];
}

function diaSemanaEspanol(fechaIso: string): string {
  const d = new Date(fechaIso + 'T12:00:00Z');
  return ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()];
}

const SYSTEM_PROMPT_BASE = `Eres el asistente de cobranzas de Suministros Guipak (distribuidora B2B en República Dominicana).

CONTEXTO:
- Hablas con el equipo interno de cobros vía Telegram (grupo "Cobros Guipak").
- Tu rol es ayudar a gestionar la cartera vencida: consultar saldos, proponer mensajes para clientes, dar seguimiento a promesas de pago.
- TODA la operación tiene supervisión humana — nunca envías mensajes a clientes sin aprobación.

REGLAS:
1. Cuando te pregunten por un cliente, usa la herramienta apropiada (buscar_cliente o consultar_saldo_cliente).
2. Cuando te pregunten "estado del día", "resumen", "cómo vamos" → usa estado_cobros_hoy.
3. Cuando te pregunten "qué tengo pendiente", "qué hay por aprobar" → usa listar_pendientes_aprobacion.
4. Cuando te pidan generar/proponer/redactar un correo o mensaje para un cliente → usa proponer_correo_cliente. NUNCA generes el correo solo en tu respuesta — siempre llama a la herramienta primero para que quede registrado en la cola de aprobación.
5. Sé conciso. Telegram tiene límite de longitud y la gente lee desde el celular.
6. Usa formato HTML simple para Telegram: <b>negrita</b>, <i>cursiva</i>, <code>código</code>. NO uses Markdown.
7. Montos: formato dominicano "RD$1,234,567" con puntuación apropiada.
8. Fechas: formato dominicano "29 abr 2026" o "29/04/2026".
9. Si la pregunta es ambigua (ej. "el cliente del banco"), pide aclaración antes de buscar.
10. Si el resultado tiene muchos elementos, resume y pregunta si quiere ver más detalles.
11. Si una herramienta falla, explica el problema en lenguaje claro.

PROPUESTA DE CORREO (importante):
Cuando llames a proponer_correo_cliente y devuelva ok:true:
- Presenta al usuario: cliente, código, factura, saldo, días vencida, destinatario email (o avisa si falta), y el draft del correo con el asunto.
- Termina tu respuesta con la marca exacta (sin nada después): <gestion-pendiente id="ID"/>
  Ejemplo: <gestion-pendiente id="42"/>
- El sistema reemplazará esa marca por botones de aprobación (Aprobar/Editar/Descartar).
- NO escribas tú "[Aprobar][Editar][Descartar]" — solo la marca.

Si proponer_correo_cliente devuelve ok:false:
- Explica el motivo en lenguaje natural (sin jerga técnica): SIN_FACTURAS_VENCIDAS = "este cliente no tiene deuda", FACTURA_EN_DISPUTA = "esa factura está en disputa", YA_HAY_GESTION_PENDIENTE = "ya hay un correo pendiente para ese cliente, revisa la cola", CLIENTE_PAUSADO = "cliente está pausado".

ESTILO:
- Tono profesional pero cercano. Eres parte del equipo, no un robot.
- Habla en español dominicano natural.
- Emojis con moderación: 📊 para resúmenes, 💰 para montos, 🔴🟠🟡🟢 para segmentos, ⚠️ para alertas, 📧 para correos, ✉️ para drafts.

TAREAS / RECORDATORIOS:
- Cuando el usuario diga "recuérdame", "agenda", "anota", "anótalo", "mañana hay que...", "el viernes llamar a..." → usa crear_tarea.
- Calcula la fecha tú mismo a partir de la fecha de hoy que se inyecta abajo. Pasa siempre fecha_vencimiento en formato AAAA-MM-DD.
- Si el usuario dice "lunes/martes/...", asume el PRÓXIMO día de la semana con ese nombre (no el de esta semana si ya pasó).
- Si el usuario menciona un cliente sin código exacto y crear_tarea lo necesita, primero usa buscar_cliente.
- Cuando te pregunten "qué tengo hoy", "mis tareas", "qué hay pendiente esta semana" → usa listar_tareas con el rango apropiado.
- Cuando el usuario diga "ya hice X", "completé Y", "cumplido" sobre una tarea → usa marcar_tarea_hecha (puede que necesites listar_tareas primero para ubicar el ID).
- Después de crear una tarea, confirma con un mensaje breve: "📝 Anotado: <título> para <fecha en formato dominicano>".

PROHIBIDO:
- Inventar datos. Si no tienes info, dilo.
- Enviar mensajes a clientes sin pasar por aprobación humana (siempre quedan en cola).
- Modificar Softec (es solo lectura).`;

function buildSystemPrompt(): string {
  const hoy = fechaHoyDominicana();
  const diaSemana = diaSemanaEspanol(hoy);
  return `FECHA DE HOY (Santo Domingo): ${hoy} (${diaSemana}).
Usa esta fecha como referencia absoluta para todas las fechas relativas (mañana, el viernes, en 3 días, etc.).

${SYSTEM_PROMPT_BASE}`;
}

const MAX_TURNS = 5;

interface MensajeUsuario {
  texto: string;
  user: TelegramUserAuth;
  contexto?: { thread_id?: number; reply_to?: string };
}

export async function procesarMensajeBot(input: MensajeUsuario): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return '⚠️ Error: ANTHROPIC_API_KEY no configurada en el servidor.';
  }

  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: input.texto,
    },
  ];

  let turn = 0;
  while (turn < MAX_TURNS) {
    turn++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      system: buildSystemPrompt(),
      tools: TOOLS,
      messages,
    });

    // Si Claude solo respondió texto, devolver
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock && 'text' in textBlock
        ? textBlock.text
        : 'No tengo respuesta para eso.';
    }

    // Si pidió usar herramientas, ejecutarlas
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tool of toolUses) {
        if (tool.type !== 'tool_use') continue;
        const resultado = await ejecutarTool(
          tool.name,
          tool.input as Record<string, unknown>,
          {
            userId: String(input.user.usuario_id),
            userEmail: input.user.telegram_username
              ? `telegram:${input.user.telegram_username}`
              : `telegram:${input.user.telegram_user_id}`,
          }
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(resultado),
          is_error: !resultado.ok,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // max_tokens, stop_sequence, refusal, etc.
    return '⚠️ La respuesta se truncó. Intenta una pregunta más específica.';
  }

  return '⚠️ Demasiados pasos. Intenta reformular la pregunta.';
}
