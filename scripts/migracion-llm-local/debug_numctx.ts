/**
 * Verifica si options.num_ctx está siendo respetado por el endpoint OpenAI-compat
 * de Ollama. Si los prompt_tokens reportados varían con num_ctx, está honrando.
 * Si quedan iguales (truncados), no está honrando y debemos usar /api/chat.
 */

import { readFileSync } from 'node:fs';
import { TOOLS } from '@/lib/telegram/tools';
import { buildSystemPrompt } from '@/lib/telegram/agent-prompt';

const promptAgente = readFileSync('scripts/migracion-llm-local/validation_prompt.txt', 'utf8');

const tools = TOOLS.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema,
  },
}));

let systemText = '';

async function test(numCtx: number) {
  const body = {
    model: 'qwen2.5-cobros:14b',
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: 'Hola.' },
    ],
    max_tokens: 50,
    temperature: 0.2,
    top_p: 0.8,
    stream: false,
    options: { num_ctx: numCtx, num_predict: 50, top_k: 20, repeat_penalty: 1.05 },
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
  };
  const t0 = Date.now();
  const r = await fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json();
  const promptTokens = j.usage?.prompt_tokens;
  const completionTokens = j.usage?.completion_tokens;
  console.log(
    `num_ctx=${numCtx}: prompt_tokens=${promptTokens} completion_tokens=${completionTokens} latency=${Date.now() - t0}ms`,
  );
}

async function main() {
  const { staticPart, dynamicPart } = await buildSystemPrompt(
    '',
    [],
    null,
    async () => promptAgente,
  );
  systemText = [staticPart, dynamicPart].filter(Boolean).join('\n\n');
  console.log(`systemText=${systemText.length} chars, tools=${tools.length}`);
  await test(2048);
  await test(8192);
  await test(16384);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
