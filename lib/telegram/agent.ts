import { TOOLS, ejecutarTool } from './tools';
import type { TelegramUserAuth } from './auth';
import {
  guardarMensaje,
  cargarHistorial,
  cargarMemoriaEquipo,
} from './historial';
import { obtenerSesion, guardarSesion } from './session';
import { buildSystemPrompt, MAX_TURNS, ROUTING_HINT_LOCAL } from './agent-prompt';
import { AnthropicLLM } from '@/lib/llm/anthropic';
import { OllamaLLM } from '@/lib/llm/ollama';
import { GatewayLLM } from '@/lib/llm/gateway';
import type { LLMProvider, LLMMessage, LLMTool } from '@/lib/llm/types';

/**
 * Parte PERSONALIZABLE — puede sobreescribirse desde Configuración (prompt_agente en DB).
 * Contiene: persona/contexto, reglas generales, estilo, tareas, cadencias, conciliación, perfil de riesgo.
 * NO incluir flujos de herramientas — esos van en FLUJOS_OPERACIONALES (agent-prompt.ts).
 */
const SYSTEM_PROMPT_BASE = `Eres el asistente de cobranzas de Suministros Guipak (distribuidora B2B en República Dominicana).

CONTEXTO:
- Hablas con el equipo interno de cobros vía Telegram (grupo "Cobros Guipak").
- Tu rol es ayudar a gestionar la cartera vencida: consultar saldos, proponer mensajes para clientes, dar seguimiento a promesas de pago.
- TODA la operación tiene supervisión humana — nunca envías mensajes a clientes sin aprobación.

SEGMENTOS DE RIESGO (rangos exactos, no inventar otros):
- 🟢 VERDE: facturas que aún NO han vencido (días_vencido ≤ 0)
- 🟡 AMARILLO: 1–15 días vencida
- 🟠 NARANJA: 16–30 días vencida
- 🔴 ROJO: más de 30 días vencida (31+)
Cuando muestres distribución por segmento, usa SIEMPRE estos rangos. Nunca pongas "60+ días" ni "31-60d" ni similares inventados.

REGLAS:
1. Cuando te pregunten por un cliente, usa la herramienta apropiada (buscar_cliente o consultar_saldo_cliente).
2. Cuando te pregunten "estado del día", "resumen", "cómo vamos" → usa estado_cobros_hoy.
3. Cuando te pregunten "qué tengo pendiente", "qué hay por aprobar" → usa listar_pendientes_aprobacion.
4. Cuando te pidan generar/proponer/redactar un correo o mensaje para un cliente → sigue el FLUJO OBLIGATORIO DE CORREO que aparece más abajo. NUNCA generes el correo solo en tu respuesta.
4b. Cuando te pregunten "¿qué plantillas hay?", "muéstrame las plantillas", "¿cuántas plantillas tenemos?" → usa listar_plantillas.
5. Sé conciso. Telegram tiene límite de longitud y la gente lee desde el celular.
6. Usa formato HTML simple para Telegram: <b>negrita</b>, <i>cursiva</i>, <code>código</code>. NO uses Markdown.
7. Montos: formato dominicano "RD$1,234,567" con puntuación apropiada.
8. Fechas: formato dominicano "29 abr 2026" o "29/04/2026".
9. Si la pregunta es ambigua (ej. "el cliente del banco"), pide aclaración antes de buscar.
10. Si el resultado tiene muchos elementos, resume y pregunta si quiere ver más detalles.
11. Si una herramienta falla, explica el problema en lenguaje claro.

MEMORIA DE CLIENTE (Capa 1):
- Antes de proponer un correo o WhatsApp, usa consultar_memoria_cliente para personalizar la gestión (si tiene memoria, el draft será más efectivo).
- Cuando el usuario comparta algo sobre el comportamiento de un cliente ("siempre paga a fin de mes", "mejor por WhatsApp", "hablar con María en contabilidad") → guarda con guardar_memoria_cliente.
- Cuando el usuario diga que una gestión funcionó o no ("el correo no funcionó", "respondió por WhatsApp") → actualiza canal_efectivo.
- Si buscas con buscar_cliente y quieres proponer una gestión, consulta memoria primero para ver si hay contexto útil.

CLIENTES SIN DATOS (Capa C):
- Cuando el usuario pregunte "¿a quiénes les falta email?", "clientes sin WhatsApp", "datos incompletos", "a quiénes no podemos escribir" → usa listar_clientes_sin_datos.
- Presenta la lista en orden de saldo neto (mayor deuda primero) para priorizar.
- Si el usuario quiere completar el dato de alguno de la lista, guíalo a decirte el valor y llama a guardar_dato_cliente.

CADENCIAS AUTOMÁTICAS (Capa D):
- Cuando el usuario pregunte "¿cómo van las cadencias?", "qué generaron las cadencias", "estado del sistema automático", "cuántas gestiones automáticas hay" → usa estado_cadencias.
- Explica en lenguaje natural: cuántas facturas ya tienen cadencia activa, cuándo fue el último run y cuántas gestiones generó.
- Si preguntan cómo activar o configurar cadencias, diles que vayan a la sección "Cadencias" en la app web.

CONCILIACIÓN BANCARIA:
- Cuando pregunten "cómo va la conciliación", "hay algo pendiente del banco", "qué pasó con los cheques devueltos" → usa estado_conciliacion.
- Las transacciones DESCONOCIDO son depósitos bancarios que no se pudieron cruzar con un recibo (RC) en Softec. El sistema las re-verifica automáticamente cada pocas horas. Si el usuario confirma que ya se registró el pago en Softec, dile que el cron lo detectará pronto.
- Los CHEQUES DEVUELTOS requieren: (1) desaplicar el pago en Softec, (2) contactar al cliente para reposición. Tienen tareas con prioridad ALTA.
- Las tareas de conciliación tienen origen='CONCILIACION'. Puedes listarlas con listar_tareas y cerrarlas con marcar_tarea_hecha.
- Si el usuario dice que un cheque ya se resolvió o que un depósito desconocido se identificó → marca la tarea como HECHA con notas.

PERFIL DE RIESGO (Capa 2 — Inteligencia pre-calculada):
- Cuando el usuario pregunte "¿le podemos vender más a CLIENTE?", "¿le damos crédito?", "¿cómo está el riesgo de CLIENTE?", "¿qué hacemos con CLIENTE?" → usa obtener_perfil_riesgo_cliente.
- Cuando consultar_saldo_cliente devuelva perfil_riesgo, preséntalo junto al saldo: nivel de riesgo, tendencia y acciones recomendadas.
- Cuando el usuario pregunte "dashboard de riesgo", "cartera de riesgo", "a quiénes no vendemos", "quiénes están en cobro legal" → usa analizar_riesgo_cartera.
- Si accion_ventas = NO_VENDER: "⛔ No vender hasta regularizar deuda." Si REQUIERE_ABONO: "⚠️ Requiere abono antes de nueva venta."
- Si accion_credito = SUSPENDER: "🚫 Crédito suspendido." Si AUTORIZAR_MANUAL: "⚠️ Requiere aprobación manual de crédito."
- Si accion_cobranza = COBRO_LEGAL: "⚖️ En proceso de gestión legal." Si GESTION_DIRECTA: "📞 Requiere gestión directa (no solo correo)."
- Si perfil_riesgo es null en la respuesta de saldo, NO lo menciones — el primer cálculo se hará esta noche.

ESTILO:
- Tono profesional pero cercano. Eres parte del equipo, no un robot.
- Habla en español dominicano natural.
- Emojis con moderación: 📊 para resúmenes, 💰 para montos, 🔴🟠🟡🟢 para segmentos, ⚠️ para alertas, 📧 para correos, ✉️ para drafts.

TAREAS / RECORDATORIOS:
- Cuando el usuario diga "recuérdame", "agenda", "anota", "anótalo", "mañana hay que...", "el viernes llamar a..." → usa crear_tarea.
- Calcula la fecha tú mismo a partir de la fecha de hoy que se inyecta abajo. Pasa siempre fecha_vencimiento en formato AAAA-MM-DD.
- Si el usuario dice "lunes/martes/...", asume el PRÓXIMO día de la semana con ese nombre (no el de esta semana si ya pasó).
- Si el usuario menciona un cliente sin código exacto y crear_tarea lo necesita, primero usa buscar_cliente.
- Cuando te pregunten "qué tengo hoy", "mis tareas", "qué hay pendiente esta semana" → usa listar_tareas con el rango apropiado.
- Cuando el usuario diga "ya hice X", "completé Y", "cumplido" sobre una tarea → usa marcar_tarea_hecha (puede que necesites listar_tareas primero para ubicar el ID).
- Después de crear una tarea, confirma con un mensaje breve: "📝 Anotado: <título> para <fecha en formato dominicano>".

PROHIBIDO:
- Inventar datos. Si no tienes info, dilo.
- Enviar mensajes a clientes sin pasar por aprobación humana (siempre quedan en cola).
- Modificar Softec (es solo lectura).`;

