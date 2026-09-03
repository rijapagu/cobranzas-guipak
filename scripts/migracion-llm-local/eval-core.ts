/**
 * Loop de evaluación compartido entre 03_eval_runner.ts (CLI ad-hoc, banco de
 * queries grande) y ../test-agente-llm.ts (test de regresión, banco fijo
 * chico). Un solo lugar para el loop de tools + aserción de expected_tool,
 * para que ambos no puedan divergir en qué cuenta como "acertó".
 */
import type { LLMProvider, LLMMessage, LLMTool } from '@/lib/llm/types';
import { MAX_TURNS } from '@/lib/telegram/agent-prompt';
import { mockTool } from './tool-mocks';

export interface CasoEval {
  id: string;
  categoria: string;
  texto: string;
  /** undefined/null = sin aserción (solo informativo). '-' en el TSV se traduce a null (se espera NINGÚN tool call). */
  expectedTool?: string | null;
}

export interface EvalResult {
  id: string;
  categoria: string;
  query: string;
  provider: string;
  model: string;
  ok: boolean;
  num_turns: number;
  tools_called: string[];
  first_tool: string | null;
  final_text_length: number;
  final_text: string;
  latency_ms_total: number;
  usage: { input: number; output: number; cached?: number };
  error?: string;
  expected_tool?: string | null;
  assertion_pass?: boolean;
}

export async function ejecutarCasoEval(
  provider: LLMProvider,
  modelLabel: string,
  staticPart: string,
  dynamicPart: string,
  tools: LLMTool[],
  caso: CasoEval,
  maxTokens = 4096
): Promise<EvalResult> {
  const messages: LLMMessage[] = [{ role: 'user', content: caso.texto }];
  const toolsCalled: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalCached = 0;
  let totalLatency = 0;
  let finalText = '';
  let turns = 0;
  let ok = false;
  let error: string | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    turns++;
    let resp;
    try {
      resp = await provider.generate({
        systemCacheable: staticPart,
        system: dynamicPart,
        messages,
        tools,
        maxTokens,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }

    totalIn += resp.usage.inputTokens;
    totalOut += resp.usage.outputTokens;
    totalCached += resp.usage.cachedInputTokens ?? 0;
    totalLatency += resp.latencyMs;

    if (resp.stopReason === 'end_turn') {
      finalText = resp.text;
      ok = true;
      break;
    }
    if (resp.stopReason === 'tool_use') {
      messages.push({
        role: 'assistant',
        content: resp.text,
        toolCalls: resp.toolCalls,
        rawContent: resp.rawAssistantContent,
      });
      for (const tc of resp.toolCalls) {
        toolsCalled.push(tc.name);
        const result = mockTool(tc.name, tc.arguments);
        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: JSON.stringify(result),
          isError: !result.ok,
        });
      }
      continue;
    }
    error = `stop_reason inesperado: ${resp.stopReason}`;
    break;
  }

  const firstTool = toolsCalled[0] ?? null;
  const hasAssertion = caso.expectedTool !== undefined;
  const assertionPass = hasAssertion ? firstTool === caso.expectedTool : undefined;

  return {
    id: caso.id,
    categoria: caso.categoria,
    query: caso.texto,
    provider: provider.name,
    model: modelLabel,
    ok,
    num_turns: turns,
    tools_called: toolsCalled,
    first_tool: firstTool,
    final_text_length: finalText.length,
    final_text: finalText,
    latency_ms_total: totalLatency,
    usage: { input: totalIn, output: totalOut, ...(totalCached > 0 ? { cached: totalCached } : {}) },
    ...(error ? { error } : {}),
    ...(hasAssertion ? { expected_tool: caso.expectedTool, assertion_pass: assertionPass } : {}),
  };
}
