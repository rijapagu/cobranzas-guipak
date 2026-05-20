/**
 * Validación end-to-end contra el Gateway IA local.
 *
 * Re-corre TEST 1 y TEST 2 (los mismos que la validación 2026-05-20) pero
 * apuntando al Gateway en vez de directo a Ollama. Compara comportamiento.
 *
 * Uso:
 *   npx tsx scripts/migracion-llm-local/validar_gateway.ts
 *
 * Pre-requisito: Gateway corriendo en http://127.0.0.1:8080 con la extensión
 * de tool calling aplicada (commits del 2026-05-20).
 */

import { readFileSync } from 'node:fs';
import { GatewayLLM } from '@/lib/llm/gateway';
import { TOOLS } from '@/lib/telegram/tools';
import { buildSystemPrompt, MAX_TURNS } from '@/lib/telegram/agent-prompt';
import type { LLMMessage } from '@/lib/llm/types';
import { mockTool } from './tool-mocks';

const QUERIES = [
  { id: 'TEST1', text: '¿Cómo va el día hoy? Dame el resumen del estado de cobros.' },
  { id: 'TEST2', text: 'Recuérdame llamar a Industria Padron el viernes a las 10am.' },
];

async function main() {
  const promptAgente = readFileSync(
    'scripts/migracion-llm-local/validation_prompt.txt',
    'utf8',
  );
  const { staticPart, dynamicPart } = await buildSystemPrompt(
    '',
    [],
    null,
    async () => promptAgente,
  );

  const provider = new GatewayLLM({
    baseUrl: process.env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:8080',
    supervisorName: 'cobranzas',
    preferredTier: 'deep',
  });

  const tools = TOOLS.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema,
  }));

  console.log(`Gateway: ${process.env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:8080'}`);
  console.log(`Tools: ${tools.length}`);
  console.log(`System: ${staticPart.length + dynamicPart.length} chars\n`);

  for (const q of QUERIES) {
    console.log(`=== ${q.id} === ${q.text}`);
    const messages: LLMMessage[] = [{ role: 'user', content: q.text }];
    const toolsCalled: string[] = [];
    let lastText = '';
    let totalMs = 0;
    let totalOut = 0;
    let modelUsed = '';

    for (let turn = 0; turn < MAX_TURNS; turn++) {
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
        console.error(`  T${turn + 1}: ERROR ${e instanceof Error ? e.message : e}`);
        break;
      }
      totalMs += resp.latencyMs;
      totalOut += resp.usage.outputTokens;
      modelUsed = resp.model;
      console.log(
        `  T${turn + 1}: stop=${resp.stopReason} model=${resp.model} ms=${resp.latencyMs} out=${resp.usage.outputTokens} tools=[${resp.toolCalls.map((tc) => tc.name).join(', ')}]`,
      );

      if (resp.stopReason === 'end_turn') {
        lastText = resp.text;
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
      console.error(`  stop_reason inesperado: ${resp.stopReason}`);
      break;
    }

    console.log(`  → tools_called: ${toolsCalled.join(' → ') || '(direct)'}`);
    console.log(`  → model: ${modelUsed}  totalMs: ${totalMs}  outTokens: ${totalOut}`);
    if (lastText) console.log(`  → text: ${lastText.slice(0, 200)}`);
    console.log('');
  }
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