/**
 * Elige qué proveedor de LLM usar para esta llamada.
 *
 * Reglas (precedencia):
 *  1. Si chat_id está en CANARY_CHAT_IDS → provider local (preferido: gateway)
 *  2. Si LLM_PROVIDER=gateway → GatewayLLM (router IA en :8080)
 *  3. Si LLM_PROVIDER=ollama → OllamaLLM (legacy directo a Ollama; deprecated)
 *  4. Default → Anthropic (comportamiento histórico)
 *
 * Env vars relevantes:
 *   LLM_PROVIDER          'anthropic' | 'gateway' | 'ollama'  (default 'anthropic')
 *   CANARY_CHAT_IDS       Lista separada por comas de chat_ids que usan provider local
 *
 *   --- Gateway IA local (preferido) ---
 *   GATEWAY_BASE_URL      Ej. 'http://100.67.128.72:8080' (Robocop vía Tailscale)
 *   GATEWAY_SUPERVISOR    Nombre del supervisor (default 'cobranzas')
 *   GATEWAY_TIER          Tier preferido: 'fast' | 'std' | 'deep' | 'night' (default 'deep')
 *   GATEWAY_AUTH_TOKEN    Bearer opcional
 *
 *   --- Ollama directo (legacy, deprecated) ---
 *   OLLAMA_BASE_URL       Ej. 'https://ollama.midominio.com/v1' (cuando hay túnel)
 *   OLLAMA_MODEL          Ej. 'qwen2.5:14b-instruct-q4_K_M'
 *   OLLAMA_AUTH_TOKEN     Bearer opcional para el túnel
 *
 *   --- Anthropic ---
 *   ANTHROPIC_MODEL       Override del default 'claude-haiku-4-5-20251001'
 */
