import Anthropic from '@anthropic-ai/sdk';
import { TOOLS, ejecutarTool } from './tools';
import type { TelegramUserAuth } from './auth';
import { getConfig } from '@/lib/db/configuracion';
import {
  guardarMensaje,
  cargarHistorial,
  cargarMemoriaEquipo,
} from './historial';
import { obtenerSesion, guardarSesion, type SesionChat } from './session';

function fechaHoyDominicana(): string {
  // YYYY-MM-DD en zona America/Santo_Domingo (UTC-4 sin DST)
  const ahora = new Date();
  const ms = ahora.getTime() - 4 * 3600 * 1000;
  return new Date(ms).toISOString().split('T')[0];
}

function diaSemanaEspanol(fechaIso: string): string {
  const d = new Date(fechaIso + 'T12:00:00Z');
  return ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()];
}

/**
 * Parte PERSONALIZABLE — puede sobreescribirse desde Configuración (prompt_agente en DB).
 * Contiene: persona/contexto, reglas generales, estilo, tareas, cadencias, conciliación, perfil de riesgo.
 * NO incluir flujos de herramientas — esos van en FLUJOS_OPERACIONALES.
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
 * Flujos operacionales — SIEMPRE se inyectan desde código, al final del prompt.
 * NO son sobreescribibles desde Configuración porque están acoplados a las definiciones
 * de herramientas en tools.ts. Si cambias una herramienta, cambia este bloque en código.
 */
const FLUJOS_OPERACIONALES = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FLUJO OBLIGATORIO — PROPUESTA DE CORREO (estos pasos son innegociables):

PASO 1 — SIEMPRE llama primero a obtener_contactos_cliente para ver los emails disponibles.

PASO 2 — Según el resultado:
  A) UN solo email disponible → úsalo DIRECTAMENTE como email_destino. NO preguntes al usuario. Ve al PASO 4.
  B) DOS O MÁS emails → muestra las opciones numeradas y espera que el usuario elija (PASO 3):
       📧 ¿A qué email envío el correo de <CLIENTE>?
       1️⃣ email1@empresa.com  (BD propia)
       2️⃣ email2@empresa.com  (Softec CxP)
       ✏️ Otro (escribe un email diferente)
  C) NINGÚN email → solo muestra: "✏️ No tenemos email de <CLIENTE>. ¿Me das la dirección?" y espera (PASO 3).

PASO 3 (solo si hay 2+ opciones o ninguna) — Espera respuesta. Si el usuario responde "1", "el primero", "el de Softec", etc. → identifica el email correspondiente. NO llames a proponer_correo_cliente hasta tener el email confirmado.

PASO 4 — Llama a proponer_correo_cliente con email_destino confirmado.
  El sistema SIEMPRE usa una plantilla (nunca genera texto libre):
    - Si el usuario indicó un número (ej. "usa la plantilla 7") → pasa plantilla_id.
    - Si el usuario indicó un nombre (ej. "con la plantilla estado de cuenta") → llama listar_plantillas primero para encontrar el ID.
    - Si no indicó plantilla → omite plantilla_id; el sistema auto-selecciona por segmento y días vencidos.

PASO 5 — Cuando proponer_correo_cliente devuelva ok:true:
  - Presenta: cliente, código, saldo, días vencida, destinatario, asunto del correo.
  - Si el email fue NUEVO (no estaba en las opciones del Paso 2):
    Pregunta: "💾 ¿Deseas guardar <email> en la ficha de <CLIENTE>?"
    Si dice sí → llama a guardar_dato_cliente con campo="email".
  - Termina con la marca exacta: <gestion-pendiente id="ID"/>
    El sistema la reemplaza por botones. NO escribas los botones tú.

Si proponer_correo_cliente devuelve ok:false, explica en lenguaje natural:
  SIN_FACTURAS_VENCIDAS → "este cliente no tiene deuda pendiente"
  YA_HAY_GESTION_PENDIENTE → "ya hay un correo pendiente para ese cliente — revisa la cola o apruébalo"
  CLIENTE_PAUSADO → "el cliente está pausado o marcado como no contactar"
  CLIENTE_CUBIERTO_POR_ANTICIPO → "tiene saldo a favor que cubre todo — contabilidad debe aplicar el anticipo primero"
  SIN_PLANTILLA → "no hay plantilla activa para ese segmento — crea una en el panel de Plantillas"
  ERROR_GENERAR → muestra el error tal cual.

