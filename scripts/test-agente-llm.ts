/**
 * Test de regresión del agente conversacional contra la API real de Anthropic
 * (unos centavos por corrida — NO entra en `npm test` por defecto, ver
 * scripts/test-suite.mjs grupo 'llm').
 *
 * Corre scripts/migracion-llm-local/regresion_sesion.tsv -- los fallos reales
 * de producción documentados en el plan de Fase 0-5 (sesión pegada
 * secuestrando preguntas de cartera completa, nombres de tool viejos, etc.)
 * -- y falla si el modelo deja de elegir la tool correcta. Red de seguridad
 * para cualquier cambio futuro de prompt o de modelo.
 *
 * Uso: npx tsx scripts/test-agente-llm.ts [--model claude-sonnet-5]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function cargarEnv() {
  let envContent = '';
  try {
    envContent = readFileSync('.env.local', 'utf8');
  } catch {
    envContent = readFileSync('../../../.env.local', 'utf8');
  }
  // split en \r?\n: .env.local tiene CRLF -- con split('\n') a secas cada
  // línea queda con un \r colgando al final, y como `.` en JS no matchea
  // \r, la regex de abajo nunca hace match y NINGUNA variable se carga
  // (confirmado: así estaba en los otros scripts que copiaron este patrón).
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

let failures = 0;
function assert(cond: boolean, label: string, detalle?: string) {
  if (cond) {
    console.log(`    OK    ${label}`);
  } else {
    failures++;
    console.error(`    FAIL  ${label}${detalle ? ' — ' + detalle : ''}`);
  }
}

interface FilaTsv {
  msg_id: string;
  categoria: string;
  contenido_oneline: string;
  expected_tool: string;
  sesion: string;
}

function cargarTsv(path: string): FilaTsv[] {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const header = lines.shift()!.split('\t');
  return lines.map((line) => {
    const cols = line.split('\t');
    const r: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) r[header[i]] = cols[i] ?? '';
    return r as unknown as FilaTsv;
  });
}

function parseModelArg(): string {
  const idx = process.argv.indexOf('--model');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
}

async function main() {
  cargarEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY no configurada — no se puede correr este test.');
    process.exit(1);
  }

  const { AnthropicLLM } = await import('../lib/llm/anthropic');
  const { TOOLS } = await import('../lib/telegram/tools');
  const { buildSystemPrompt } = await import('../lib/telegram/agent-prompt');
  const { ejecutarCasoEval } = await import('./migracion-llm-local/eval-core');

  const dir = dirname(fileURLToPath(import.meta.url));
  const filas = cargarTsv(join(dir, 'migracion-llm-local', 'regresion_sesion.tsv'));

  const model = parseModelArg();
  const provider = new AnthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, model });
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.input_schema }));

  console.log(`\n=== TEST regresión agente LLM (${model}, API real) ===\n`);

  for (const fila of filas) {
    const sesion =
      fila.sesion && fila.sesion.trim() !== '' && fila.sesion.trim() !== '-'
        ? (() => {
            const [codigo, nombre] = fila.sesion.split('|');
            return codigo ? { codigo_cliente: codigo.trim(), nombre_cliente: (nombre ?? codigo).trim() } : null;
          })()
        : null;

    const { staticPart, dynamicPart } = await buildSystemPrompt([], sesion);
    const expected = fila.expected_tool.trim() === '-' ? null : fila.expected_tool.trim();

    const resultado = await ejecutarCasoEval(
      provider,
      model,
      staticPart,
      dynamicPart,
      tools,
      { id: fila.msg_id, categoria: fila.categoria, texto: fila.contenido_oneline, expectedTool: expected }
    );

    assert(
      resultado.assertion_pass === true,
      `[${fila.msg_id}] "${fila.contenido_oneline}" -> ${resultado.first_tool ?? '(ninguna)'}`,
      resultado.assertion_pass === false ? `esperado: ${expected ?? '(ninguna)'}` : resultado.error
    );
  }

  console.log();
  if (failures === 0) {
    console.log('=== TODOS OK ===');
    process.exit(0);
  } else {
    console.error(`=== ${failures} ASSERT(S) FALLARON ===`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('ERROR FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
