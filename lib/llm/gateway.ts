/**
 * Adapter para el Gateway IA local (C:\IA\gateway).
 *
 * El Gateway expone `POST /v1/supervisor/:name` con:
 *  - Tier-routing automático (qwen-fast / qwen-supervisor / qwen-deep)
 *  - Cola serial (PQueue concurrency:1) que respeta max_loaded_models=1
 *  - Tool calling end-to-end (extendido 2026-05-20)
 *
 * Body esperado por el endpoint:
 *   { messages, task: { tier, max_tokens, response_format }, ctx: {}, tools, tool_choice }
 *
 * Response del Gateway:
 *   { ok, model, ms, tokens, tps, content, tool_calls, done_reason }
 *
 * Diferencias vs OllamaLLM:
 *  - URL: hablamos al Gateway (puerto 8080), no directo a Ollama (11434)
 *  - El Gateway elige el modelo (no se pasa `model` en body) — usa task.tier
 *  - tool_calls vienen en formato Ollama nativo { id?, function: { name, arguments } }
 *  - Cola serial gestionada por Gateway (sin colisiones de VRAM entre agentes)
 *
 * KV cache prefix:
 *  Ollama lo activa automáticamente si el comienzo de los tokens de input no
 *  cambia entre llamadas. El system prompt estático se beneficia sin marca
 *  explícita. El adapter pone systemCacheable ANTES que system para maximizar.
 */

import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
  LLMMessage,
  LLMToolCall,
} from './types';

export interface GatewayLLMOptions {
  /** Ej. 'http://127.0.0.1:8080' (local) o 'http://100.67.128.72:8080' (Tailscale). */
  baseUrl: string;
  /** Nombre del supervisor: 'cobranzas', 'inventario', etc. */
  supervisorName: string;
  /**
   * Tier preferido: 'fast' | 'std' | 'deep' | 'night'.
   * Si se omite, el router del Gateway decide por heurística (y fuerza 'deep'
   * automáticamente si hay >5 tools). Para Cobros con 27 tools, conviene 'deep'.
   */
  preferredTier?: 'fast' | 'std' | 'deep' | 'night';
  /** Bearer token opcional. */
  authToken?: string;
  /** Timeout por llamada en ms (default 120s — tier deep cold start ~10s). */
  timeoutMs?: number;
}

// ─── Estructuras del Gateway / Ollama nativo ─────────────────────────────────

interface GatewayToolCall {
  id?: string;
  type?: 'function';
  function: {
    name: string;
    // Ollama nativo devuelve `arguments` como objeto. Algunos clientes lo
    // serializan a string — toleramos ambos.
    arguments: Record<string, unknown> | string;
    index?: number;
  };
}

interface GatewayMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: GatewayToolCall[];
  tool_call_id?: string;
}

interface GatewayRequestBody {
  messages: GatewayMessage[];
  task?: {
    tier?: GatewayLLMOptions['preferredTier'];
    max_tokens?: number;
    response_format?: { type: 'json_object' };
    temperature?: number;
  };
  ctx?: Record<string, unknown>;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: object };
  }>;
  tool_choice?: 'auto' | 'none';
}

interface GatewayResponse {
  ok: boolean;
  model?: string;
  ms?: number;
  tokens?: number;
  tps?: number;
  content?: string;
  tool_calls?: GatewayToolCall[];
  done_reason?: string;
  error?: string;
}

// ─── Implementación ──────────────────────────────────────────────────────────

export class GatewayLLM implements LLMProvider {
  readonly name = 'gateway';
  private baseUrl: string;
  private supervisorName: string;
  private preferredTier?: GatewayLLMOptions['preferredTier'];
  private authToken?: string;
  private timeoutMs: number;

  constructor(opts: GatewayLLMOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.supervisorName = opts.supervisorName;
    this.preferredTier = opts.preferredTier;
    this.authToken = opts.authToken;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const t0 = Date.now();

    // System en un solo mensaje role=system. systemCacheable primero (KV cache).
    const systemText = [req.systemCacheable, req.system].filter(Boolean).join('\n\n');
    const messages: GatewayMessage[] = [
      { role: 'system', content: systemText },
      ...toGatewayMessages(req.messages),
    ];

    const tools = req.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const body: GatewayRequestBody = {
      messages,
      task: {
        ...(this.preferredTier ? { tier: this.preferredTier } : {}),
        max_tokens: req.maxTokens,
        ...(req.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
      },
      ctx: {},
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let json: GatewayResponse;
    try {
      const res = await fetch(`${this.baseUrl}/v1/supervisor/${this.supervisorName}`, {
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
        throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
      }
      json = (await res.json()) as GatewayResponse;
    } finally {
      clearTimeout(timer);
    }

    if (!json.ok) {
      throw new Error(`Gateway error: ${json.error ?? 'sin detalle'}`);
    }

    const toolCalls: LLMToolCall[] = (json.tool_calls ?? []).map((tc, idx) => ({
      id: tc.id ?? `call_gw_${Date.now()}_${idx}`,
      name: tc.function.name,
      arguments:
        typeof tc.function.arguments === 'string'
          ? safeParseJson(tc.function.arguments)
          : (tc.function.arguments ?? {}),
    }));

    return {
      stopReason: mapStopReason(json.done_reason, toolCalls.length > 0),
      text: json.content ?? '',
      toolCalls,
      // El Gateway hoy NO expone prompt_tokens — solo el output (`tokens` = eval_count).
      // Pendiente: extender server.js para propagar prompt_eval_count de Ollama.
      usage: {
        inputTokens: 0,
        outputTokens: json.tokens ?? 0,
      },
      latencyMs: json.ms ?? Date.now() - t0,
      model: json.model ?? 'gateway-unknown',
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapStopReason(
  doneReason: string | undefined,
  hasToolCalls: boolean,
): LLMStopReason {
  // tool_calls es señal autoritativa, igual que en OllamaLLM
  if (hasToolCalls) return 'tool_use';
  switch (doneReason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      // Si el Gateway no propagó done_reason pero la llamada fue ok=true sin
      // tool_calls, asumir end_turn (mejor UX que 'error').
      return doneReason ? 'error' : 'end_turn';
  }
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toGatewayMessages(msgs: LLMMessage[]): GatewayMessage[] {
  const out: GatewayMessage[] = [];
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
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