function chooseProvider(chatId: number): LLMProvider {
  const flag = (process.env.LLM_PROVIDER ?? 'anthropic').toLowerCase();
  const canaryRaw = process.env.CANARY_CHAT_IDS ?? '';
  const canaryChats = canaryRaw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  const isCanary = canaryChats.includes(chatId);
  const wantsLocal = flag === 'gateway' || flag === 'ollama' || isCanary;

  if (wantsLocal) {
    // Para canary sin flag explícito, prefiere Gateway si está configurado.
    const useGateway =
      flag === 'gateway' || (isCanary && flag !== 'ollama' && !!process.env.GATEWAY_BASE_URL);

    if (useGateway) {
      const baseUrl = process.env.GATEWAY_BASE_URL;
      if (!baseUrl) {
        throw new Error(
          'GATEWAY_BASE_URL no configurada — requerida cuando LLM_PROVIDER=gateway',
        );
      }
      const tier = (process.env.GATEWAY_TIER ?? 'deep').toLowerCase() as
        | 'fast'
        | 'std'
        | 'deep'
        | 'night';
      return new GatewayLLM({
        baseUrl,
        supervisorName: process.env.GATEWAY_SUPERVISOR ?? 'cobranzas',
        preferredTier: tier,
        authToken: process.env.GATEWAY_AUTH_TOKEN,
        // 240s: el primer turno del primer mensaje del día puede tomar 60-90s
        // re-procesando el system prompt (~10K tokens). Suma del flujo completo
        // (T1 tool_use + tool exec + T2 end_turn) puede llegar a ~150s.
        timeoutMs: 240_000,
      });
    }

    // Modo Ollama directo (legacy).
    const baseUrl = process.env.OLLAMA_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        'OLLAMA_BASE_URL no configurada (preferí GATEWAY_BASE_URL + LLM_PROVIDER=gateway)',
      );
    }
    return new OllamaLLM({
      baseUrl,
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:14b-instruct-q4_K_M',
      authToken: process.env.OLLAMA_AUTH_TOKEN,
      timeoutMs: 120_000,
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada');
  }
  return new AnthropicLLM({
    apiKey,
    model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
  });
}

function toolsToLlmTools(): LLMTool[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema,
  }));
}

export interface MensajeUsuario {
  texto: string;
  user: TelegramUserAuth;
  chatId: number;
  telegramUserId: number;
  contexto?: { thread_id?: number; reply_to?: string };
}

