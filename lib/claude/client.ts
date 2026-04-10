/**
 * Cliente Claude AI para generación de mensajes de cobranza.
 * CP-10: Solo genera texto. Nunca importa evolution ni email.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ContextoCobranza, MensajeGenerado } from '@/lib/types/cobranzas';
import { buildPromptCobranza, generarMensajeMock } from './prompts';

const MODEL = 'claude-sonnet-4-20250514';

/**
 * Genera mensajes de cobranza usando Claude AI.
 * Si no hay ANTHROPIC_API_KEY, retorna mensajes mock.
 */
export async function generarMensajeCobranza(
  contexto: ContextoCobranza
): Promise<MensajeGenerado> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    const mock = generarMensajeMock(contexto);
    return {
      mensaje_wa: mock.mensaje_wa,
      mensaje_email: mock.mensaje_email,
      asunto_email: mock.asunto_email,
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPromptCobranza(contexto);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    // Intentar parsear JSON de la respuesta
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        mensaje_wa: parsed.mensaje_wa || '',
        mensaje_email: parsed.mensaje_email || '',
        asunto_email: parsed.asunto_email || '',
      };
    }

    // Fallback si no es JSON válido
    return generarMensajeMock(contexto);
  } catch (error) {
    console.error('[CLAUDE] Error generando mensaje:', error);
    // Fallback a mock en caso de error
    return generarMensajeMock(contexto);
  }
}
