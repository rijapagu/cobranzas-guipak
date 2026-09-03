/**
 * Eval runner — corre el banco de queries contra un proveedor de LLM
 * usando el mismo system prompt y tools que producción, con tools mockeadas.
 *
 * USO:
 *   npx tsx scripts/migracion-llm-local/03_eval_runner.ts \
 *     --provider anthropic \
 *     --model claude-sonnet-5 \
 *     --queries scripts/migracion-llm-local/regresion_sesion.tsv \
 *     [--prompt scripts/migracion-llm-local/prompt_agente.txt] \
 *     [--effort medium] [--maxTokens 4096] \
 *     [--limit 20] [--category saldo_cliente] \
 *     > results.jsonl
 *
 * --prompt es OPCIONAL (2026-09-03) -- sin él, usa PROMPT_TONO_BASE de código
 * (igual que producción sin override en Configuración). Pásalo solo para
 * probar un tono candidato antes de guardarlo.
 *
 * El TSV admite dos columnas opcionales, sin romper TSVs viejos que no las
 * tengan:
 *   expected_tool  — nombre exacto de la tool que se espera como PRIMER tool
 *                     call. '-' significa "se espera responder sin tool".
 *                     Vacío/ausente = sin aserción (fila solo informativa).
 *   sesion         — "codigo|nombre" para simular un cliente pegado en la
 *                     sesión (prueba el carve-out de Fase 0 / la ficha de
 *                     Fase 4). Vacío/ausente/'-' = sin sesión.
 *
 * Si CUALQUIER fila con expected_tool falla la aserción, termina con exit 1.
 *
 * SALIDA: una línea JSON por query (JSONL) a stdout. Stats a stderr.
 */

import { readFileSync } from 'node:fs';
import { AnthropicLLM } from '@/lib/llm/anthropic';
import { OllamaLLM } from '@/lib/llm/ollama';
import type { LLMProvider, LLMTool } from '@/lib/llm/types';
import { TOOLS } from '@/lib/telegram/tools';
import { buildSystemPrompt } from '@/lib/telegram/agent-prompt';
import type { SesionChat } from '@/lib/telegram/session';
import { ejecutarCasoEval, type CasoEval } from './eval-core';

interface CliArgs {
  provider: 'anthropic' | 'ollama';
  model: string;
  queries: string;
  prompt?: string;
  baseUrl?: string;
  authToken?: string;
  limit?: number;
  category?: string;
  apiKey?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxTokens: number;
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

  const effort = out.effort as CliArgs['effort'];
  if (effort && !['low', 'medium', 'high', 'max'].includes(effort)) {
    throw new Error('--effort debe ser low|medium|high|max');
  }

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
    effort,
    maxTokens: out.maxTokens ? parseInt(out.maxTokens, 10) : 4096,
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
  expected_tool?: string;
  sesion?: string;
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

/** '-' o vacío -> sin aserción (undefined). Otro valor -> el nombre exacto ('-' propio del expected_tool ya se maneja en parseExpectedTool). */
function parseExpectedTool(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  if (raw.trim() === '-') return null;
  return raw.trim();
}

function parseSesion(raw: string | undefined): SesionChat | null {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return null;
  const [codigo, nombre] = raw.split('|');
  if (!codigo || !codigo.trim()) return null;
  return { codigo_cliente: codigo.trim(), nombre_cliente: (nombre ?? codigo).trim() };
}

function buildProvider(args: CliArgs): LLMProvider {
  if (args.provider === 'anthropic') {
    if (!args.apiKey) throw new Error('ANTHROPIC_API_KEY env var o --apiKey es obligatorio');
    return new AnthropicLLM({ apiKey: args.apiKey, model: args.model, effort: args.effort });
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

async function main() {
  const args = parseArgs();
  process.stderr.write(`[eval] provider=${args.provider} model=${args.model} effort=${args.effort ?? '(default)'} maxTokens=${args.maxTokens}\n`);

  const promptOverride = args.prompt ? readFileSync(args.prompt, 'utf8') : undefined;
  process.stderr.write(
    promptOverride
      ? `[eval] prompt override cargado: ${promptOverride.length} chars\n`
      : `[eval] sin --prompt: usando PROMPT_TONO_BASE de código (igual que producción sin override)\n`
  );

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

  const provider = buildProvider(args);
  const tools = antToolsToLlmTools();
  process.stderr.write(`[eval] ${tools.length} tools, arrancando...\n\n`);

  const stats = {
    total: 0,
    ok: 0,
    errors: 0,
    asserted: 0,
    asserted_pass: 0,
    by_first_tool: new Map<string, number>(),
    by_category: new Map<string, { total: number; ok: number }>(),
    total_in: 0,
    total_out: 0,
    total_cached: 0,
    total_latency: 0,
  };
  const fallas: string[] = [];

  for (const row of queries) {
    const sesion = parseSesion(row.sesion);
    // La sesión (y por Fase 4 la ficha del cliente) varía por fila -- no se
    // puede precomputar un solo dynamicPart para todo el batch.
    const { staticPart, dynamicPart } = await buildSystemPrompt(
      [],
      sesion,
      promptOverride ? async () => promptOverride : undefined
    );

    const caso: CasoEval = {
      id: row.msg_id,
      categoria: row.categoria,
      texto: row.contenido_oneline,
      expectedTool: parseExpectedTool(row.expected_tool),
    };
    const result = await ejecutarCasoEval(provider, args.model, staticPart, dynamicPart, tools, caso, args.maxTokens);
    process.stdout.write(JSON.stringify(result) + '\n');

    stats.total++;
    if (result.ok) stats.ok++;
    else stats.errors++;
    if (result.assertion_pass !== undefined) {
      stats.asserted++;
      if (result.assertion_pass) stats.asserted_pass++;
      else fallas.push(`${result.id} "${result.query}" -> ${result.first_tool ?? '(ninguna)'} (esperado: ${result.expected_tool ?? '(ninguna)'})`);
    }
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

    const flag = result.assertion_pass === false ? '✗ASSERT' : result.ok ? '✓' : '✗';
    process.stderr.write(
      `${flag} ${result.id.padStart(5)} [${result.categoria.padEnd(15)}] turns=${result.num_turns} first=${ft} ${result.latency_ms_total}ms\n`
    );
  }

  process.stderr.write('\n[stats]\n');
  process.stderr.write(`  total: ${stats.total}\n`);
  process.stderr.write(`  ok:    ${stats.ok} (${((stats.ok / stats.total) * 100).toFixed(1)}%)\n`);
  process.stderr.write(`  errors: ${stats.errors}\n`);
  if (stats.asserted > 0) {
    process.stderr.write(`  aserciones (expected_tool): ${stats.asserted_pass}/${stats.asserted}\n`);
  }
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

  if (fallas.length > 0) {
    process.stderr.write(`\n[FALLAS DE ASERCIÓN] (${fallas.length})\n`);
    for (const f of fallas) process.stderr.write(`  ${f}\n`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`[FATAL] ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
