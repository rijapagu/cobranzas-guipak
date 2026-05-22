/**
 * Construcción del system prompt del agente Telegram.
 *
 * Extraído de agent.ts para que pueda reusarse desde:
 *   - El bot productivo (lib/telegram/agent.ts)
 *   - El runner de evaluación (scripts/migracion-llm-local/)
 *
 * Cero cambio de comportamiento respecto al inline original. Lo único que se mueve
 * de la API es que `buildSystemPrompt` ahora recibe el fallback como parámetro
 * (antes leía la constante local `SYSTEM_PROMPT_BASE`).
 */

import { getConfig } from '@/lib/db/configuracion';
import type { SesionChat } from './session';

export const MAX_TURNS = 8;

/**
 * Prefijo de routing para modelos locales (Qwen/DeepSeek).
 *
 * Los modelos chicos (~14B) se confunden con un menú de 22 tools y un prompt
 * extenso en prosa. Esta tabla directa "si query contiene X → llamar Y(args)"
 * los ancla a la decisión correcta antes de leer el resto del prompt.
 *
 * NO se inyecta para Anthropic Haiku (que sigue el prompt original sin problemas).
 */
export const ROUTING_HINT_LOCAL = `# REGLAS ABSOLUTAS

1. RESPONDE SIEMPRE EN ESPAÑOL DOMINICANO. NUNCA en chino, inglés u otro idioma.
2. UNA sola tool por turno. NUNCA llames múltiples tools al mismo tiempo.
3. NUNCA inventes códigos de cliente (como "0001234"). Si necesitas un código, primero llama buscar_cliente o consultar_saldo_cliente con el nombre tal cual lo dijo el usuario.
4. NUNCA llames una tool con args vacíos {}. Si la tool tiene parámetros, pásalos.

# EJEMPLOS DE ROUTING (sigue exactamente este patrón)

Usuario: "dame el saldo de Padron Office"
→ consultar_saldo_cliente({"termino": "Padron Office"})
[fin del turno — espera el resultado, después resume al usuario]

Usuario: "cuánto debe LOM OFFICE"
→ consultar_saldo_cliente({"termino": "LOM OFFICE"})

Usuario: "saldo cliente 0000274"
→ consultar_saldo_cliente({"termino": "0000274"})

Usuario: "busca Padron"
→ buscar_cliente({"termino": "Padron"})

Usuario: "propón un correo a Padron Office"
→ obtener_contactos_cliente({"termino": "Padron Office"})
[fin del turno — sigue el FLUJO OBLIGATORIO DE CORREO con el resultado]

Usuario: "como vamos hoy"
→ estado_cobros_hoy({})

Usuario: "qué tareas tengo hoy"
→ listar_tareas({"rango": "hoy"})

Usuario: "recuérdame llamar a Padron mañana"
→ crear_tarea({"titulo": "Llamar a Padron", "fecha_vencimiento": "<fecha de mañana>", "tipo": "LLAMAR"})

Usuario: "qué hay por aprobar"
→ listar_pendientes_aprobacion({})

Usuario: "cómo está el riesgo de LOM"
→ buscar_cliente({"termino": "LOM"})
[espera el código del resultado, después llama obtener_perfil_riesgo_cliente con ese código]

Usuario: "cartera de riesgo"
→ analizar_riesgo_cartera({})

Usuario: "qué plantillas hay"
→ listar_plantillas({})

Usuario: "promesas vencidas"
→ listar_promesas_vencidas({})

# REGLAS DE DECISIÓN POR PALABRA CLAVE

- "saldo" / "debe" / "cuánto" / "deuda" → consultar_saldo_cliente (NUNCA obtener_contactos_cliente)
- "buscar" / "quién es" → buscar_cliente
- "correo" / "email" / "mensaje a" / "WhatsApp" → obtener_contactos_cliente primero
- "tareas" / "pendiente" / "agenda" / "recuérdame" → crear_tarea o listar_tareas
- "estado" / "cómo vamos" / "resumen" → estado_cobros_hoy
- "riesgo" / "cartera de riesgo" → obtener_perfil_riesgo_cliente o analizar_riesgo_cartera

# AL RECIBIR EL RESULTADO

Después de que la tool devuelva su resultado, redacta una respuesta CORTA en español dominicano con los datos clave (saldo, cliente, facturas). NO llames otra tool a menos que el usuario lo pida explícitamente o sea parte del FLUJO OBLIGATORIO DE CORREO de más abajo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

/**
 * Flujos operacionales — SIEMPRE se inyectan desde código, al final del prompt.
 * NO son sobreescribibles desde Configuración porque están acoplados a las definiciones
 * de herramientas en tools.ts. Si cambias una herramienta, cambia este bloque en código.
 */
export const FLUJOS_OPERACIONALES = `
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
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REGLAS DE BREVEDAD (operacionales, no negociables):
- Respuestas BREVES por defecto. Da el total + lo esencial, no enumeres todo.
- Si hay más de 5 facturas o ítems, da el TOTAL y muestra solo los 5 más relevantes (más antiguos o mayor monto). NO listes todas a menos que el usuario lo pida explícitamente ("muéstrame todas", "lista completa", "dame el detalle").
- Evita repetir contexto que ya está en mensajes previos del mismo chat.
- Apunta a respuestas de 3-6 líneas para consultas típicas de saldo o estado.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
 * - staticPart: promptPersonalizable (de DB o fallback) + FLUJOS_OPERACIONALES — cambia raramente.
 *   Anthropic la cachea con cache_control=ephemeral.
 * - dynamicPart: fecha de hoy, calendario, sesión del cliente, memoria del equipo —
 *   cambia en cada conversación. NO se cachea.
 *
 * Producción siempre prefiere `cobranza_configuracion.prompt_agente`. El parámetro
 * `fallbackBasePrompt` solo se usa si la fuente custom está vacía o falla.
 *
 * `getCustomPrompt` permite inyectar una fuente alternativa al custom prompt (ej.
 * leer de un archivo en eval) sin tocar la DB. Si no se provee, lee de
 * cobranza_configuracion.prompt_agente igual que producción.
 */
