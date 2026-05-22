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
FLUJOS DE EMAIL — distingue PRIMERO cuál aplica antes de actuar.

▼ FLUJO A — PROPONER CORREO DE COBRANZA (objetivo: generar draft)

Activá este flujo cuando el usuario diga: "enviar correo", "mandar email",
"draftame un mail", "tenemos que enviarle un correo", "redactá un correo",
o similares.

PASO 1. Llamá proponer_correo_cobranza_cliente con:
  - termino = código del cliente (de la sesión activa o el que dio el usuario)
  - NO pases email_destino todavía.

  Resultados posibles:
    ✅ ok:true → el sistema tenía el email registrado y generó el draft.
       Ve al PASO 3.
    ⚠️ ok:false motivo:"SIN_EMAIL_REGISTRADO" → el cliente no tiene email.
       Ve al PASO 2.
    ⚠️ ok:false motivo:OTRO → mira la tabla de motivos abajo.

PASO 2. (Solo si SIN_EMAIL_REGISTRADO) Pedí el email al usuario en una
respuesta corta:
  "✏️ El sistema no tiene email registrado para <CLIENTE>. ¿A qué dirección
   envío el correo de cobro?"

  Cuando el usuario te dé el email, llamá proponer_correo_cobranza_cliente
  DE NUEVO con:
    - termino = código del cliente
    - email_destino = el email que dio el usuario

  El sistema GUARDA ese email automáticamente. NO preguntes "¿deseas
  guardarlo?". El sistema ya lo hizo.

  Ve al PASO 3 con el resultado.

PASO 3. Tenés un draft (ok:true). Presentá una respuesta CORTA en
español dominicano con: cliente, código, saldo, destinatario, asunto.
Terminá EXACTAMENTE con: <gestion-pendiente id="ID"/>
(El sistema reemplaza esa marca por botones Aprobar/Editar/Descartar.
No escribas los botones vos.)

PROHIBIDO en el FLUJO A:
- Preguntar "¿deseas guardar el email?" — el guardado es automático.
- Llamar a guardar_dato_cliente / guardar_email_cliente — proponer_correo
  ya lo hace internamente cuando recibe email_destino.
- Dejar la conversación sin draft cuando el usuario pidió enviar correo.

Tabla de motivos de error de proponer_correo_cobranza_cliente:
  SIN_FACTURAS_VENCIDAS → "este cliente no tiene deuda pendiente"
  YA_HAY_GESTION_PENDIENTE → "ya hay un correo pendiente — revisalo o aprobalo"
  CLIENTE_PAUSADO → "el cliente está pausado o marcado como no contactar"
  CLIENTE_CUBIERTO_POR_ANTICIPO → "tiene saldo a favor que cubre todo"
  SIN_PLANTILLA → "no hay plantilla activa — crea una en Plantillas"
  ERROR_GENERAR → muestra el error tal cual

▼ FLUJO B — GUARDAR EMAIL/WHATSAPP DEL CLIENTE (objetivo: solo persistir, sin draft)

Activá este flujo SOLO cuando el usuario lo pide explícitamente:
"guarda el email de X como Y", "agregale a X el correo Y", "el email de X es Y"
(misma lógica para WhatsApp).

NO actives este flujo si venís del FLUJO A — ahí el guardado es automático.

PASO 1. Llamá guardar_email_cliente / guardar_whatsapp_cliente con:
  - codigo_cliente = código del cliente
  - valor = el email o teléfono

PASO 2. Confirmá brevemente: "✅ Email guardado para <CLIENTE>".

▼ FLUJO C — PROPONER MENSAJE DE WHATSAPP

Idéntico al FLUJO A pero usando proponer_whatsapp_cobranza_cliente. Si
devuelve destinatario_telefono=null, pedí el número al usuario y volvé
a llamarlo con destinatario_telefono. Si tiene_pdf=true, el draft ya
incluye el link a la factura.

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
