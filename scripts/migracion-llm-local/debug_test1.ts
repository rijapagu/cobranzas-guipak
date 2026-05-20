/**
 * Debug TEST 1: replica el request del eval-runner pero loguea la respuesta
 * cruda de Ollama antes de cualquier parseo, para entender por qué la respuesta
 * viene con finish_reason no esperado y 0 tokens.
 *
 * Uso:
 *   npx tsx scripts/migracion-llm-local/debug_test1.ts
 */

import { readFileSync } from 'node:fs';
import { TOOLS } from '@/lib/telegram/tools';
import { buildSystemPrompt } from '@/lib/telegram/agent-prompt';

const OLLAMA_URL = 'http://localhost:11434/v1/chat/completions';
const MODEL = 'qwen2.5:14b-instruct-q4_K_M';
const PROMPT_PATH = 'scripts/migracion-llm-local/validation_prompt.txt';
const QUERY = '¿Cómo va el día hoy? Dame el resumen del estado de cobros.';

async function main() {
  const promptAgente = readFileSync(PROMPT_PATH, 'utf8');
  const { staticPart, dynamicPart } = await buildSystemPrompt(
    '',
    [],
    null,
    async () => promptAgente,
  );
  const systemText = [staticPart, dynamicPart].filter(Boolean).join('\n\n');

  const tools = TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: t.input_schema,
    },
  }));

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: QUERY },
    ],
    max_tokens: 1024,
    temperature: 0.2,
    top_p: 0.8,
    stream: false,
    options: {
      num_ctx: 16384,
      num_predict: 1024,
      top_k: 20,
      repeat_penalty: 1.05,
    },
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
  };

  console.error(`[debug] systemText=${systemText.length} chars, tools=${tools.length}`);
  console.error(`[debug] body size=${JSON.stringify(body).length} chars`);

  const t0 = Date.now();
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const latency = Date.now() - t0;
  console.error(`[debug] HTTP ${res.status} ${res.statusText} en ${latency}ms`);

  const text = await res.text();
  console.error(`[debug] raw response (${text.length} chars):`);
  console.error('---START---');
  console.error(text);
  console.error('---END---');

  try {
    const json = JSON.parse(text);
    console.error('\n[debug] parsed:');
    console.error('  choices[0].finish_reason:', json.choices?.[0]?.finish_reason);
    console.error('  choices[0].message.content:', JSON.stringify(json.choices?.[0]?.message?.content));
    console.error('  choices[0].message.tool_calls:', JSON.stringify(json.choices?.[0]?.message?.tool_calls));
    console.error('  usage:', JSON.stringify(json.usage));
  } catch (e) {
    console.error('[debug] no se pudo parsear JSON:', e);
  }
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
