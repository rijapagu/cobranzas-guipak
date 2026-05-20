# Mejores prácticas para tool calling con LLMs locales

> **Estado:** Referencia técnica permanente.
> **Origen:** Research 2026-05-20 sobre BFCL v3/v4, LongFuncEval, docs oficiales Qwen/Ollama/Hermes, issues abiertos de Ollama.
> **Alcance:** Aplicable a cualquier LLM open source ≤14B corriendo en Ollama local — Qwen 2.5/3, Llama 3.1, Hermes 3, DeepSeek, xLAM, etc.
> **Lectura sugerida cuando:** se reabre la conversación con un LLM local sobre routing, esquema de tools, parámetros de inferencia, o se evalúa un modelo nuevo.

---

## 1. Formato de prompts para tool calling

### Diferencias por familia de modelos

| Familia | Formato nativo | Notas |
|---|---|---|
| **Qwen 2.5 / Qwen 3** | Hermes/Nous XML (`<tool_call>{...}</tool_call>`) | Documentación oficial recomienda Hermes-style |
| **Llama 3.1** | Native tool calling entrenado (`<\|python_tag\|>` o JSON inline) | Vence a Qwen 2.5 7B en algunos benchmarks BFCL |
| **Hermes 3 (Nous)** | XML originator, el más permisivo con tools custom | Mejor multi-turn agentic |
| **DeepSeek R1** | Razonamiento con `<think>` | **NO usar para tool calling directo** — el thinking rompe el parser |
| **xLAM** | Native function calling (fine-tuneado sobre Llama 3.1) | Top sub-8B en BFCL v3 (~0.78) |

**Lo que Ollama hace por debajo:** traduce el request OpenAI a un template Go por modelo. Para Qwen, renderiza tools como bloques Hermes XML en el system prompt. Cuando el modelo emite `<tool_call>{...}</tool_call>`, un parser Go intenta extraerlo y devolverlo en `tool_calls`. **Si el modelo malforma el XML, el parser falla y el tool call queda en `content`** — origen del bug del `sourceMapping({...})` que vimos.

### System message efectivo

Patrón validado en Qwen-Agent y NVIDIA LLM Router:

```
1. Rol + IDIOMA ANCLADO en la primera línea
   "Eres asistente de Cobros Guipak. IDIOMA: español rioplatense.
   NUNCA respondas en inglés, ni siquiera para nombres de funciones internas."

2. Política de tools en bullet points cortos (NO prosa)
   - Llamá una sola tool por turno salvo que sean lecturas independientes.
   - Antes de llamar, confirmá con el usuario si la acción es destructiva.
   - Si la tool falla, NO inventes la respuesta — devolvé el error.

3. Cuándo NO llamar tools (más importante que cuándo sí)
   - El usuario solo está conversando, sin pedir acción concreta.
   - La información ya está en el historial.

4. Formato de salida cuando no hay tool call
   "Respondé en texto plano natural en español. NO emitas JSON ni XML."
```

### Few-shot examples (modelos ≤14B)

- **Si ayudan:** 2-3 ejemplos cortos (~400 tokens total) que demuestren **irrelevance detection** ("usuario solo saluda → no llamar tool") o **multi-tool** ("pidió email → primero consultá contacto, luego redactá").
- **Si estorban:** ejemplos largos consumiendo contexto que debería ir a tool definitions, o ejemplos de "tool simple" obvios.
- **Regla:** medir token count del prompt completo. Si excede 4K tokens solo en definiciones + ejemplos, estás trabajando contra el modelo.

---

## 2. Esquema de las tools

### Sweet spot de longitud de `description`

- **50-150 tokens por tool.** Más de 200 tokens empieza a degradar.
- 25 tools × 1,600 tokens = 40K tokens **solo de definiciones** — no cabe en `num_ctx=8192` default.
- Estructura "Cuándo usar / Qué hace / Devuelve / Pre-condiciones / NO usar si" está bien conceptualmente; **comprimir a 4 líneas máximo**.

### Schemas estrictos vs permisivos

**Para modelos ≤14B, schemas estrictos ganan.**

