/**
 * Interfaz neutra para proveedores de LLM.
 *
 * Permite intercambiar Anthropic ↔ Ollama (u otros) sin tocar lib/telegram/agent.ts
 * más allá de un punto de inyección.
 *
 * No incluye streaming — el bot de Telegram no lo usa.
 * No incluye images / audio — Cobros es texto puro.
 */

export type LLMRole = 'user' | 'assistant' | 'tool';

/**
 * Mensaje en la conversación. Formato neutral (no Anthropic ni OpenAI).
 * - 'user' / 'assistant' con texto plano: `content: string`
 * - 'assistant' que invoca tools: `content: ''` (o texto) + `toolCalls: [...]`
 * - 'tool' (resultado de ejecución): `content: <stringified result>` + `toolCallId`
 */
export interface LLMMessage {
  role: LLMRole;
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  isError?: boolean;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool en formato neutral. Las propiedades coinciden con lo que ya usa Anthropic.Tool
 * (rename de `input_schema` → `parameters` para ser provider-agnostic).
 */
export interface LLMTool {
  name: string;
  description: string;
  parameters: object;
}

export interface LLMRequest {
  /**
   * System prompt parte estática (cambia raramente). Anthropic la marca como cacheable.
   * Ollama la concatena con `system` normal.
   */
  systemCacheable?: string;
  /** Parte dinámica del system prompt (fecha, sesión, memoria). No se cachea. */
  system: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  maxTokens: number;
  /** Si true, fuerza respuesta JSON (Ollama: format=json; Anthropic: prefill `{`). */
  jsonMode?: boolean;
}

export type LLMStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface LLMResponse {
  stopReason: LLMStopReason;
  /** Texto generado (vacío si stopReason='tool_use'). */
  text: string;
  /** Tool calls si stopReason='tool_use'. */
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  /** Latencia end-to-end de esta llamada (ms). */
  latencyMs: number;
  /** Modelo concreto que se usó (string libre, para logging). */
  model: string;
}

export interface LLMProvider {
  /** Nombre corto para logs: 'anthropic', 'ollama'. */
  readonly name: string;
  /** Una sola llamada (turno) al modelo. El loop de tools vive afuera. */
  generate(req: LLMRequest): Promise<LLMResponse>;
}
