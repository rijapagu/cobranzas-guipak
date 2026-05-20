/**
 * Adapter Ollama (vía API OpenAI-compatible en http://host:11434/v1).
 *
 * Por qué OpenAI-compatible y no la API nativa de Ollama:
 *  - El formato de tools es estándar OpenAI (más documentado, más portable).
 *  - Permite cambiar Qwen → DeepSeek → cualquier otro modelo de Ollama tocando solo `model`.
 *  - Soporta JSON mode con response_format.
 *
 * KV cache prefix: Ollama lo activa automáticamente si el comienzo de los tokens
 * de input no cambia entre llamadas. El system prompt estático se beneficia
 * sin marca explícita (a diferencia de Anthropic). El orden importa: el adapter
 * pone systemCacheable ANTES que system para maximizar reuso.
 */

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
  LLMMessage,
  LLMToolCall,
} from './types';

export interface OllamaLLMOptions {
  /** Ej. 'http://localhost:11434/v1' o la URL del túnel Cloudflare. */
  baseUrl: string;
  /** Ej. 'qwen2.5:14b-instruct-q4_K_M'. */
  model: string;
  /** Token opcional para auth en el túnel (Bearer). */
  authToken?: string;
  /** Timeout por llamada en ms (default 60s). */
  timeoutMs?: number;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  parallel_tool_calls?: boolean;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
  }>;
  tool_choice?: 'auto' | 'none';
  response_format?: { type: 'json_object' };
  stream: false;
  // Ollama-specific: pasthrough hacia la API nativa (la openai-compat lo acepta).
  // Necesario porque num_ctx default Ollama es 2048 — insuficiente con tools.
  options?: {
    num_ctx?: number;
    num_predict?: number;
    top_k?: number;
    repeat_penalty?: number;
  };
}

interface OpenAIChatResponse {
  model?: string;
  choices: Array<{
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
    message: OpenAIMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OllamaLLM implements LLMProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private model: string;
  private authToken?: string;
  private timeoutMs: number;

  constructor(opts: OllamaLLMOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.authToken = opts.authToken;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const t0 = Date.now();

    // System en un solo mensaje. systemCacheable primero (para KV-prefix-cache).
    const systemText = [req.systemCacheable, req.system].filter(Boolean).join('\n\n');

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemText },
      ...toOpenAIMessages(req.messages),
    ];

    const tools = req.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const body: OpenAIChatRequest = {
      model: this.model,
      messages,
      max_tokens: req.maxTokens,
      // Temperatura baja: reduce drift de idioma (chino → español) y mejora la
      // consistencia del tool routing. 0.2 da algo de variabilidad sin que se desboque.
      temperature: 0.2,
      top_p: 0.8,
      stream: false,
      options: {
        num_ctx: 16384,
        num_predict: req.maxTokens ?? 1024,
        top_k: 20,
        repeat_penalty: 1.05,
      },
      ...(tools && tools.length > 0
        ? { tools, tool_choice: 'auto' as const, parallel_tool_calls: false }
        : {}),
      ...(req.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let json: OpenAIChatResponse;
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}: ${errText.slice(0, 200)}`);
      }
      json = (await res.json()) as OpenAIChatResponse;
    } finally {
      clearTimeout(timer);
    }

    const choice = json.choices?.[0];
    if (!choice) {
      throw new Error('Ollama: respuesta sin choices');
    }

    const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseJson(tc.function.arguments),
    }));

    return {
      stopReason: mapOpenAIFinishReason(choice.finish_reason, toolCalls.length > 0),
      text: choice.message.content ?? '',
      toolCalls,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
      latencyMs: Date.now() - t0,
      model: json.model ?? this.model,
    };
  }
}

function mapOpenAIFinishReason(
  reason: OpenAIChatResponse['choices'][number]['finish_reason'],
  hasToolCalls: boolean
): LLMStopReason {
  // Algunos modelos en Ollama devuelven finish_reason='stop' aun cuando emitieron
  // tool_calls. Tomar la presencia de tool_calls como señal autoritativa.
  if (hasToolCalls) return 'tool_use';
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'error';
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toOpenAIMessages(msgs: LLMMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        content: m.content,
        tool_call_id: m.toolCallId ?? '',
      });
      continue;
    }
    if (m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls!.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
