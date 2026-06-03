/**
 * Cliente del modelo local para el Supervisor Cobros.
 *
 * Habla al gateway IA (Robocop) por su endpoint OpenAI-compat
 * `/v1/chat/completions`, que permite fijar el modelo y los parámetros directo
 * (a diferencia de `/v1/supervisor/:name`, que enruta por tier). Esto replica
 * exactamente la prueba validada el 2026-06-03: deepseek-r1:14b + system prompt
 * few-shot + temperatura controlada.
 *
 * El gateway serializa todas las llamadas en una cola PQueue(concurrency:1), así
 * que no hay colisiones de VRAM aunque coincida con YOLO u otro consumidor.
 *
 * Defensivo: si el gateway está caído o tarda demasiado, lanza un error que el
 * job atrapa por-cliente (una alerta fallida no tumba el resto del lote).
 *
 * Env vars:
 *   GATEWAY_BASE_URL        Ej. 'http://100.67.128.72:8080' (Robocop vía Tailscale)
 *   GATEWAY_AUTH_TOKEN      Bearer opcional
 *   SUPERVISOR_LOCAL_MODEL  Modelo Ollama (default 'deepseek-analyst:latest')
 *   SUPERVISOR_TIMEOUT_MS   Timeout por llamada (default 240000 = 4 min). Holgado
 *                           a propósito: el gateway serializa con YOLO/visión y un
 *                           swap de VRAM en frío puede sumar 1-2 min.
 */

export interface SupervisorLLMResult {
  text: string;
  model: string;
  latencyMs: number;
  /** Payload crudo de la respuesta del gateway, para auditoría. */
  raw: unknown;
}

export interface SupervisorLLMOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

function getBaseUrl(): string {
  return (process.env.GATEWAY_BASE_URL || 'http://100.67.128.72:8080').replace(/\/$/, '');
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { completion_tokens?: number };
  error?: string;
}

/**
 * Genera una respuesta del Supervisor con el modelo local.
 * Lanza si el gateway falla, da timeout, o devuelve vacío.
 */
export async function generarSupervisorLocal(
  opts: SupervisorLLMOptions
): Promise<SupervisorLLMResult> {
  const baseUrl = getBaseUrl();
  const model = process.env.SUPERVISOR_LOCAL_MODEL || 'deepseek-analyst:latest';
  const timeoutMs = Number(process.env.SUPERVISOR_TIMEOUT_MS) || 240_000;
  const authToken = process.env.GATEWAY_AUTH_TOKEN;

  const body = {
    model,
    keep_alive: '15m',
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 2200,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  let json: ChatCompletionResponse;
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
    }
    json = (await res.json()) as ChatCompletionResponse;
  } finally {
    clearTimeout(timer);
  }

  if (json.error) {
    throw new Error(`Gateway error: ${json.error}`);
  }

  const text = (json.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new Error('Gateway devolvió respuesta vacía');
  }

  return {
    text,
    model: json.model ?? model,
    latencyMs: Date.now() - t0,
    raw: json,
  };
}
