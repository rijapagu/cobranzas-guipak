/**
 * Eval runner — corre el banco de queries contra un proveedor de LLM
 * usando el mismo system prompt y tools que producción, con tools mockeadas.
 *
 * USO:
 *   npx tsx scripts/migracion-llm-local/03_eval_runner.ts \
 *     --provider anthropic \
 *     --model claude-haiku-4-5-20251001 \
 *     --queries scripts/migracion-llm-local/queries.tsv \
 *     --prompt  scripts/migracion-llm-local/prompt_agente.txt \
 *     [--limit 20] \
 *     [--category saldo_cliente] \
 *     > scripts/migracion-llm-local/results_haiku.jsonl
 *
 *   npx tsx scripts/migracion-llm-local/03_eval_runner.ts \
 *     --provider ollama \
 *     --model qwen2.5:14b-instruct-q4_K_M \
 *     --baseUrl http://localhost:11434/v1 \
 *     --queries ... --prompt ...
 *     > results_qwen14b.jsonl
 *
 * SALIDA: una línea JSON por query (JSONL) a stdout. Stats a stderr.
 */

import { readFileSync } from 'node:fs';
import { AnthropicLLM } from '@/lib/llm/anthropic';
import { OllamaLLM } from '@/lib/llm/ollama';
import type { LLMProvider, LLMMessage, LLMTool } from '@/lib/llm/types';
import { TOOLS } from '@/lib/telegram/tools';
import { buildSystemPrompt, MAX_TURNS } from '@/lib/telegram/agent-prompt';
import { mockTool } from './tool-mocks';

interface CliArgs {
  provider: 'anthropic' | 'ollama';
  model: string;
  queries: string;
  prompt: string;
  baseUrl?: string;
  authToken?: string;
  limit?: number;
  category?: string;
  apiKey?: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }

  if (!out.provider || (out.provider !== 'anthropic' && out.provider !== 'ollama')) {
    throw new Error('--provider anthropic|ollama es obligatorio');
  }
  if (!out.model) throw new Error('--model es obligatorio');
  if (!out.queries) throw new Error('--queries (ruta del TSV) es obligatorio');
  if (!out.prompt) throw new Error('--prompt (ruta del prompt) es obligatorio');

  return {
    provider: out.provider as 'anthropic' | 'ollama',
    model: out.model,
    queries: out.queries,
    prompt: out.prompt,
    baseUrl: out.baseUrl,
    authToken: out.authToken,
    limit: out.limit ? parseInt(out.limit, 10) : undefined,
    category: out.category,
    apiKey: out.apiKey ?? process.env.ANTHROPIC_API_KEY,
  };
}

interface QueryRow {
  msg_id: string;
  chat_hash: string;
  user_hash: string;
  fecha: string;
  categoria: string;
  chars: string;
  contenido_oneline: string;
}

function loadQueries(path: string): QueryRow[] {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const header = lines.shift()!.split('\t');
  return lines.map((line) => {
    const cols = line.split('\t');
    const r: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      r[header[i]] = cols[i] ?? '';
    }
    return r as unknown as QueryRow;
  });
}

function buildProvider(args: CliArgs): LLMProvider {
  if (args.provider === 'anthropic') {
    if (!args.apiKey) throw new Error('ANTHROPIC_API_KEY env var o --apiKey es obligatorio');
    return new AnthropicLLM({ apiKey: args.apiKey, model: args.model });
  }
  return new OllamaLLM({
    baseUrl: args.baseUrl ?? 'http://localhost:11434/v1',
    model: args.model,
    authToken: args.authToken,
    timeoutMs: 120_000,
  });
}

function antToolsToLlmTools(): LLMTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema,
  }));
}

interface EvalResult {
  msg_id: string;
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
}

async function evalQuery(
  provider: LLMProvider,
  modelLabel: string,
  staticPart: string,
  dynamicPart: string,
  tools: LLMTool[],
  row: QueryRow
): Promise<EvalResult> {
  const messages: LLMMessage[] = [
    { role: 'user', content: row.contenido_oneline },
  ];
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
        maxTokens: 1024,
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

  return {
    msg_id: row.msg_id,
    categoria: row.categoria,
    query: row.contenido_oneline,
    provider: provider.name,
    model: modelLabel,
    ok,
    num_turns: turns,
    tools_called: toolsCalled,
    first_tool: toolsCalled[0] ?? null,
    final_text_length: finalText.length,
    final_text: finalText,
    latency_ms_total: totalLatency,
    usage: { input: totalIn, output: totalOut, ...(totalCached > 0 ? { cached: totalCached } : {}) },
    ...(error ? { error } : {}),
  };
}

