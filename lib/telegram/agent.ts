import { TOOLS, ejecutarTool } from './tools';
import type { TelegramUserAuth } from './auth';
import {
  guardarMensaje,
  cargarHistorial,
  cargarMemoriaEquipo,
} from './historial';
import { obtenerSesion, guardarSesion } from './session';
import { buildSystemPrompt, MAX_TURNS, ROUTING_HINT_LOCAL } from './agent-prompt';
import { AnthropicLLM } from '@/lib/llm/anthropic';
import { OllamaLLM } from '@/lib/llm/ollama';
import { GatewayLLM } from '@/lib/llm/gateway';
import type { LLMProvider, LLMMessage, LLMTool } from '@/lib/llm/types';

/**
 * Elige qué proveedor de LLM usar para esta llamada.
 *
 * Reglas (precedencia):
 *  1. Si chat_id está en CANARY_CHAT_IDS → provider local (preferido: gateway)
 *  2. Si LLM_PROVIDER=gateway → GatewayLLM (router IA en :8080)
 *  3. Si LLM_PROVIDER=ollama → OllamaLLM (legacy directo a Ollama; deprecated)
 *  4. Default → Anthropic (comportamiento histórico)
 *
 * Env vars relevantes:
 *   LLM_PROVIDER          'anthropic' | 'gateway' | 'ollama'  (default 'anthropic')
 *   CANARY_CHAT_IDS       Lista separada por comas de chat_ids que usan provider local
 *
 *   --- Gateway IA local (preferido) ---
 *   GATEWAY_BASE_URL      Ej. 'http://100.67.128.72:8080' (Robocop vía Tailscale)
 *   GATEWAY_SUPERVISOR    Nombre del supervisor (default 'cobranzas')
 *   GATEWAY_TIER          Tier preferido: 'fast' | 'std' | 'deep' | 'night' (default 'deep')
 *   GATEWAY_AUTH_TOKEN    Bearer opcional
 *
 *   --- Ollama directo (legacy, deprecated) ---
 *   OLLAMA_BASE_URL       Ej. 'https://ollama.midominio.com/v1' (cuando hay túnel)
 *   OLLAMA_MODEL          Ej. 'qwen2.5:14b-instruct-q4_K_M'
 *   OLLAMA_AUTH_TOKEN     Bearer opcional para el túnel
 *
 *   --- Anthropic ---
 *   ANTHROPIC_MODEL       Override del default 'claude-haiku-4-5-20251001'
 */
function chooseProvider(chatId: number): LLMProvider {
  const flag = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  const canaryRaw = process.env.CANARY_CHAT_IDS ?? '';
  const canaryChats = canaryRaw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  const isCanary = canaryChats.includes(chatId);
  const wantsLocal = flag === 'gateway' || flag === 'ollama' || isCanary;

  if (wantsLocal) {
    // Para canary sin flag explícito, prefiere Gateway si está configurado.
    const useGateway =
      flag === 'gateway' || (isCanary && flag !== 'ollama' && !!process.env.GATEWAY_BASE_URL);

    if (useGateway) {
      const baseUrl = process.env.GATEWAY_BASE_URL;
      if (!baseUrl) {
        throw new Error(
          'GATEWAY_BASE_URL no configurada — requerida cuando LLM_PROVIDER=gateway',
        );
      }
      const tier = (process.env.GATEWAY_TIER ?? 'deep').toLowerCase() as
        | 'fast'
        | 'std'
        | 'deep'
        | 'night';
      return new GatewayLLM({
        baseUrl,
        supervisorName: process.env.GATEWAY_SUPERVISOR ?? 'cobranzas',
        preferredTier: tier,
        authToken: process.env.GATEWAY_AUTH_TOKEN,
        // 240s: el primer turno del primer mensaje del día puede tomar 60-90s
        // re-procesando el system prompt (~10K tokens). Suma del flujo completo
        // (T1 tool_use + tool exec + T2 end_turn) puede llegar a ~150s.
        timeoutMs: 240_000,
      });
    }

    // Modo Ollama directo (legacy).
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        'OLLAMA_BASE_URL no configurada (preferí GATEWAY_BASE_URL + LLM_PROVIDER=gateway)',
      );
    }
    return new OllamaLLM({
      baseUrl,
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b-instruct-q4_K_M',
      authToken: process.env.OLLAMA_AUTH_TOKEN,
      timeoutMs: 120_000,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }
  return new AnthropicLLM({
    apiKey,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
    effort: leerEffortValido(),
  });
}