PROPUESTA DE WHATSAPP:
- Para proponer mensaje WhatsApp → usa proponer_whatsapp_cliente (queda PENDIENTE, no se envía).
- Si devuelve destinatario_telefono=null: pide el número al usuario y llama guardar_dato_cliente campo="whatsapp".
- Si tiene_pdf=true: el draft ya incluye el link a la factura.
- Termina con <gestion-pendiente id="ID"/>.

GUARDAR DATO DE CLIENTE:
- Cuando el usuario diga "el email de CLIENTE es X" o "el WhatsApp es Y" → llama a guardar_dato_cliente.
- Pide confirmación si el usuario no lo indicó explícitamente.
- Usa el código de 7 dígitos (busca primero con buscar_cliente si no lo tienes).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

/**
 * Construye un mapa precomputado de los próximos 14 días con su nombre en español.
 * Resuelve el bug de aritmética de fechas en Claude — en vez de pedirle que cuente,
 * le damos la tabla y solo busca.
 */
function tablaProximosDias(hoyIso: string): string {
  const lineas: string[] = [];
  const baseMs = new Date(hoyIso + 'T12:00:00Z').getTime();
  for (let i = 0; i < 14; i++) {
    const d = new Date(baseMs + i * 86400000);
    const iso = d.toISOString().split('T')[0];
    const nombre = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][d.getUTCDay()];
    let etiqueta = `${nombre} ${iso}`;
    if (i === 0) etiqueta += ' ← HOY';
    else if (i === 1) etiqueta += ' ← mañana';
    else if (i === 2) etiqueta += ' ← pasado mañana';
    lineas.push(`  ${etiqueta}`);
  }
  return lineas.join('\n');
}

/**
 * Devuelve el system prompt en dos partes para aprovechar prompt caching:
 * - staticPart: SYSTEM_PROMPT_BASE + FLUJOS_OPERACIONALES — cambia raramente
 *   (solo si alguien edita Configuración). Se marca con cache_control=ephemeral.
 * - dynamicPart: fecha de hoy, calendario, sesión del cliente, memoria del equipo —
 *   cambia en cada conversación. NO se cachea.
 *
 * Ahorro: Anthropic cobra el 10% del precio normal para tokens cacheados.
 * Con ~5000 tokens estáticos por llamada y 3-4 llamadas por mensaje, el
 * caching reduce el costo de input en ~60-70%.
 */
async function buildSystemPrompt(
  memoriaEquipo: { clave: string; valor: string }[],
  sesion: SesionChat | null
): Promise<{ staticPart: string; dynamicPart: string }> {
  const hoy = fechaHoyDominicana();
  const diaSemana = diaSemanaEspanol(hoy);

  let promptPersonalizable = SYSTEM_PROMPT_BASE;
  try {
    const custom = await getConfig('prompt_agente');
    if (custom && custom.trim().length > 10) {
      promptPersonalizable = custom.trim();
    }
  } catch { /* fallback al hardcoded */ }

  const seccionMemoria = memoriaEquipo.length > 0
    ? `\nMEMORIA DEL EQUIPO (lo que has aprendido sobre las personas y el negocio — úsalo en cada respuesta):\n${memoriaEquipo.map((m) => `- ${m.clave}: ${m.valor}`).join('\n')}\n`
    : '';

  const seccionSesion = sesion
    ? `\nCONTEXTO DE SESIÓN ACTUAL (cliente que se está discutiendo — úsalo cuando el usuario diga "él", "ese cliente", "el mismo", "Si", sin especificar otro):
- Código: ${sesion.codigo_cliente}
- Nombre: ${sesion.nombre_cliente}${sesion.ultimo_tema ? `\n- Último tema: ${sesion.ultimo_tema}` : ''}
Si el usuario se refiere a "el cliente" sin dar nombre, asume que es este.\n`
    : '';

  return {
    // Parte cacheable — no varía entre mensajes del mismo día/usuario
    staticPart: `${promptPersonalizable}\n\n${FLUJOS_OPERACIONALES}`,
    // Parte dinámica — fecha, sesión de cliente activa, memoria del equipo
    dynamicPart: `FECHA DE HOY (Santo Domingo): ${hoy} (${diaSemana}).

CALENDARIO DE LOS PRÓXIMOS 14 DÍAS (úsalo como tabla de lookup, NO calcules tú las fechas):
${tablaProximosDias(hoy)}

REGLAS PARA RESOLVER FECHAS RELATIVAS:
- "hoy" → fecha del HOY de la tabla.
- "mañana" → fecha marcada con "← mañana".
- "pasado mañana" → fecha marcada con "← pasado mañana".
- "el lunes" / "el martes" / etc. → busca la PRIMERA fila con ese día de la semana en la tabla (omitiendo el HOY si es ese día).
- "el próximo lunes" → si HOY es lunes, salta al lunes de la siguiente fila; si no, igual que "el lunes".
- "en N días" → cuenta N filas hacia abajo desde HOY.
- Siempre verifica que la fecha que envías a crear_tarea coincida con el día de la semana de la tabla.
${seccionSesion}${seccionMemoria}`,
  };
}

