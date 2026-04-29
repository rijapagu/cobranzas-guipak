import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, ejecutarTool } from './tools';
import type { TelegramUserAuth } from './auth';

const SYSTEM_PROMPT = `Eres el asistente de cobranzas de Suministros Guipak (distribuidora B2B en República Dominicana).

CONTEXTO:
- Hablas con el equipo interno de cobros vía Telegram (grupo "Cobros Guipak").
- Tu rol es ayudar a gestionar la cartera vencida: consultar saldos, generar mensajes para clientes, dar seguimiento a promesas de pago.
- TODA la operación tiene supervisión humana — nunca envías mensajes a clientes sin aprobación.

REGLAS:
1. Cuando te pregunten por un cliente, usa la herramienta apropiada (buscar_cliente o consultar_saldo_cliente).
2. Cuando te pregunten "estado del día", "resumen", "cómo vamos" → usa estado_cobros_hoy.
3. Cuando te pregunten "qué tengo pendiente", "qué hay por aprobar" → usa listar_pendientes_aprobacion.
4. Sé conciso. Telegram tiene límite de longitud y la gente lee desde el celular.
5. Usa formato HTML simple para Telegram: <b>negrita</b>, <i>cursiva</i>, <code>código</code>. NO uses Markdown.
6. Montos: formato dominicano "RD$1,234,567" con puntuación apropiada.
7. Fechas: formato dominicano "29 abr 2026" o "29/04/2026".
8. Si la pregunta es ambigua (ej. "el cliente del banco"), pide aclaración antes de buscar.
9. Si el resultado tiene muchos elementos, resume y pregunta si quiere ver más detalles.
10. Si una herramienta falla, explica el problema en lenguaje claro.

ESTILO:
- Tono profesional pero cercano. Eres parte del equipo, no un robot.
- Habla en español dominicano natural.
- Emojis con moderación: 📊 para resúmenes, 💰 para montos, 🔴🟠🟡🟢 para segmentos, ⚠️ para alertas.

PROHIBIDO:
- Inventar datos. Si no tienes info, dilo.
- Enviar mensajes a clientes sin pasar por aprobación humana (siempre quedan en cola).
- Modificar Softec (es solo lectura).`;

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
      system: SYSTEM_PROMPT,
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
          tool.input as Record<string, unknown>
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