export async function buildSystemPrompt(
  fallbackBasePrompt: string,
  memoriaEquipo: { clave: string; valor: string }[],
  sesion: SesionChat | null,
  getCustomPrompt?: () => Promise<string | null>
): Promise<{ staticPart: string; dynamicPart: string }> {
  const hoy = fechaHoyDominicana();
  const diaSemana = diaSemanaEspanol(hoy);

  let promptPersonalizable = fallbackBasePrompt;
  try {
    const custom = getCustomPrompt
      ? await getCustomPrompt()
      : await getConfig('prompt_agente');
    if (custom && custom.trim().length > 10) {
      promptPersonalizable = custom.trim();
    }
  } catch { /* fallback al hardcoded */ }

  const seccionMemoria = memoriaEquipo.length > 0
    ? `\nMEMORIA DEL EQUIPO (lo que has aprendido sobre las personas y el negocio — úsalo en cada respuesta):\n${memoriaEquipo.map((m) => `- ${m.clave}: ${m.valor}`).join('\n')}\n`
    : '';

  const seccionSesion = sesion
    ? `\nCONTEXTO DE SESIÓN ACTUAL (cliente activo en esta conversación):
- Código: ${sesion.codigo_cliente}
- Nombre: ${sesion.nombre_cliente}${sesion.ultimo_tema ? `\n- Último tema: ${sesion.ultimo_tema}` : ''}

REGLA OBLIGATORIA: Mientras esta sesión esté activa, CUALQUIER acción o pregunta del usuario que requiera un cliente y NO mencione explícitamente otro nombre o código se refiere a este cliente.

Ejemplos de cómo aplicar la regla:
- "tenemos que enviar un correo" → enviar correo a ${sesion.nombre_cliente}
- "draftame un mensaje" → mensaje para ${sesion.nombre_cliente}
- "y los próximos vencimientos" → vencimientos de ${sesion.nombre_cliente}
- "qué te parece llamarlo" → llamar a ${sesion.nombre_cliente}
- "él" / "ese cliente" / "el mismo" / "el cliente" / "sí" → ${sesion.nombre_cliente}

Solo cambia de cliente si el usuario menciona explícitamente OTRO nombre o código distinto a "${sesion.codigo_cliente}" / "${sesion.nombre_cliente}". Si dudas, NO preguntes a quién — usa este cliente.\n`
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