const MAX_TURNS = 8;

export interface MensajeUsuario {
  texto: string;
  user: TelegramUserAuth;
  chatId: number;
  telegramUserId: number;
  contexto?: { thread_id?: number; reply_to?: string };
}

export async function procesarMensajeBot(input: MensajeUsuario): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return '⚠️ Error: ANTHROPIC_API_KEY no configurada en el servidor.';
  }

  const client = new Anthropic({ apiKey });

  // Cargar historial (15 mensajes — suficiente contexto, menor costo) + paralelo
  const [historial, memoriaEquipo, sesion] = await Promise.all([
    cargarHistorial(input.chatId, 15).catch(() => []),
    cargarMemoriaEquipo(input.telegramUserId).catch(() => []),
    obtenerSesion(input.chatId).catch(() => null),
  ]);

  // Guardar el mensaje del usuario ANTES de llamar a Claude
  guardarMensaje(input.chatId, input.telegramUserId, 'usuario', input.texto).catch(() => {});

  // Construir el array de mensajes: historial previo + mensaje actual
  const messages: Anthropic.MessageParam[] = [
    ...historial.map((h) => ({
      role: (h.rol === 'usuario' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: h.contenido,
    })),
    { role: 'user' as const, content: input.texto },
  ];

  const { staticPart, dynamicPart } = await buildSystemPrompt(memoriaEquipo, sesion);

  // Prompt caching: staticPart (~5000 tokens) se cachea por 5 min → ~90% ahorro en esos tokens.
  // dynamicPart (fecha, sesión, memoria) cambia cada conversación → no se cachea.
  // tools también se cachean en el último elemento (nunca cambian en runtime).
  const systemBlocks = [
    { type: 'text' as const, text: staticPart, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: dynamicPart },
  ];
  const toolsConCache = TOOLS.map((t, i) =>
    i === TOOLS.length - 1
      ? { ...t, cache_control: { type: 'ephemeral' as const } }
      : t
  );

  let respuestaFinal = '';
  let turn = 0;

  while (turn < MAX_TURNS) {
    turn++;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemBlocks,
      tools: toolsConCache as typeof TOOLS,
      messages,
    });

    // Si Claude solo respondió texto, guardar en historial y devolver
    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      respuestaFinal = textBlock && 'text' in textBlock
        ? textBlock.text
        : 'No tengo respuesta para eso.';

      // Guardar respuesta del asistente (fire-and-forget)
      guardarMensaje(input.chatId, input.telegramUserId, 'asistente', respuestaFinal).catch(() => {});
      return respuestaFinal;
    }

    // Si pidió usar herramientas, ejecutarlas
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tool of toolUses) {
        if (tool.type !== 'tool_use') continue;
        const resultado = await ejecutarTool(
          tool.name,
          tool.input as Record<string, unknown>,
          {
            userId: String(input.user.usuario_id),
            userEmail: input.user.telegram_username
              ? `telegram:${input.user.telegram_username}`
              : `telegram:${input.user.telegram_user_id}`,
            telegramUserId: input.telegramUserId,
          }
        );

        // Actualizar sesión Redis cuando Claude identifica un cliente (best-effort)
        if (resultado.ok && resultado.data) {
          const data = resultado.data as Record<string, unknown>;
          if (
            (tool.name === 'consultar_saldo_cliente' || tool.name === 'buscar_cliente') &&
            data.codigo && data.cliente
          ) {
            guardarSesion(input.chatId, {
              codigo_cliente: String(data.codigo),
              nombre_cliente: String(data.cliente),
              ultimo_tema: tool.name === 'consultar_saldo_cliente' ? 'saldo/facturas' : undefined,
            }).catch(() => {});
          }
          // buscar_cliente devuelve lista — guardar el primero si hay exactamente uno o si el término era un código exacto
          if (tool.name === 'buscar_cliente' && Array.isArray(data.clientes)) {
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

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: JSON.stringify(resultado),
          is_error: !resultado.ok,
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // max_tokens, stop_sequence, refusal, etc.
    return '⚠️ La respuesta se truncó. Intenta una pregunta más específica.';
  }

  return '⚠️ Demasiados pasos. Intenta reformular la pregunta.';
}
