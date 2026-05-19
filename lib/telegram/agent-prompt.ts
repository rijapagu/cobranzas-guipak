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