const NIVELES_EFFORT = ['low', 'medium', 'high', 'max'] as const;

/** ANTHROPIC_EFFORT del env, validado — undefined si falta o no es un valor
 *  reconocido (la API usa su default, 'high'). */
function leerEffortValido(): (typeof NIVELES_EFFORT)[number] | undefined {
  const v = (process.env.ANTHROPIC_EFFORT ?? '').trim().toLowerCase();
  return (NIVELES_EFFORT as readonly string[]).includes(v)
    ? (v as (typeof NIVELES_EFFORT)[number])
    : undefined;
}

function toolsToLlmTools(): LLMTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema,
  }));
}

export interface MensajeUsuario {
  texto: string;
  user: TelegramUserAuth;
  chatId: number;
  telegramUserId: number;
  contexto?: { thread_id?: number; reply_to?: string };
}

export async function procesarMensajeBot(input: MensajeUsuario): Promise<string> {
  let provider: LLMProvider;
  try {
    provider = chooseProvider(input.chatId);
  } catch (e) {
    return `⚠️ Error de configuración LLM: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Cargar historial (15 mensajes — suficiente contexto, menor costo) en paralelo
  const [historial, memoriaEquipo, sesion] = await Promise.all([
    cargarHistorial(input.chatId, 15).catch(() => []),
    cargarMemoriaEquipo(input.user.usuario_id).catch(() => []),
    obtenerSesion(input.chatId).catch(() => null),
  ]);

  // Guardar el mensaje del usuario ANTES de llamar al modelo.
  // CON await a propósito (2026-09-03): antes era fire-and-forget, y si el
  // usuario respondía rápido, el siguiente turno podía leer el historial
  // (cargarHistorial arriba) ANTES de que este INSERT hubiera terminado —
  // el bot perdía su propio mensaje/pregunta anterior. Confirmado en producción
  // con "dame la suma total" tras una pregunta de aclaración: el turno siguiente
  // no tenía ni rastro de esa aclaración.
  try {
    await guardarMensaje(input.chatId, input.telegramUserId, 'usuario', input.texto, sesion?.codigo_cliente);
  } catch { /* no bloquea la respuesta si falla el guardado */ }

  // Construir el array de mensajes en formato neutral (LLMMessage[])
  const messages: LLMMessage[] = [
    ...historial.map((h) => ({
      role: (h.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.contenido,
    })),
    { role: 'user' as const, content: input.texto },
  ];

  const { staticPart: basePrompt, dynamicPart } = await buildSystemPrompt(memoriaEquipo, sesion);
  // Modelos locales (Qwen/DeepSeek via Ollama o Gateway) reciben una tabla de
  // routing al inicio para anclar la elección de tool antes de procesar el
  // resto del prompt. Anthropic no la necesita (sigue el prompt original sin
  // confundirse con 22 tools).
  // Pre-fix (2026-05-19): la condición era `provider.name === 'ollama'`,
  // dejando al provider 'gateway' SIN routing hint — causa probable de la
  // pérdida errática de memoria conversacional reportada el 2026-05-22.
  const staticPart = provider.name === 'anthropic' ? basePrompt : ROUTING_HINT_LOCAL + basePrompt;
  const llmTools = toolsToLlmTools();

  let respuestaFinal = '';
  let turn = 0;

  console.error(`[agent][${provider.name}] start chat=${input.chatId} user=${input.telegramUserId} text=${JSON.stringify(input.texto.slice(0, 100))}`);

  while (turn < MAX_TURNS) {
    turn++;

    let resp;
    try {
      resp = await provider.generate({
        systemCacheable: staticPart,
        system: dynamicPart,
        messages,
        tools: llmTools,
        // 384 era ajustado para responses cortas (saldo simple, top facturas).
        // Subido a 1024 el 2026-05-22 porque responses con perfil de riesgo +
        // aging + lista de facturas + accion credito superan 384. Subido de
        // nuevo a 4096 el 2026-09-03: en modelos con thinking (Sonnet 5+) el
        // razonamiento cuenta contra este límite — con 1024 el turno con tools
        // truncaría antes de llegar a generar texto.
        maxTokens: 4096,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[agent][${provider.name}] error:`, errMsg);
      return `⚠️ Error llamando al modelo (${provider.name}): ${errMsg.slice(0, 200)}`;
    }

    console.error(`[agent][${provider.name}] turn=${turn} stop=${resp.stopReason} text_len=${resp.text.length} tool_calls=${resp.toolCalls.length} latency=${resp.latencyMs}ms cached=${resp.usage.cachedInputTokens ?? 0} cache_write=${resp.usage.cacheCreationTokens ?? 0}`);
    if (resp.toolCalls.length > 0) {
      for (const tc of resp.toolCalls) {
        console.error(`[agent][${provider.name}]   call: ${tc.name} args=${JSON.stringify(tc.arguments)}`);
      }
    }

    // Si solo respondió texto, guardar en historial y devolver.
    // CON await: mismo motivo que el guardado del mensaje del usuario arriba —
    // si no se espera, el webhook puede ACKear y el usuario responder antes de
    // que este INSERT termine, y el turno siguiente no ve esta respuesta.
    if (resp.stopReason === 'end_turn') {
      respuestaFinal = resp.text || 'No tengo respuesta para eso.';
      try {
        await guardarMensaje(input.chatId, input.telegramUserId, 'asistente', respuestaFinal, sesion?.codigo_cliente);
      } catch { /* no bloquea la respuesta si falla el guardado */ }
      return respuestaFinal;
    }

    // Si pidió usar herramientas, ejecutarlas
    if (resp.stopReason === 'tool_use') {
      // Push assistant message con tool_calls (preserva el texto si lo hubo).
      // rawContent lleva los bloques crudos del proveedor (thinking incluido
      // si el modelo pensó) — ver LLMMessage.rawContent.
      messages.push({
        role: 'assistant',
        content: resp.text,
        toolCalls: resp.toolCalls,
        rawContent: resp.rawAssistantContent,
      });

      for (const tc of resp.toolCalls) {
        const resultado = await ejecutarTool(
          tc.name,
          tc.arguments,
          {
            userId: String(input.user.usuario_id),
            userEmail: input.user.telegram_username
              ? `telegram:${input.user.telegram_username}`
              : `telegram:${input.user.telegram_user_id}`,
            telegramUserId: input.telegramUserId,
            rol: input.user.rol,
            chatId: input.chatId,
          }
        );
        console.error(`[agent][${provider.name}]   result: ${tc.name} ok=${resultado.ok} ${resultado.ok ? '' : 'error=' + JSON.stringify(resultado.error)} data_snippet=${JSON.stringify(resultado.data ?? null).slice(0, 300)}`);

        // Actualizar sesión Redis cuando el modelo identifica un cliente (best-effort)
        if (resultado.ok && resultado.data) {
          const data = resultado.data as Record<string, unknown>;
          if (
            (tc.name === 'consultar_saldo_cliente' || tc.name === 'buscar_cliente') &&
            data.codigo && data.cliente
          ) {
            guardarSesion(input.chatId, {
              codigo_cliente: String(data.codigo),
              nombre_cliente: String(data.cliente),
              ultimo_tema: tc.name === 'consultar_saldo_cliente' ? 'saldo/facturas' : undefined,
            }).catch(() => {});
          }
          if (tc.name === 'buscar_cliente' && Array.isArray(data.clientes)) {
            const clientes = data.clientes as Array<{ codigo: string; nombre: string }>;
            if (clientes.length === 1) {
              guardarSesion(input.chatId, {
                codigo_cliente: clientes[0].codigo,
                nombre_cliente: clientes[0].nombre,
                ultimo_tema: 'búsqueda',
              }).catch(() => {});
            }
          }
        }

        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: JSON.stringify(resultado),
          isError: !resultado.ok,
        });
      }
      continue;
    }

    if (resp.stopReason === 'max_tokens') {
      return '⚠️ La respuesta se truncó. Intenta una pregunta más específica.';
    }

    if (resp.stopReason === 'refusal') {
      return '⚠️ No puedo ayudarte con eso. Intenta reformular la pregunta.';
    }

    return '⚠️ Error inesperado del modelo.';
  }

  return '⚠️ Demasiados pasos. Intenta reformular la pregunta.';
}