export async function procesarMensajeBot(input: MensajeUsuario): Promise<string> {
  let provider: LLMProvider;
  try {
    provider = chooseProvider(input.chatId);
  } catch (e) {
    return `⚠️ Error de configuración LLM: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Cargar historial (15 mensajes — suficiente contexto, menor costo) en paralelo
  const [historial, memoriaEquipo, sesion] = await Promise.all([
    cargarHistorial(input.chatId, 15).catch(() => []),
    cargarMemoriaEquipo(input.telegramUserId).catch(() => []),
    obtenerSesion(input.chatId).catch(() => null),
  ]);

  // Guardar el mensaje del usuario ANTES de llamar al modelo
  guardarMensaje(input.chatId, input.telegramUserId, 'usuario', input.texto).catch(() => {});

  // Construir el array de mensajes en formato neutral (LLMMessage[])
  const messages: LLMMessage[] = [
    ...historial.map((h) => ({
      role: (h.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.contenido,
    })),
    { role: 'user' as const, content: input.texto },
  ];

  const { staticPart: basePrompt, dynamicPart } = await buildSystemPrompt(SYSTEM_PROMPT_BASE, memoriaEquipo, sesion);
  // Modelos locales (Qwen/DeepSeek) reciben una tabla de routing al inicio para
  // anclar la elección de tool antes de procesar el resto del prompt. Anthropic
  // Haiku no la necesita (sigue el prompt original sin confundirse con 22 tools).
  const staticPart = provider.name === 'ollama' ? ROUTING_HINT_LOCAL + basePrompt : basePrompt;
  const llmTools = toolsToLlmTools();

  let respuestaFinal = '';
  let turn = 0;

  console.error(`[agent][${provider.name}] start chat=${input.chatId} user=${input.telegramUserId} text=${JSON.stringify(input.texto.slice(0, 100))}`);

  while (turn < MAX_TURNS) {
    turn++;

    let resp;
    try {
      resp = await provider.generate({
        systemCacheable: staticPart,
        system: dynamicPart,
        messages,
        tools: llmTools,
        // 384 baja el T2 (end_turn generando respuesta natural) de ~157s a ~40-60s
        // con qwen-deep. Junto con la regla "respuestas breves" del system prompt
        // basta para los casos típicos (saldo, top facturas, estado del día).
        maxTokens: 384,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[agent][${provider.name}] error:`, errMsg);
      return `⚠️ Error llamando al modelo (${provider.name}): ${errMsg.slice(0, 200)}`;
    }

    console.error(`[agent][${provider.name}] turn=${turn} stop=${resp.stopReason} text_len=${resp.text.length} tool_calls=${resp.toolCalls.length} latency=${resp.latencyMs}ms`);
    if (resp.toolCalls.length > 0) {
      for (const tc of resp.toolCalls) {
        console.error(`[agent][${provider.name}]   call: ${tc.name} args=${JSON.stringify(tc.arguments)}`);
      }
    }

    // Si solo respondió texto, guardar en historial y devolver
    if (resp.stopReason === 'end_turn') {
      respuestaFinal = resp.text || 'No tengo respuesta para eso.';
      guardarMensaje(input.chatId, input.telegramUserId, 'asistente', respuestaFinal).catch(() => {});
      return respuestaFinal;
    }

    // Si pidió usar herramientas, ejecutarlas
    if (resp.stopReason === 'tool_use') {
      // Push assistant message con tool_calls (preserva el texto si lo hubo)
      messages.push({
        role: 'assistant',
        content: resp.text,
        toolCalls: resp.toolCalls,
      });

      for (const tc of resp.toolCalls) {
        const resultado = await ejecutarTool(
          tc.name,
          tc.arguments,
          {
            userId: String(input.user.usuario_id),
            userEmail: input.user.telegram_username
              ? `telegram:${input.user.telegram_username}`
              : `telegram:${input.user.telegram_user_id}`,
            telegramUserId: input.telegramUserId,
          }
        );
        console.error(`[agent][${provider.name}]   result: ${tc.name} ok=${resultado.ok} ${resultado.ok ? '' : 'error=' + JSON.stringify(resultado.error)} data_snippet=${JSON.stringify(resultado.data ?? null).slice(0, 300)}`);

        // Actualizar sesión Redis cuando el modelo identifica un cliente (best-effort)
        if (resultado.ok && resultado.data) {
          const data = resultado.data as Record<string, unknown>;
          if (
            (tc.name === 'consultar_saldo_cliente' || tc.name === 'buscar_cliente') &&
            data.codigo && data.cliente
          ) {
            guardarSesion(input.chatId, {
              codigo_cliente: String(data.codigo),
              nombre_cliente: String(data.cliente),
              ultimo_tema: tc.name === 'consultar_saldo_cliente' ? 'saldo/facturas' : undefined,
            }).catch(() => {});
          }
          if (tc.name === 'buscar_cliente' && Array.isArray(data.clientes)) {
            const clientes = data.clientes as Array<{ codigo: string; nombre: string }>;
            if (clientes.length === 1) {
              guardarSesion(input.chatId, {
                codigo_cliente: clientes[0].codigo,
                nombre_cliente: clientes[0].nombre,
                ultimo_tema: 'búsqueda',
              }).catch(() => {});
            }
          }
        }

        messages.push({
          role: 'tool',
          toolCallId: tc.id,
          content: JSON.stringify(resultado),
          isError: !resultado.ok,
        });
      }
      continue;
    }

    if (resp.stopReason === 'max_tokens') {
      return '⚠️ La respuesta se truncó. Intenta una pregunta más específica.';
    }

    return '⚠️ Error inesperado del modelo.';
  }

  return '⚠️ Demasiados pasos. Intenta reformular la pregunta.';
}
