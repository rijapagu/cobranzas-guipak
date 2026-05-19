/**
 * Adapter Anthropic para la interfaz LLMProvider.
 * Reproduce la lógica de lib/telegram/agent.ts (prompt caching incluido)
 * pero detrás de la interfaz neutral.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStopReason,
  LLMMessage,
  LLMToolCall,
} from './types';

export interface AnthropicLLMOptions {
  apiKey: string;
  model: string;
}

export class AnthropicLLM implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(opts: AnthropicLLMOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const t0 = Date.now();

    // System: si hay parte cacheable, va primero con cache_control; luego la dinámica.
    const systemBlocks: Anthropic.TextBlockParam[] = [];
    if (req.systemCacheable) {
      systemBlocks.push({
        type: 'text',
        text: req.systemCacheable,
        cache_control: { type: 'ephemeral' },
      });
    }
    if (req.system) {
      systemBlocks.push({ type: 'text', text: req.system });
    }

    const tools: Anthropic.Tool[] | undefined = req.tools?.map((t, i, arr) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool['input_schema'],
      ...(i === arr.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));

    const messages = toAnthropicMessages(req.messages);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: systemBlocks,
      ...(tools ? { tools } : {}),
      messages,
    });

    const text =
      response.content.find((b) => b.type === 'text')?.type === 'text'
        ? (response.content.find((b) => b.type === 'text') as Anthropic.TextBlock).text
        : '';

    const toolCalls: LLMToolCall[] = response.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments: (b.input ?? {}) as Record<string, unknown>,
      }));

    return {
      stopReason: mapAnthropicStopReason(response.stop_reason),
      text,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens:
          response.usage.cache_read_input_tokens ?? undefined,
      },
      latencyMs: Date.now() - t0,
      model: this.model,
    };
  }
}

function mapAnthropicStopReason(
  reason: Anthropic.Message['stop_reason']
): LLMStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'error';
  }
}

function toAnthropicMessages(
  msgs: LLMMessage[]
): Anthropic.MessageParam[] {
  // El protocolo de Anthropic agrupa los tool_results del mismo turno en un solo
  // mensaje `user` con un array de bloques. Aquí asumimos que el caller ya entrega
  // los mensajes individualmente y los empaquetamos.
  const out: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of msgs) {
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
        is_error: m.isError ?? false,
      });
      continue;
    }
    flushToolResults();

    if (m.role === 'assistant' && (m.toolCalls?.length ?? 0) > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls!) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  flushToolResults();
  return out;
}