```ts
// Bien (estricto, narrow)
{
  type: 'object',
  properties: {
    canal_efectivo: {
      type: 'string',
      enum: ['EMAIL', 'WHATSAPP', 'LLAMADA', 'OTRO'],
      description: 'Canal que ha respondido mejor'
    }
  },
  required: ['codigo_cliente', 'canal_efectivo'],
  additionalProperties: false
}

// Mal (permisivo, anidado)
{
  type: 'object',
  properties: {
    info: {
      type: 'object',
      properties: {
        cliente: { type: 'object', ... }  // ← Qwen 2.5 7B alucina aquí
      }
    }
  }
}
```

**Reglas:**
- `enum` siempre que sea posible — reduce alucinaciones ~40% (ToolACE paper).
- `required` explícito, ≤3 fields por tool ideal.
- `additionalProperties: false`.
- **NO anidar más de 2 niveles.**
- `pattern` regex en strings críticos (cédula, código de cliente).
- `description` de cada parámetro con **1 ejemplo válido inline** (`'Código del cliente. Ejemplo: "0000274"'`).

### Defensa contra argumentos inventados (3 capas)

1. **Schema-level:** `enum` + `pattern` + `required` mínimo.
2. **Validation-level (cliente TS):** Zod valida tool args ANTES de ejecutar la tool. Si falla → mensaje `tool` de error específico al LLM.
3. **Heuristic-level:** rechazar valores "sospechosamente genéricos" (ej. `cliente_id: "12345"`, `nombre: "Cliente Ejemplo"`).

### Campos a evitar en JSON Schema con ≤14B

`default`, `examples`, `oneOf`, `anyOf` confunden a Qwen 2.5 7B (irrelevance score baja ~12% según BFCL v3).
Mantener solo: `type`, `description`, `enum`, `required`, `pattern`, `additionalProperties`.

---

## 3. Límites prácticos de modelos ≤14B

### BFCL v3/v4 leaderboard (rankings 2025-2026)

| Modelo | BFCL score | Notas |
|---|---|---|
| **xLAM-2-8b-fc-r** (Salesforce) | ~0.78 (top sub-8B) | Llama 3.1 8B fine-tuneado sobre 60K samples. **Mejor opción ≤8B hoy.** |
| **Qwen 3 14B** | ~0.70-0.72 | Mejor multi-turn que Qwen 2.5 14B |
| **Qwen 2.5 14B** | ~0.68 (0.971 F1 tool selection) | Modelo actual de Cobros. Sólido pero con bugs conocidos en Ollama |
| **Hermes 3 8B (Nous)** | ~0.67 | Mejor multi-step / agentic |
| **Llama 3.1 8B Instruct** | ~0.65 | Tool calling nativo, decente |
| **Qwen 2.5 7B** | ~0.63 | Aceptable para router/intent, no para tool execution principal |
| DeepSeek-R1-Distill-Qwen-32B | degrada 86% | Razonamiento, NO tool calling |

### Cuántas tools simultáneas soportan razonablemente

Datos de LongFuncEval (paper 2025) sobre modelos 8B clase:

| # tools simultáneas | Degradación accuracy |
|---|---|
| 8 | 0% (baseline) |
| 20-25 | 30-50% |
| 40+ | 60-80% |
| 120K tokens (~700 tools) | Llama 3.1 8B cae 76% |

**Umbral práctico Qwen 2.5 14B Q4 en 12GB VRAM: 8-10 tools simultáneas máximo.**

Esto valida el patrón **router + tools narrow por contexto**: exponer solo 3-7 tools del contexto correcto, no las 25+ del catálogo completo.

### Candidatos a evaluar lado-a-lado contra Qwen 2.5 14B