async function main() {
  const args = parseArgs();
  process.stderr.write(`[eval] provider=${args.provider} model=${args.model}\n`);

  const promptAgente = readFileSync(args.prompt, 'utf8');
  process.stderr.write(`[eval] prompt cargado: ${promptAgente.length} chars\n`);

  let queries = loadQueries(args.queries);
  process.stderr.write(`[eval] queries cargadas: ${queries.length}\n`);

  if (args.category) {
    queries = queries.filter((q) => q.categoria === args.category);
    process.stderr.write(`[eval] filtro categoria=${args.category}: ${queries.length} restantes\n`);
  }
  if (args.limit) {
    queries = queries.slice(0, args.limit);
    process.stderr.write(`[eval] limit=${args.limit}\n`);
  }

  const { staticPart, dynamicPart } = await buildSystemPrompt(
    '',                       // fallback vacío — siempre debería usar el archivo
    [],                       // memoria equipo: vacía para eval
    null,                     // sin sesión activa
    async () => promptAgente,
  );

  const provider = buildProvider(args);
  const tools = antToolsToLlmTools();

  process.stderr.write(`[eval] staticPart=${staticPart.length} chars, ${tools.length} tools\n`);
  process.stderr.write(`[eval] arrancando...\n\n`);

  const stats = {
    total: 0,
    ok: 0,
    errors: 0,
    by_first_tool: new Map<string, number>(),
    by_category: new Map<string, { total: number; ok: number }>(),
    total_in: 0,
    total_out: 0,
    total_cached: 0,
    total_latency: 0,
  };

  for (const row of queries) {
    const result = await evalQuery(provider, args.model, staticPart, dynamicPart, tools, row);
    process.stdout.write(JSON.stringify(result) + '\n');

    stats.total++;
    if (result.ok) stats.ok++;
    else stats.errors++;
    const ft = result.first_tool ?? '(direct)';
    stats.by_first_tool.set(ft, (stats.by_first_tool.get(ft) ?? 0) + 1);
    const cat = stats.by_category.get(result.categoria) ?? { total: 0, ok: 0 };
    cat.total++;
    if (result.ok) cat.ok++;
    stats.by_category.set(result.categoria, cat);
    stats.total_in += result.usage.input;
    stats.total_out += result.usage.output;
    stats.total_cached += result.usage.cached ?? 0;
    stats.total_latency += result.latency_ms_total;

    const flag = result.ok ? '✓' : '✗';
    process.stderr.write(
      `${flag} ${result.msg_id.padStart(5)} [${result.categoria.padEnd(15)}] turns=${result.num_turns} first=${ft} ${result.latency_ms_total}ms\n`
    );
  }

  process.stderr.write('\n[stats]\n');
  process.stderr.write(`  total: ${stats.total}\n`);
  process.stderr.write(`  ok:    ${stats.ok} (${((stats.ok / stats.total) * 100).toFixed(1)}%)\n`);
  process.stderr.write(`  errors: ${stats.errors}\n`);
  process.stderr.write(`  tokens: in=${stats.total_in} out=${stats.total_out} cached=${stats.total_cached}\n`);
  process.stderr.write(`  latency total: ${stats.total_latency}ms, avg: ${(stats.total_latency / stats.total).toFixed(0)}ms\n`);

  process.stderr.write('\n[first_tool distribution]\n');
  for (const [tool, n] of [...stats.by_first_tool.entries()].sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${tool.padEnd(35)} ${n}\n`);
  }

  process.stderr.write('\n[por categoria]\n');
  for (const [cat, s] of [...stats.by_category.entries()].sort((a, b) => b[1].total - a[1].total)) {
    process.stderr.write(`  ${cat.padEnd(20)} ${s.ok}/${s.total} ok\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[FATAL] ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