1. **xLAM-2-8b-fc-r** — top-1 sub-8B, cabe en 5GB Q4, fine-tuned para tool calling. [HF GGUF](https://huggingface.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf).
2. **Qwen 3 14B Instruct** — Q4_K_M cabe en 12GB. Mejor irrelevance detection.
3. **Hermes 3 8B (Nous)** — formato XML nativo (sin traducción Ollama).

---

## 4. Patrones de arquitectura

### Router/intent classifier antes del LLM principal

**Validado empíricamente** en múltiples stacks 2025:
- NVIDIA LLM Router usa Qwen 1.7B como classifier.
- vLLM Semantic Router usa embeddings + cosine similarity.
- LangGraph oficial: "supervisor pattern" con router → sub-agentes especializados.
- OpenAI Assistants v2 incorpora un retriever para shortlistar tools.

### Tres opciones de router

1. **Embeddings + cosine similarity** (`nomic-embed-text` ya en stack).
   - Sub-50ms.
   - Cero alucinación, determinista.
   - Requiere training set: 10-20 queries-ejemplo por contexto.
   - **Recomendado para Cobros.**

2. **LLM pequeño dedicado** (qwen2.5:3b o qwen-fast).
   - 150-300ms.
   - Sin training, solo system prompt.
   - Más flexible pero más lento.

3. **Reglas/keywords** (regex).
   - Sub-1ms.
   - Cero ambigüedad.
   - Frágil con expresiones variadas.
   - Bueno como first-pass + LLM/embeddings como fallback.

### Cascada de fallback (3 niveles)

```
[Nivel 1 — Local]
  Qwen 2.5 14B con tools narrow del contexto
    │
    │ Tool call no valida contra schema?
    ▼
  1 retry con feedback estructurado
    (mensaje `tool` específico: "campo X esperaba Y, recibió Z")
    │
    │ Falla retry?
    ▼
[Nivel 2 — Escalación]
  Anthropic Haiku 4.5 con el mismo contexto
    │
    │ Falla?
    ▼
[Nivel 3 — Abort]
  Devolver al usuario: "no pude procesar tu solicitud, pasame más contexto"
  NUNCA inventar la respuesta.
```

**Anti-patrón:** retry infinito local. Modelos ≤14B colapsan en loops — typically siguen produciendo el mismo error.

### `parallel_tool_calls`: desactivar por default

Qwen 2.5 14B llama tools en paralelo "por si acaso" (síntoma observado en Cobros). Pasar `parallel_tool_calls: false` en cada request elimina esto. Activar solo en contextos donde sabés que querés paralelismo (ej. bulk fetch de N clientes).

---

## 5. Errores comunes y workarounds

### Drift de idioma (Qwen → inglés)

1. **Anclar idioma LITERALMENTE en system prompt + primera línea:**
   ```
   IDIOMA: español rioplatense. NUNCA respondas en inglés, ni siquiera
   para nombres de funciones internas o JSON keys.
   ```

2. **Repetir el ancla en el último user message** (técnica "primacy + recency"). En conversaciones largas el system se diluye.

3. **`logit_bias` negativo en tokens inglés comunes** — **NO disponible en Ollama** (confirmado en docs). Solo aplica si migrás a vLLM.

### Argumentos inventados

Defensa en 3 capas: schema → Zod validation → heuristic check. Si falla validación → mensaje `tool` específico al LLM con el error → 1 retry → si falla, fallback a Haiku.

### Salida no-estructurada cuando se esperaba tool call

Síntoma típico de Qwen 2.5 14B en Ollama: el modelo genera la tool call pero el template parser de Ollama no la captura y la deja en `content` (origen del `sourceMapping({...})`).

**Workaround empírico — post-procesamiento defensivo en cliente TS:**

```ts
// Si response.message.tool_calls está vacío pero content contiene
// <tool_call>...</tool_call> o JSON con pinta de tool call, parsearlo manualmente.

const TOOL_CALL_LEAK_REGEX = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>|```?(?:json)?\s*(\{[\s\S]*?"name"[\s\S]*?"arguments"[\s\S]*?\})/;

function recoverLeakedToolCall(content: string): { name: string; arguments: object } | null {
  const match = content.match(TOOL_CALL_LEAK_REGEX);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1] || match[2]);
    if (parsed.name && parsed.arguments) {
      return parsed;
    }
  } catch { /* fall through */ }
  return null;
}
```

### Bug del "thinking field" droppea tool_calls

[litellm#18922](https://github.com/BerriAI/litellm/issues/18922): cuando Qwen3 o DeepSeek emiten `thinking`, Ollama puede perder el `tool_calls`. Fix: pasar `"think": false` en el request o usar Modelfile con `SYSTEM /no_think`.

### Versión de Ollama

- **0.9.0:** estable para Qwen 3.
- **0.9.2:** regresión documentada en tool calling con Qwen 3 ([ollama#11135](https://github.com/ollama/ollama/issues/11135)).
- **Post-0.9.5:** revisar issues antes de upgrade.

Verificar versión actual y considerar pinning en docs del proyecto.

---

## 6. Configuración Ollama recomendada

### Parámetros tunables para tool calling

| Parámetro | Default Ollama | Recomendado tool calling | Por qué |
|---|---|---|---|
| `temperature` | 0.7 (Qwen) | **0.2** | Reduce alucinación de field names |
| `top_p` | 1.0 | **0.8** | Recomendación oficial Qwen 3 |
| `top_k` | 40 | **20** | Recomendación oficial Qwen 3 non-thinking |
| `num_ctx` | **2048** | **16384** (mínimo 8192) | Con 25 tools NO ALCANZA el default |
| `num_predict` | -1 (sin límite) | **512-1024** | Suficiente para tool calls, evita runaway |
| `repeat_penalty` | 1.1 | **1.05** | Recomendación Qwen |
| `parallel_tool_calls` | true | **false** | Qwen ≤14B paraleliza "por si acaso" |
| `stream` | true | **false en endpoints con tools** | Streaming fragmenta `<tool_call>` XML |
| `stop` | (defaults) | añadir `<\|im_end\|>`, `</tool_call>` | Acelera cierre (opcional) |
| `think` | true (Qwen3/DS-R1) | **false** | Evita el bug del thinking → tool_calls dropped |

### Snippet TypeScript de configuración

```ts
const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen2.5:14b-instruct-q4_K_M',
    messages,
    tools: filteredToolsForContext, // ← post-router, no las 25
    parallel_tool_calls: false,
    temperature: 0.2,
    top_p: 0.8,
    stream: false,
    // Ollama-specific opcional vía body extra:
    options: {
      num_ctx: 16384,
      num_predict: 1024,
      top_k: 20,
      repeat_penalty: 1.05,
    },
  }),
});
```

### Limitaciones conocidas Ollama (no soportado)

- `tool_choice` (forzar una tool específica) — workaround: pasar solo esa tool en `tools: []`.
- `logit_bias` (anclar idioma a nivel logits).
- `user`, `n` (multi-completion).

---

## 7. Plan de eval xLAM-2-8b vs Qwen 2.5 14B

### Por qué evaluar

xLAM-2-8b-fc-r es Llama 3.1 8B fine-tuneado por Salesforce específicamente sobre 60K samples de function calling. BFCL v3 lo ranquea **top-1 entre modelos ≤8B open source**. Si en nuestro eval gana a Qwen 14B:
- Libera ~3GB de VRAM (5GB Q4 vs 8GB Q4).
- Menor latencia (~40% más rápido).
- Mejor irrelevance detection según paper.

Si no gana, descartado en 1-2 días sin costo más allá del eval.

### Pasos

1. **Bajar el GGUF:**
   ```bash
   # Desde Robocop
   ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:Q4_K_M
   ```
   O alternativa: descargar el GGUF directo de HF y crear Modelfile.

2. **Modelfile** (si hace falta override de parámetros):
   ```
   FROM hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:Q4_K_M
   PARAMETER temperature 0.2
   PARAMETER top_p 0.9
   PARAMETER num_ctx 16384
   PARAMETER stop "<|eot_id|>"
   ```

3. **Banco de queries:** reusar el eval-runner que ya existe (`scripts/migracion-llm-local/03_eval_runner.ts`) con el TSV exportado de `cobranza_telegram_historial`.

4. **Métricas a comparar:**
   - % routing correcto (intent detection accuracy).
   - % tool correcto en T1.
   - # turnos hasta resolver.
   - Latencia p50/p95.
   - VRAM peak durante inferencia.
   - Errores de tool execution (idealmente 0 post-fix bug §11).

5. **Criterio de cambio:** si xLAM logra ≥95% del score de Qwen 14B con latencia menor, **candidato a default**. Si entre 80-95%, mantener Qwen como default y xLAM como alternativa para canary. Si <80%, descartar.

### Riesgos del cambio

- xLAM responde en inglés por default (Llama-base). Anclar idioma agresivamente en system.
- Menos tested en español rioplatense que Qwen 2.5.
- Comunidad más pequeña — menos issues / docs.

---

## 8. Top 5 cambios accionables para Cobros (orden por impacto/esfuerzo)

| # | Cambio | Impacto | Esfuerzo |
|---|---|---|---|
| **1** | Router con `nomic-embed-text` + embeddings antes de exponer tools | **Máximo** (resuelve ~70% de los síntomas) | 2-3 días |
| **2** | Configuración Ollama (`parallel_tool_calls: false`, `temperature: 0.2`, `num_ctx: 16384`, sin streaming) | Alto | 1 hora |
| **3** | Validación Zod + retry con feedback + fallback a Haiku | Alto | 1-2 días |
| **4** | Defensive parsing de `<tool_call>` leaked en `content` | Medio | 4 horas |
| **5** | A/B test xLAM-2-8b vs Qwen 14B en eval-runner existente | Potencial alto | 1-2 días |

**Bonus / no-cambio:** comprimir descripciones verbose actuales a ≤200 tokens por tool. Las 5 sub-fases A-G del refactor (rama `feature/refactor-tools-narrow`) introdujeron descripciones que en algunos casos pasan los 200 tokens. Conceptualmente bien, hay que medir y comprimir las largas.

---

## 9. Fuentes principales

- [BFCL v3/v4 Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) y [paper](https://openreview.net/pdf?id=2GmDdhBdDk)
- [Qwen Function Calling docs](https://qwen.readthedocs.io/en/latest/framework/function_call.html)
- [Ollama OpenAI-compat docs](https://docs.ollama.com/api/openai-compatibility)
- [Ollama tool calling blog](https://ollama.com/blog/tool-support)
- [LongFuncEval paper (2025)](https://arxiv.org/html/2505.10570v1)
- [ToolACE paper](https://arxiv.org/html/2409.00920v1)
- [xLAM paper](https://arxiv.org/pdf/2409.03215)
- [Salesforce xLAM-2-8b-fc-r GGUF](https://huggingface.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf)
- [Qwen-Agent repo](https://github.com/QwenLM/Qwen-Agent)
- [NVIDIA LLM Router Blueprint](https://build.nvidia.com/nvidia/llm-router)
- [vLLM Semantic Router](https://blog.vllm.ai/2025/09/11/semantic-router.html)
- [LangGraph routing pattern](https://medium.com/@huzaifaali4013399/the-routing-pattern-build-smart-multi-agent-ai-workflows-with-langgraph-44f177aadf7a)
- [InsiderLLM function-calling guide](https://insiderllm.com/guides/function-calling-local-llms/)

### Issues de Ollama relevantes

- [#7051](https://github.com/ollama/ollama/issues/7051) — Qwen 2.5 7B alucinando field names en JSON anidado
- [#11135](https://github.com/ollama/ollama/issues/11135) — Regresión Ollama 0.9.2 con Qwen 3 tool calling
- [#11538](https://github.com/ollama/ollama/issues/11538) — Tool calls leaked en content
- [#13968](https://github.com/ollama/ollama/issues/13968) — Mismo bug en 0.9.x
- [#14601](https://github.com/ollama/ollama/issues/14601) — Tool calling instability
- [litellm#18922](https://github.com/BerriAI/litellm/issues/18922) — Thinking field droppea tool_calls

---

## 10. Cuándo actualizar este documento

Cuando:
- Ollama saca versión nueva con cambios en tool calling.
- Cambia el modelo principal (xLAM, Qwen 3, Hermes 3, etc.).
- BFCL publica nueva versión del leaderboard con rankings distintos.
- Aparece un patrón nuevo de bug que requiere workaround.
- Se cambia el endpoint del agente o el cliente TS.

Anotar fecha + cambio al pie:

> **Histórico de cambios:**
> - 2026-05-20: versión inicial.
