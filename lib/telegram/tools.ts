import Anthropic from '@anthropic-ai/sdk';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import {
  obtenerSaldoAFavorPorCliente,
  ajustarSaldoCliente,
} from '@/lib/cobranzas/saldo-favor';
import { obtenerContactos, resolverEmailPropio, resolverWhatsAppPropio } from '@/lib/cobranzas/contactos';
import { EMPRESA_GUIPAK } from '@/lib/tenant';
import { proponerCorreoCliente } from './draft-correo';
import { proponerWhatsAppCliente } from './draft-whatsapp';
import { guardarMemoriaEquipo, buscarHistorial } from './historial';
import { lineaDeTiempoCliente } from '@/lib/cobranzas/linea-tiempo';
import { listarPlantillasActivas } from '@/lib/templates/seleccionar';
import {
  aprobarGestion,
  descartarGestion,
  escalarGestion,
  editarGestion,
  type ActorGestion,
  type ResultadoAccionGestion,
} from './gestion-acciones';
import {
  listarDepositosPendientes,
  asignarClienteADeposito,
  aprobarDeposito,
  ultimoExtracto,
} from '@/lib/conciliacion/acciones';
import { listarDisputas, crearDisputa, actualizarDisputa } from '@/lib/cobranzas/disputas';
import {
  generarExcelCartera,
  generarExcelGestiones,
  generarExcelEstadoCuenta,
} from '@/lib/reportes/excel';
import { Input } from 'telegraf';
import { getTelegraf } from './client';
import { enviarFacturaCliente } from '@/lib/cobranzas/enviar-factura';
import { listarCadencias, actualizarCadencia } from '@/lib/cobranzas/cadencias-config';
import { ejecutarCadenciasHorarias } from '@/lib/queue/jobs/cadencias';
import { generarColaAprobacion } from '@/lib/cobranzas/generar-cola';
import { pausarCliente, reactivarCliente } from '@/lib/cobranzas/clientes-enriquecidos';
import { generarTokenPortal } from '@/lib/cobranzas/portal';

/**
 * Definición de herramientas que Claude puede invocar desde el bot de Telegram.
 * Patrón inspirado en Agente Inventario (bot.py + tools.py).
 */

/**
 * Normaliza un código de cliente al formato canónico de Softec (campo IC_CODE).
 * - Códigos numéricos puros se padean a 7 dígitos con ceros: "274" → "0000274".
 * - Códigos alfanuméricos (con letras) se devuelven en MAYÚSCULAS sin padding: "rv0003" → "RV0003".
 *
 * Crítico: NO hacer padStart sobre códigos con letras — corrompe el código y la BD
 * nunca lo encuentra (ej. "RV0003".padStart(7,'0') → "0RV0003" que no existe en Softec).
 */
function normalizarCodigoCliente(codigo: string): string {
  const trimmed = codigo.trim();
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(7, '0');
  return trimmed.toUpperCase();
}

/**
 * Determina si un término parece ser un código de cliente exacto (vs. un nombre).
 * Códigos: alfanuméricos sin espacios, longitud ≤15 chars.
 */
function pareceCodigoCliente(termino: string): boolean {
  const trimmed = termino.trim();
  if (!trimmed || trimmed.length > 15) return false;
  return /^[A-Z0-9]+$/i.test(trimmed);
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'consultar_saldo_cliente',
    description:
      'Cuándo usar: cuando el usuario pregunte "cuánto debe X", "saldo de X", "aging de X", "facturas de X", o variantes — siempre con un cliente identificable.\n' +
      'Qué hace: devuelve el aging del cliente. Por defecto SOLO incluye las 5 facturas más vencidas + conteo por segmento + total. Si el usuario pide explícitamente "todas las facturas", "lista completa", "detalle de todas", pasar mostrar_todas:true.\n' +
      'Devuelve: { cliente, codigo, total_facturas, saldo_total, saldo_neto, perfil_riesgo, facturas_por_segmento:{VERDE,AMARILLO,NARANJA,ROJO}, facturas:[{factura,fecha_vence,dias_vencida,saldo}] (top 5 o todas según mostrar_todas), facturas_truncadas:bool }.\n' +
      'Pre-condiciones: ninguna. Acepta código exacto o nombre parcial.\n' +
      'NO usar si: el usuario pidió redactar un correo/whatsapp (eso es proponer_correo_cobranza_cliente). Tampoco para datos de contacto del cliente (eso es consultar_contactos_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código exacto del cliente (alfanumérico como "RV0003" o numérico padded como "0000274") o parte del nombre. Si hay sesión activa, usá el código TAL CUAL aparece en la sesión, sin reformatear.',
        },
        mostrar_todas: {
          type: 'boolean',
          description: 'Si true, devuelve TODAS las facturas pendientes (hasta 50). Default false (solo top 5 más vencidas). Usar solo cuando el usuario pida explícitamente la lista completa.',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'resumen_estado_cobros_hoy',
    description:
      'Cuándo usar: el usuario pregunta "cómo vamos", "estado del día", "dashboard", "qué hay hoy", "resumen de cobros", "cómo está el DSO" — sin mencionar a un cliente específico.\n' +
      'Qué hace: resumen ad-hoc del estado actual de cobros (cartera bruta/a favor/neta, DSO, distribución por segmento, promesas y pendientes de aprobación).\n' +
      'Devuelve: { cartera_total, cartera_a_favor, cartera_neta, clientes_cubiertos, total_facturas, total_clientes, dso, modo_mock, por_segmento: {VERDE,AMARILLO,NARANJA,ROJO}, mensajes_pendientes_aprobacion, promesas_vencen_hoy, promesas_vencidas }.\n' +
      'Pre-condiciones: ninguna. Si modo_mock=true, el dso (siempre 45 en ese caso) y los montos no son datos reales — dilo si preguntan.\n' +
      'NO usar si: el usuario pregunta por un cliente específico (eso va a consultar_saldo_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'listar_mensajes_pendientes_aprobacion',
    description:
      'Cuándo usar: el usuario pregunta "qué hay pendiente de aprobar", "cola de aprobación", "qué mensajes están esperando", "qué tengo que revisar" — referido a drafts del bot esperando OK humano.\n' +
      'Qué hace: lista los drafts (correo/WhatsApp) generados por la IA que aún no han sido aprobados, descartados ni enviados al cliente.\n' +
      'Devuelve: { total, mensajes: [{gestion_id, cliente, canal, asunto, preview, creado_en}] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario quiere CREAR un nuevo mensaje (eso es proponer_correo_cobranza_cliente o proponer_whatsapp_cobranza_cliente) o ver tareas del equipo (listar_tareas_pendientes).',
    input_schema: {
      type: 'object' as const,
      properties: {
        limite: {
          type: 'number',
          description: 'Cantidad máxima a listar (default 10)',
        },
      },
    },
  },
  {
    name: 'aprobar_gestion',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE "aprueba la gestión X", "aprueba y envía X", "aprueba lo de fulano" — con un gestion_id concreto o resuelto sin ambigüedad vía listar_mensajes_pendientes_aprobacion. Esta orden del usuario ES la aprobación humana (CP-02) — no es la IA decidiendo aprobar por su cuenta.\n' +
      'Qué hace: marca la gestión como APROBADO y la ENVÍA de inmediato al cliente (correo o WhatsApp, según el canal). No hay paso intermedio ni confirmación adicional — avísale al usuario de esto si no parece saberlo. Solo funciona sobre gestiones en estado PENDIENTE, y solo si quien pregunta es supervisor.\n' +
      'Devuelve: { mensaje: string } con el resultado del envío, o el motivo si no se pudo aprobar/enviar.\n' +
      'Pre-condiciones: gestion_id numérico exacto. Si el usuario solo describe al cliente sin dar el ID, usa listar_mensajes_pendientes_aprobacion primero y confirma cuál es antes de ejecutar.\n' +
      'NO usar si: el usuario solo pregunta qué hay pendiente (listar_mensajes_pendientes_aprobacion) o no nombra una gestión/cliente concreto. NUNCA llamar esta tool por iniciativa propia.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gestion_id: { type: 'number', description: 'ID numérico de la gestión a aprobar' },
      },
      required: ['gestion_id'],
    },
  },
  {
    name: 'descartar_gestion',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE "descarta la gestión X", "cancela lo de fulano", "no mandes eso" — con un gestion_id concreto.\n' +
      'Qué hace: marca la gestión como DESCARTADO. No se envía nada al cliente y la gestión no se vuelve a proponer sola. Solo funciona sobre gestiones PENDIENTE, y solo si quien pregunta es supervisor.\n' +
      'Devuelve: { mensaje: string }.\n' +
      'Pre-condiciones: gestion_id numérico exacto. Si el usuario no dio un motivo, pídeselo antes de llamar la tool — no inventes uno.\n' +
      'NO usar si: el usuario no nombra una gestión concreta. NUNCA llamar esta tool por iniciativa propia.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gestion_id: { type: 'number', description: 'ID numérico de la gestión a descartar' },
        motivo: { type: 'string', description: 'Motivo del descarte, tal como lo dio el usuario' },
      },
      required: ['gestion_id', 'motivo'],
    },
  },
  {
    name: 'escalar_gestion',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE "escala la gestión X", "esto lo llevo yo a mano", "pásalo a gestión manual" — con un gestion_id concreto.\n' +
      'Qué hace: marca la gestión como ESCALADO, sacándola del flujo automático para seguimiento manual. No envía nada al cliente. No requiere ser supervisor (a diferencia de aprobar/descartar).\n' +
      'Devuelve: { mensaje: string }.\n' +
      'Pre-condiciones: gestion_id numérico exacto. Solo funciona sobre gestiones PENDIENTE.\n' +
      'NO usar si: el usuario no nombra una gestión concreta.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gestion_id: { type: 'number', description: 'ID numérico de la gestión a escalar' },
        notas: { type: 'string', description: 'Notas opcionales sobre por qué se escala' },
      },
      required: ['gestion_id'],
    },
  },
  {
    name: 'listar_promesas_pago_incumplidas',
    description:
      'Cuándo usar: el usuario pregunta "qué promesas se vencieron", "quiénes no cumplieron", "promesas incumplidas", "deudores que prometieron pagar y no lo hicieron".\n' +
      'Qué hace: lista promesas de pago cuya fecha venció y no fueron cumplidas, ordenadas por días de retraso (mayor a menor).\n' +
      'Devuelve: { total, promesas: [{codigo_cliente, nombre, monto_prometido, fecha_prometida, dias_atraso}] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario pregunta por promesas FUTURAS o por el aging de un cliente específico (eso es consultar_saldo_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        limite: {
          type: 'number',
          description: 'Cantidad máxima a listar (default 10)',
        },
      },
    },
  },
  {
    name: 'consultar_historial_conversaciones',
    description:
      'Cuándo usar: cuando el usuario pregunte "qué le dijimos a X", "qué nos respondió X", "historial con X", "última conversación con X" — siempre referido a un cliente concreto.\n' +
      'Qué hace: trae los últimos mensajes (WhatsApp + Email) intercambiados con el cliente, ordenados del más reciente al más viejo.\n' +
      'Devuelve: { cliente, total, mensajes: [{fecha, canal, direccion, asunto, preview}] }. Vacío si no hay historial.\n' +
      'Pre-condiciones: tener el código exacto del cliente (no acepta nombre parcial). Si solo hay nombre, usar buscar_cliente primero.\n' +
      'NO usar si: el usuario quiere ver mensajes pendientes de aprobación del bot (eso es listar_mensajes_pendientes_aprobacion, otro contexto).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código del cliente en Softec' },
        limite: { type: 'number', description: 'Cantidad de mensajes a retornar (default 10)' },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'buscar_cliente',
    description:
      'Cuándo usar: cuando el usuario mencione un cliente por nombre parcial y necesites resolver el código antes de cualquier acción que requiera código exacto.\n' +
      'Qué hace: busca clientes en Softec por nombre o código parcial y devuelve coincidencias.\n' +
      'Devuelve: { total, clientes: [{codigo, nombre, saldo, segmento}] }. Si total=0, no encontró; si total>1, hay que pedir desambiguación al usuario.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: (a) el usuario ya dio un código de cliente exacto (formato alfanumérico tipo "RV0003" o numérico padded tipo "0000274") — ir directo a consultar_saldo_cliente. (b) Hay una sesión activa con un cliente y la pregunta es sobre ESE cliente — usar el código de la sesión directamente, NO volver a buscar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: { type: 'string', description: 'Texto a buscar (nombre o código parcial)' },
      },
      required: ['termino'],
    },
  },
  {
    name: 'crear_tarea_recordatorio',
    description:
      'Cuándo usar: el usuario dice "recuérdame…", "agenda…", "anota que mañana hay que…", "el cliente me pidió que le llame el viernes", "ponle una tarea a fulano para el lunes" — toda intención de agendar un recordatorio o tarea con fecha.\n' +
      'Qué hace: crea una entrada en el calendario del equipo con título, fecha, tipo (LLAMAR/DEPOSITAR_CHEQUE/SEGUIMIENTO/etc.) y opcionalmente cliente y hora.\n' +
      'Devuelve: { tarea_id, titulo, fecha_vencimiento, hora, tipo, prioridad }. Confirmar al usuario tras crear.\n' +
      'Pre-condiciones: la fecha DEBE pasarse en formato AAAA-MM-DD. Calcula la fecha relativa tú mismo a partir de la fecha de hoy del system prompt (ej. "el lunes" → calcula la fecha exacta).\n' +
      'NO usar si: el usuario solo está describiendo un evento pasado o pidiendo el estado de una tarea existente (eso es listar_tareas_pendientes).',
    input_schema: {
      type: 'object' as const,
      properties: {
        titulo: { type: 'string', description: 'Título corto de la tarea' },
        fecha_vencimiento: {
          type: 'string',
          description: 'Fecha en formato AAAA-MM-DD (ej. "2026-05-09"). Calcula tú la fecha relativa.',
        },
        hora: {
          type: 'string',
          description: 'Hora opcional en formato HH:MM (24h, ej. "10:00"). Omite si no se mencionó.',
        },
        tipo: {
          type: 'string',
          enum: ['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO'],
          description: 'Categoría de la tarea',
        },
        codigo_cliente: {
          type: 'string',
          description: 'Código de cliente Softec (7 dígitos) si la tarea está relacionada a uno',
        },
        prioridad: {
          type: 'string',
          enum: ['BAJA', 'MEDIA', 'ALTA'],
          description: 'Prioridad (default MEDIA)',
        },
        descripcion: { type: 'string', description: 'Detalles opcionales' },
      },
      required: ['titulo', 'fecha_vencimiento'],
    },
  },
  {
    name: 'listar_tareas_pendientes',
    description:
      'Cuándo usar: el usuario pregunta "qué tengo pendiente", "qué hay para hoy", "tareas atrasadas", "qué le toca a fulano esta semana" — cualquier consulta del listado de pendientes.\n' +
      'Qué hace: lista tareas pendientes filtradas por rango (hoy / mañana / semana / atrasadas / todas) y opcionalmente por cliente.\n' +
      'Devuelve: { rango, total, tareas: [{tarea_id, titulo, fecha_vencimiento, hora, tipo, cliente, prioridad}] }.\n' +
      'Pre-condiciones: ninguna. Default rango="hoy".\n' +
      'NO usar si: el usuario quiere CREAR una tarea (eso es crear_tarea_recordatorio) o MARCARLA como hecha (marcar_tarea_completada).',
    input_schema: {
      type: 'object' as const,
      properties: {
        rango: {
          type: 'string',
          enum: ['hoy', 'mañana', 'semana', 'atrasadas', 'todas'],
          description: 'Rango de fechas. Default "hoy".',
        },
        codigo_cliente: {
          type: 'string',
          description: 'Filtrar por cliente específico (opcional)',
        },
      },
    },
  },
  {
    name: 'marcar_tarea_completada',
    description:
      'Cuándo usar: el usuario dice "ya hice X", "completé la tarea Y", "marca como hecho lo de Z", "lista" tras describir una acción terminada — cualquier confirmación de cierre de tarea existente.\n' +
      'Qué hace: marca la tarea (por su ID) como completada y registra notas opcionales del cierre.\n' +
      'Devuelve: { tarea_id, titulo, completada_en, notas }. Si la tarea no existe o ya estaba completada: error con motivo.\n' +
      'Pre-condiciones: tener el tarea_id numérico exacto. Si solo hay descripción, primero usar listar_tareas_pendientes para resolverlo.\n' +
      'NO usar si: la tarea aún no existe — usar crear_tarea_recordatorio primero.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tarea_id: { type: 'number', description: 'ID numérico de la tarea' },
        notas: { type: 'string', description: 'Notas opcionales del cierre' },
      },
      required: ['tarea_id'],
    },
  },
  {
    name: 'proponer_correo_cobranza_cliente',
    description:
      'Cuándo usar: el usuario dice "propón un correo a X", "redacta email para X", "envíale a X", "mándale a X" — siempre referido a generar UN mensaje de cobranza a un cliente específico.\n' +
      'Qué hace: genera un draft de correo basado en aging del cliente, perfil de riesgo y la plantilla más adecuada por segmento. NO envía — deja el draft en cola PENDIENTE de aprobación humana (CP-02). El bot lo presenta con botones aprobar/editar/descartar.\n' +
      'Devuelve: { gestion_id, cliente, saldo_neto, asunto, preview, destinatario_email } o error con motivo (SIN_FACTURAS_VENCIDAS, CLIENTE_PAUSADO, etc.). Si destinatario_email=null y no se pasó email_destino, el cliente no tiene email — pedirlo al usuario y llamar a guardar_email_cliente antes de presentar botones.\n' +
      'Pre-condiciones: antes de llamar, usar consultar_contactos_cliente_detalle para saber qué email destino usar y de dónde viene. Si el usuario dijo "con la plantilla X", primero listar_plantillas_email para resolver plantilla_id.\n' +
      'NO usar si: el usuario solo consulta el saldo o pide información (eso es consultar_saldo_cliente). Tampoco para WhatsApp (proponer_whatsapp_cobranza_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código exacto del cliente (alfanumérico como "RV0003" o numérico padded como "0000274") o nombre parcial. Si hay sesión activa, usá el código TAL CUAL aparece en la sesión, sin reformatear.',
        },
        email_destino: {
          type: 'string',
          description: 'Email destino explícito proporcionado por el usuario (ej. "cuentas@padron.com"). Omitir si el usuario no especificó un email.',
        },
        plantilla_id: {
          type: 'number',
          description: 'ID numérico de la plantilla a usar (ej. 7). Si se omite, Claude genera el correo. Obtén el ID con listar_plantillas si el usuario dijo "usa la plantilla X" o "con la plantilla estado de cuenta".',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'listar_plantillas_email',
    description:
      'Cuándo usar: el usuario quiere ver las plantillas de correo disponibles, dijo "usa la plantilla X", o necesitas resolver un plantilla_id por nombre antes de llamar proponer_correo_cobranza_cliente.\n' +
      'Qué hace: devuelve todas las plantillas de correo activas (ID, nombre, descripción, segmento, categoría, tono).\n' +
      'Devuelve: { total, plantillas: [{id, nombre, descripcion, segmento, categoria, tono}] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario quiere CREAR una plantilla nueva o EDITAR una existente — eso tiene endpoint propio, no va por el agente. Tampoco para listar plantillas de WhatsApp (no aplica: el draft de WhatsApp se genera libre).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'consultar_contactos_cliente',
    description:
      'Cuándo usar: cuando el usuario pregunte "qué contactos tenemos de X", "tiene email X", "qué whatsapp tiene X", o necesites listar emails/teléfonos disponibles antes de cualquier otra acción.\n' +
      'Qué hace: devuelve emails y teléfonos del cliente combinando nuestra BD (contactos_cliente, enriquecidos) y Softec (IC_ARCONTC), en modo resumen (sin fuente por contacto).\n' +
      'Devuelve: { codigo_cliente, nombre, emails: [string], whatsapps: [string], total_contactos }.\n' +
      'Pre-condiciones: acepta código o nombre parcial.\n' +
      'NO usar si: vas a redactar un correo/whatsapp y necesitas saber DE DÓNDE viene cada contacto (BD vs Softec) para decidir el destinatario — en ese caso usa consultar_contactos_cliente_detalle (gestion_cobranza).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente o nombre parcial',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'consultar_contactos_cliente_detalle',
    description:
      'Cuándo usar: antes de proponer_correo_cobranza_cliente o proponer_whatsapp_cobranza_cliente, cuando necesites decidir QUÉ email/teléfono usar como destinatario y de DÓNDE viene (BD interna vs Softec).\n' +
      'Qué hace: devuelve emails y teléfonos del cliente con la fuente de cada contacto (BD propia, enriquecido, Softec IC_ARCONTC), permitiendo elegir el destinatario más confiable.\n' +
      'Devuelve: { codigo_cliente, nombre, emails: [{valor, fuente, principal}], whatsapps: [{valor, fuente, principal}], total_contactos }.\n' +
      'Pre-condiciones: acepta código o nombre parcial.\n' +
      'NO usar si: el usuario solo está consultando "qué contactos tiene X" en plan informativo (eso es consultar_contactos_cliente, modo resumen).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente o nombre parcial',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'guardar_email_cliente',
    description:
      'Cuándo usar: el usuario dice "el email de X es Y", "agrégale el correo Y a X", "X tiene este email: Y" — siempre referido a registrar un email para un cliente.\n' +
      'Qué hace: guarda o actualiza el email del cliente en la BD propia (CP-01: NUNCA toca Softec). Confirmar con el usuario antes de guardar.\n' +
      'Devuelve: { codigo_cliente, campo: "email", valor, guardado_por }.\n' +
      'Pre-condiciones: tener el código exacto del cliente y un valor que parezca email. Si solo hay nombre, primero buscar_cliente.\n' +
      'NO usar si: el valor es un WhatsApp (guardar_whatsapp_cliente) o un nombre de contacto (guardar_contacto_cobros_cliente). Tampoco para REDACTAR un correo (proponer_correo_cobranza_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código exacto del cliente. Usalo tal cual aparece en el resultado de buscar_cliente / consultar_saldo_cliente o en la sesión activa. NO inventar ni reformatear. El formato puede ser alfanumérico ("RV0003") o numérico padded ("0000274") - depende del cliente.',
        },
        valor: {
          type: 'string',
          description: 'El email a guardar (ej. "cuentas@padron.com")',
        },
      },
      required: ['codigo_cliente', 'valor'],
    },
  },
  {
    name: 'guardar_whatsapp_cliente',
    description:
      'Cuándo usar: el usuario dice "el whatsapp de X es Y", "X tiene este número: Y", "guarda este wa para X" — registrar un teléfono WhatsApp para un cliente.\n' +
      'Qué hace: guarda o actualiza el WhatsApp del cliente en la BD propia (CP-01: NUNCA toca Softec). Confirmar con el usuario antes de guardar.\n' +
      'Devuelve: { codigo_cliente, campo: "whatsapp", valor, guardado_por }.\n' +
      'Pre-condiciones: código exacto del cliente y un valor que parezca número (idealmente con código de país, ej. "+5358xxxxxxx").\n' +
      'NO usar si: el valor es un email (guardar_email_cliente) o un nombre de contacto (guardar_contacto_cobros_cliente). Tampoco para REDACTAR un WhatsApp (proponer_whatsapp_cobranza_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código exacto del cliente. Usalo tal cual aparece en el resultado de buscar_cliente / consultar_saldo_cliente o en la sesión activa. NO inventar ni reformatear. El formato puede ser alfanumérico ("RV0003") o numérico padded ("0000274") - depende del cliente.',
        },
        valor: {
          type: 'string',
          description: 'El WhatsApp a guardar, con código de país (ej. "+593987654321")',
        },
      },
      required: ['codigo_cliente', 'valor'],
    },
  },
  {
    name: 'guardar_contacto_cobros_cliente',
    description:
      'Cuándo usar: el usuario dice "el contacto de cobros en X es Juan", "habla con Juan de X", "el responsable de pagos en X se llama Y" — registrar el NOMBRE de la persona contacto para cobros en un cliente.\n' +
      'Qué hace: guarda o actualiza el nombre del contacto cobros del cliente en la BD propia (CP-01: NUNCA toca Softec). Confirmar con el usuario antes de guardar.\n' +
      'Devuelve: { codigo_cliente, campo: "contacto_cobros", valor, guardado_por }.\n' +
      'Pre-condiciones: código exacto del cliente y el nombre del contacto.\n' +
      'NO usar si: el valor es un email (guardar_email_cliente) o un teléfono (guardar_whatsapp_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código exacto del cliente. Usalo tal cual aparece en el resultado de buscar_cliente / consultar_saldo_cliente o en la sesión activa. NO inventar ni reformatear. El formato puede ser alfanumérico ("RV0003") o numérico padded ("0000274") - depende del cliente.',
        },
        valor: {
          type: 'string',
          description: 'El nombre del contacto a guardar (ej. "Juan Pérez")',
        },
      },
      required: ['codigo_cliente', 'valor'],
    },
  },
  {
    name: 'listar_clientes_con_datos_faltantes',
    description:
      'Cuándo usar: el usuario pregunta "a quiénes les faltan datos", "clientes sin email", "quiénes no tienen WhatsApp", "a quién no podemos contactar" — referido a la cartera vencida.\n' +
      'Qué hace: lista clientes de la cartera vencida con datos de contacto incompletos (sin email y/o sin WhatsApp).\n' +
      'Devuelve: { faltante, total, clientes: [{codigo, nombre, saldo, falta_email, falta_whatsapp}] }.\n' +
      'Pre-condiciones: ninguna. Filtros opcionales: faltante (email|whatsapp|cualquiera), limite (default 15).\n' +
      'NO usar si: el usuario quiere GUARDAR un dato faltante específico (eso es guardar_email_cliente / guardar_whatsapp_cliente / guardar_contacto_cobros_cliente del contexto datos_contacto).',
    input_schema: {
      type: 'object' as const,
      properties: {
        faltante: {
          type: 'string',
          enum: ['email', 'whatsapp', 'cualquiera'],
          description: 'Filtrar por tipo de dato faltante. Default "cualquiera".',
        },
        limite: {
          type: 'number',
          description: 'Cantidad máxima a retornar (default 15)',
        },
      },
    },
  },
  {
    name: 'resumen_cadencias_automaticas',
    description:
      'Cuándo usar: el usuario pregunta "cómo van las cadencias", "estado de las cadencias", "qué hace el bot automático" — el sistema de envíos cíclicos por edad de cartera.\n' +
      'Qué hace: resumen del sistema de cadencias automáticas (facturas con cadencia activa, procesadas en el último run, cadencias configuradas, facturas listas para accionar hoy).\n' +
      'Devuelve: { activas, ultimo_run: {fecha, procesadas, exitosas, fallidas}, configuradas: [...], pendientes_hoy: N }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario quiere DRAFTS individuales (proponer_correo_cobranza_cliente, proponer_whatsapp_cobranza_cliente del contexto gestion_cobranza).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'proponer_whatsapp_cobranza_cliente',
    description:
      'Cuándo usar: el usuario dice "mándale un whatsapp a X", "propón un wa para X", "escríbele por whatsapp a X" — generar UN mensaje WhatsApp de cobranza para un cliente.\n' +
      'Qué hace: genera un draft de WhatsApp de cobranza y lo deja en cola PENDIENTE de aprobación (CP-02). Si hay factura escaneada en Drive, incluye el link en el mensaje.\n' +
      'Devuelve: { gestion_id, cliente, saldo_neto, preview, destinatario_telefono } o error con motivo. Si destinatario_telefono=null, el cliente no tiene WhatsApp — pedirlo y llamar a guardar_whatsapp_cliente antes de presentar botones.\n' +
      'Pre-condiciones: antes de llamar, usar consultar_contactos_cliente_detalle para saber qué teléfono usar.\n' +
      'NO usar si: el usuario quiere correo (proponer_correo_cobranza_cliente). Tampoco para responder a un cliente que escribió primero — eso es otro flujo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código exacto del cliente (alfanumérico como "RV0003" o numérico padded como "0000274") o nombre parcial. Si hay sesión activa, usá el código TAL CUAL aparece en la sesión, sin reformatear.',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'resumen_conciliacion_bancaria',
    description:
      'Cuándo usar: el usuario pregunta "cómo va la conciliación", "cómo quedó el extracto de hoy", "cuántos depósitos sin identificar", "cheques devueltos", "qué hay pendiente del banco".\n' +
      'Qué hace: resumen del último extracto cargado (conciliadas/por_aplicar/desconocidas/cheques_devueltos con montos) más un acumulado histórico y las tareas de seguimiento abiertas.\n' +
      'Devuelve: { ultimo_extracto: {archivo, banco, fecha_extracto, cargado_at} | null, del_ultimo_extracto: {conciliadas, por_aplicar, desconocidas, cheques_devueltos} (cada uno {cantidad, monto}), pendientes_historicos: {por_aplicar, desconocidas, cheques_devueltos} (cantidad total sin resolver, de cualquier extracto), tareas_abiertas: [{id, tipo, titulo, dias_abierta}] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario quiere VER las transacciones individuales con sus ids (usa listar_depositos_pendientes), o CARGAR/ASIGNAR/APROBAR una transacción (usa las tools correspondientes, o dile que suba el extracto por chat).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'listar_depositos_pendientes',
    description:
      'Cuándo usar: el usuario pregunta "qué depósitos quedaron sin dueño", "qué falta por aplicar", "dame los ids de los desconocidos", o después de cargar un extracto quiere ver el detalle. También cuando va a asignar o aprobar uno y necesita saber el id.\n' +
      'Qué hace: lista transacciones de conciliación que necesitan una decisión humana, con su ID (necesario para asignar_deposito_a_cliente / aprobar_deposito).\n' +
      'Devuelve: { total, depositos: [{id, estado, fecha_transaccion, descripcion, referencia, cuenta_origen, monto, moneda, archivo_origen, codigo_cliente}] }.\n' +
      'Pre-condiciones: ninguna. Por defecto solo mira el ÚLTIMO extracto cargado (solo_ultimo_extracto=true) — pon eso en false si el usuario pide ver todo el histórico.\n' +
      'NO usar si: el usuario solo quiere el conteo/resumen (usa resumen_conciliacion_bancaria).',
    input_schema: {
      type: 'object' as const,
      properties: {
        estado: {
          type: 'string',
          enum: ['DESCONOCIDO', 'POR_APLICAR', 'CHEQUE_DEVUELTO', 'TODOS'],
          description: 'Filtrar por estado. Default TODOS (desconocido+por_aplicar+cheque_devuelto).',
        },
        solo_ultimo_extracto: {
          type: 'boolean',
          description: 'Si true (default), solo el último extracto cargado. false = todo el histórico.',
        },
        limite: { type: 'number', description: 'Cantidad máxima a listar (default 20, tope 50)' },
      },
    },
  },
  {
    name: 'asignar_deposito_a_cliente',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE de quién es un depósito DESCONOCIDO — "el depósito 512 es de Padrón Office", "ese 512 es de CG0006" — con un id concreto (de listar_depositos_pendientes) y un cliente identificado.\n' +
      'Qué hace: asigna el cliente al depósito (pasa de DESCONOCIDO a POR_APLICAR) y aprende la cuenta bancaria de origen para la próxima vez (CP-05: nace en confianza MANUAL, nunca automática). NO aprueba el cobro — eso es aprobar_deposito, un paso aparte.\n' +
      'Devuelve: { mensaje: string }.\n' +
      'Pre-condiciones: conciliacion_id numérico exacto. Si el usuario dio un NOMBRE de cliente (no un código), primero usa buscar_cliente para resolver el código — nunca inventes un código.\n' +
      'NO usar si: el usuario no da un id concreto, o no identifica un cliente. NUNCA llamar esta tool por iniciativa propia — la orden del usuario ES la confirmación humana que exige CP-05.',
    input_schema: {
      type: 'object' as const,
      properties: {
        conciliacion_id: { type: 'number', description: 'ID numérico del depósito (de listar_depositos_pendientes)' },
        codigo_cliente: { type: 'string', description: 'Código del cliente (resuelto con buscar_cliente si el usuario solo dio el nombre)' },
      },
      required: ['conciliacion_id', 'codigo_cliente'],
    },
  },
  {
    name: 'aprobar_deposito',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE "aprueba el depósito 512", "ese ya lo puedes aplicar" — con un id concreto de un depósito en estado POR_APLICAR (ya tiene cliente asignado).\n' +
      'Qué hace: marca el depósito como CONCILIADO. Es la confirmación final antes de que contabilidad lo registre en Softec — la app no lo aplica sola en el ERP.\n' +
      'Devuelve: { mensaje: string }.\n' +
      'Pre-condiciones: conciliacion_id numérico exacto, y que el depósito ya esté POR_APLICAR (si está DESCONOCIDO, primero asignar_deposito_a_cliente).\n' +
      'NO usar si: el usuario no da un id concreto. NUNCA llamar esta tool por iniciativa propia.',
    input_schema: {
      type: 'object' as const,
      properties: {
        conciliacion_id: { type: 'number', description: 'ID numérico del depósito (de listar_depositos_pendientes)' },
      },
      required: ['conciliacion_id'],
    },
  },
  {
    name: 'consultar_notas_cliente',
    description:
      'Cuándo usar: el usuario pregunta "qué sabes de X", "qué hemos anotado sobre X", "cuál es el patrón de X", "memoria de X", "cómo le gusta pagar a X" — recuperar contexto guardado del cliente antes de redactar una gestión.\n' +
      'Qué hace: consulta las notas estructuradas guardadas para el cliente (patrón de pago, canal efectivo, contacto real, mejor momento, notas libres del equipo).\n' +
      'Devuelve: { codigo_cliente, tiene_memoria: bool, patron_pago, canal_efectivo, contacto_real, mejor_momento, notas_daria, actualizado_por, updated_at }.\n' +
      'Pre-condiciones: código exacto del cliente (no acepta nombre parcial).\n' +
      'NO usar si: el usuario pregunta por la cuenta, saldo o facturas (consultar_saldo_cliente). Tampoco para historial de mensajes (consultar_historial_conversaciones).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código exacto del cliente. Usalo tal cual aparece en el resultado de buscar_cliente / consultar_saldo_cliente o en la sesión activa. NO inventar ni reformatear. El formato puede ser alfanumérico ("RV0003") o numérico padded ("0000274") - depende del cliente.',
        },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'guardar_patron_pago_cliente',
    description:
      'Cuándo usar: el usuario describe CÓMO suele pagar un cliente — "X siempre paga a fin de mes", "X solo paga con recordatorio", "X paga el día 15", "X tarda 60 días pero paga".\n' +
      'Qué hace: guarda o actualiza el patrón de pago observado del cliente en la memoria estructurada.\n' +
      'Devuelve: { codigo_cliente, patron_pago, actualizado_por }.\n' +
      'Pre-condiciones: código exacto del cliente y texto descriptivo del patrón.\n' +
      'NO usar si: el usuario menciona el CANAL preferido (guardar_canal_efectivo_cliente) o una nota libre/anécdota sobre el cliente (guardar_nota_libre_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código del cliente (7 dígitos)',
        },
        patron_pago: {
          type: 'string',
          description: 'Descripción del patrón de pago observado (ej. "paga a fin de mes", "siempre necesita recordatorio")',
        },
      },
      required: ['codigo_cliente', 'patron_pago'],
    },
  },
  {
    name: 'guardar_canal_efectivo_cliente',
    description:
      'Cuándo usar: el usuario indica QUÉ canal funciona mejor con un cliente — "a X solo le funciona el WhatsApp", "mejor llámale a X", "X responde por email pero no por WhatsApp".\n' +
      'Qué hace: guarda o actualiza el canal de contacto más efectivo del cliente en la memoria estructurada.\n' +
      'Devuelve: { codigo_cliente, canal_efectivo, actualizado_por }.\n' +
      'Pre-condiciones: código exacto del cliente y canal en {EMAIL, WHATSAPP, LLAMADA, OTRO}.\n' +
      'NO usar si: el usuario describe el patrón de pago (guardar_patron_pago_cliente) o quiere REDACTAR un mensaje (proponer_correo_cobranza_cliente / proponer_whatsapp_cobranza_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código del cliente (7 dígitos)',
        },
        canal_efectivo: {
          type: 'string',
          enum: ['EMAIL', 'WHATSAPP', 'LLAMADA', 'OTRO'],
          description: 'Canal que ha respondido mejor con este cliente',
        },
      },
      required: ['codigo_cliente', 'canal_efectivo'],
    },
  },
  {
    name: 'guardar_nota_libre_cliente',
    description:
      'Cuándo usar: el usuario comparte una observación, anécdota, contexto del cliente que no encaja en patrón_pago ni canal_efectivo — "X cambió de dueño en marzo", "X tiene problemas de flujo", "X siempre pide descuento".\n' +
      'Qué hace: guarda una nota de texto libre sobre el cliente en la memoria estructurada (campo notas_daria).\n' +
      'Devuelve: { codigo_cliente, notas_daria, actualizado_por }.\n' +
      'Pre-condiciones: código exacto del cliente y texto de la nota.\n' +
      'NO usar si: la información es un patrón de pago (guardar_patron_pago_cliente), un canal preferido (guardar_canal_efectivo_cliente), o un dato de contacto (guardar_email_cliente / guardar_whatsapp_cliente / guardar_contacto_cobros_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código del cliente (7 dígitos)',
        },
        nota: {
          type: 'string',
          description: 'Texto libre de la nota a guardar',
        },
      },
      required: ['codigo_cliente', 'nota'],
    },
  },
  {
    name: 'consultar_perfil_riesgo_cliente',
    description:
      'Cuándo usar: cuando el usuario pregunte por el riesgo de un cliente ("cómo está X de riesgo", "le podemos vender a X", "hay que suspender a X"), o antes de redactar una gestión de cobranza agresiva.\n' +
      'Qué hace: devuelve el perfil de riesgo pre-calculado (score 0-100, nivel VERDE/AMARILLO/ROJO/CRITICO, tendencia) y las acciones recomendadas en crédito/ventas/cobranza.\n' +
      'Devuelve: { codigo_cliente, score, nivel, tendencia, acciones: {credito, ventas, cobranza}, resumen }. Si no existe perfil: error CLIENTE_SIN_PERFIL.\n' +
      'Pre-condiciones: código exacto del cliente (no acepta nombre parcial).\n' +
      'NO usar si: el usuario está pidiendo el saldo o las facturas — eso es consultar_saldo_cliente. Tampoco para el resumen de la cartera completa (resumen_riesgo_cartera, otro contexto).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código exacto del cliente. Usalo tal cual aparece en el resultado de buscar_cliente / consultar_saldo_cliente o en la sesión activa. NO inventar ni reformatear. El formato puede ser alfanumérico ("RV0003") o numérico padded ("0000274") - depende del cliente.',
        },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'resumen_riesgo_cartera',
    description:
      'Cuándo usar: el usuario pregunta por el riesgo agregado ("cómo está la cartera de riesgo", "a quiénes no debemos venderles", "quiénes están en cobro legal", "dashboard de riesgo") — SIN un cliente específico.\n' +
      'Qué hace: resumen ejecutivo del riesgo de toda la cartera (distribución por nivel, clientes críticos, tendencias a empeorar, recomendaciones de no venta).\n' +
      'Devuelve: { distribucion: {VERDE,AMARILLO,ROJO,CRITICO}, criticos: [...], a_no_vender: [...], deteriorando: [...] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario pregunta por UN cliente específico (eso es consultar_perfil_riesgo_cliente del contexto consulta_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        limite_criticos: {
          type: 'number',
          description: 'Cuántos clientes críticos listar (default 5)',
        },
      },
    },
  },
  {
    name: 'guardar_preferencia_equipo',
    description:
      'Cuándo usar: el usuario dice EXPLÍCITAMENTE "recuerda mi preferencia X", "de ahora en adelante haz Y", "anota para el equipo Z", "siempre que pase X haz Y", "prefiero que..." — registrar una preferencia DEL EQUIPO o del negocio (no de un cliente). NUNCA la infieras de una conversación normal — solo cuando el usuario la declare así de explícito.\n' +
      'Qué hace: guarda un dato permanente clave-valor. ambito=usuario (default) es solo para quien te habla; ambito=equipo la hace visible para cualquiera que use el bot — solo si el usuario dice "para el equipo", "que todos lo sepan" o similar.\n' +
      'Devuelve: { clave, valor, ambito, actualizado_por, actualizado_en }. Si la clave ya existía para ese usuario: la sobreescribe.\n' +
      'Pre-condiciones: clave en formato snake_case descriptivo (ej. "preferencia_correos_ricardo", "horario_reunion_semanal"). Valor claro y completo. ambito=equipo exige SUPERVISOR.\n' +
      'NO usar si: el usuario está hablando de UN cliente específico — eso es consultar_notas_cliente / guardar_patron_pago_cliente / guardar_canal_efectivo_cliente (contexto memoria). Tampoco inventes una preferencia que el usuario no pidió explícitamente guardar — confírmasela en una línea después de guardarla, nunca antes la asumas en silencio.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clave: {
          type: 'string',
          description: 'Nombre descriptivo y único del dato (ej. "preferencia_correos_ricardo", "clientes_daria", "horario_reunion_semanal")',
        },
        valor: {
          type: 'string',
          description: 'El dato a recordar, escrito de forma clara y completa para que sea útil en el futuro',
        },
        ambito: {
          type: 'string',
          enum: ['usuario', 'equipo'],
          description: 'usuario (default) = solo para ti. equipo = visible para todos — requiere que el usuario lo pida explícitamente y ser supervisor.',
        },
      },
      required: ['clave', 'valor'],
    },
  },
  {
    name: 'listar_disputas',
    description:
      'Cuándo usar: "cuántas disputas tenemos abiertas", "qué disputas hay de X cliente", "qué falta por resolver de disputas".\n' +
      'Qué hace: lista disputas de factura con filtro opcional por estado y/o cliente.\n' +
      'Devuelve: { total, disputas: [{id, codigo_cliente, nombre_cliente, ij_inum, motivo, monto_disputado, estado, resolucion, resuelto_por, fecha_resolucion, registrado_por, created_at}] }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: quiere abrir una nueva disputa (crear_disputa) o cambiarle el estado a una existente (resolver_disputa).',
    input_schema: {
      type: 'object' as const,
      properties: {
        estado: {
          type: 'string',
          enum: ['ABIERTA', 'EN_REVISION', 'RESUELTA', 'ANULADA'],
          description: 'Filtrar por estado. Sin este campo trae todas.',
        },
        codigo_cliente: { type: 'string', description: 'Filtrar por un cliente concreto.' },
        limite: { type: 'number', description: 'Cantidad máxima a listar (default 20, tope 50).' },
      },
    },
  },
  {
    name: 'crear_disputa',
    description:
      'Cuándo usar: el usuario reporta que un cliente disputa una factura — "X dice que la factura 12345 vino mal", "abre una disputa de la factura Y por mercancía dañada".\n' +
      'Qué hace: crea la disputa en estado ABIERTA. CP-03: mientras esté ABIERTA o EN_REVISION, esa factura queda excluida de la cobranza automática (cadencias no la tocan).\n' +
      'Devuelve: { mensaje, id }.\n' +
      'Pre-condiciones: código exacto del cliente (usa buscar_cliente si el usuario solo dio el nombre), número de factura (ij_inum) y un motivo de al menos 5 caracteres.\n' +
      'NO usar si: falta el motivo o el número de factura — pregunta antes de inventar cualquiera de los dos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente.' },
        ij_inum: { type: 'number', description: 'Número interno de la factura disputada.' },
        motivo: { type: 'string', description: 'Motivo de la disputa (mínimo 5 caracteres).' },
        monto_disputado: { type: 'number', description: 'Monto disputado, si el usuario lo da. Opcional.' },
      },
      required: ['codigo_cliente', 'ij_inum', 'motivo'],
    },
  },
  {
    name: 'resolver_disputa',
    description:
      'Cuándo usar: el usuario da una orden explícita sobre una disputa concreta — "la disputa 5 pasa a revisión", "resuelve la disputa 5: ya se aplicó el descuento", "anula la disputa 5".\n' +
      'Qué hace: transición de estado. ABIERTA→EN_REVISION o ANULADA. EN_REVISION→RESUELTA (exige resolución) o ANULADA. RESUELTA/ANULADA son finales — ya no admiten cambios.\n' +
      'Devuelve: { mensaje }. Si la transición no es válida, el mensaje explica por qué.\n' +
      'Pre-condiciones: disputa_id exacto (de listar_disputas); si estado=RESUELTA, hace falta indicar la resolución.\n' +
      'NO usar si: el usuario no da un id concreto. NUNCA llamar esta tool por iniciativa propia — la orden del usuario ES la confirmación.',
    input_schema: {
      type: 'object' as const,
      properties: {
        disputa_id: { type: 'number', description: 'ID numérico de la disputa (de listar_disputas).' },
        estado: {
          type: 'string',
          enum: ['EN_REVISION', 'RESUELTA', 'ANULADA'],
          description: 'Estado destino.',
        },
        resolucion: { type: 'string', description: 'Texto de la resolución. Obligatorio si estado=RESUELTA.' },
      },
      required: ['disputa_id', 'estado'],
    },
  },
  {
    name: 'enviar_reporte_excel',
    description:
      'Cuándo usar: "mándame el Excel de cartera", "el reporte de gestiones de este mes", "pásame el estado de cuenta de X en excel".\n' +
      'Qué hace: genera el archivo y te lo manda directo aquí en Telegram como documento adjunto. Si te habla desde el widget web, en su lugar devuelve el link de descarga (preséntalo como enlace: <a href="URL">Descargar reporte</a>).\n' +
      'Devuelve (Telegram): { mensaje }. Devuelve (web): { mensaje, url }.\n' +
      'Pre-condiciones: tipo en {cartera, gestiones, estado_cuenta}. estado_cuenta EXIGE codigo_cliente (usa buscar_cliente si solo hay nombre). gestiones acepta desde/hasta en YYYY-MM-DD (default: últimos 30 días).\n' +
      'NO usar si: tipo=estado_cuenta sin codigo_cliente resuelto — pregunta o busca el cliente primero.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tipo: {
          type: 'string',
          enum: ['cartera', 'gestiones', 'estado_cuenta'],
          description: 'Qué reporte generar.',
        },
        desde: { type: 'string', description: 'Solo para tipo=gestiones. Fecha YYYY-MM-DD.' },
        hasta: { type: 'string', description: 'Solo para tipo=gestiones. Fecha YYYY-MM-DD.' },
        codigo_cliente: { type: 'string', description: 'Obligatorio para tipo=estado_cuenta.' },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'enviar_factura_cliente',
    description:
      'Cuándo usar: orden explícita de un supervisor de mandar una factura puntual — "mándale la factura 12345 a Padrón por WhatsApp", "envíale el PDF de la 9080 a cxp@cliente.com".\n' +
      'Qué hace: manda el PDF de la factura (desde Google Drive) por email o WhatsApp a un destinatario. Busca el documento por número de factura — no hace falta ningún id interno.\n' +
      'Devuelve: { mensaje }. Si no hay PDF vinculado a esa factura, te lo dice (eso solo se sube desde la web, en Documentos).\n' +
      'Pre-condiciones: SOLO SUPERVISOR. ij_inum (número de factura) y codigo_cliente exactos (usa buscar_cliente si solo hay nombre), canal en {EMAIL, WHATSAPP}. Si el usuario no da destinatario, usa el email/WhatsApp guardado del cliente antes de preguntar.\n' +
      'NO usar si: no eres supervisor, o no se pudo identificar cliente+factura con certeza.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ij_inum: { type: 'number', description: 'Número de la factura (no un id interno).' },
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente dueño de la factura.' },
        canal: { type: 'string', enum: ['EMAIL', 'WHATSAPP'], description: 'Canal de envío.' },
        destinatario: { type: 'string', description: 'Email o teléfono destino. Si se omite, se usa el contacto guardado del cliente.' },
      },
      required: ['ij_inum', 'codigo_cliente', 'canal'],
    },
  },
  {
    name: 'listar_cadencias',
    description:
      'Cuándo usar: "qué cadencias tenemos configuradas", "cómo está armada la cobranza automática", "cuándo corrió por última vez la cadencia".\n' +
      'Qué hace: lista las reglas de cadencia (segmento + día desde vencimiento + acción) y cuándo fue la última corrida automática.\n' +
      'Devuelve: { cadencias: [{id, segmento, dia_desde_vencimiento, accion, requiere_aprobacion, plantilla_mensaje_id, activa}], ultimo_run }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: quiere prender/apagar una (activar_cadencia) o correrlas ya (ejecutar_cadencias_ahora).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'activar_cadencia',
    description:
      'Cuándo usar: "apaga la cadencia 3", "activa de nuevo la cadencia del segmento ROJO" — con un id concreto de listar_cadencias.\n' +
      'Qué hace: prende o apaga una regla de cadencia (no crea ni edita segmento/día/acción — eso solo en la web).\n' +
      'Devuelve: { mensaje }.\n' +
      'Pre-condiciones: SOLO SUPERVISOR. id numérico exacto de listar_cadencias.\n' +
      'NO usar si: no eres supervisor, o el usuario quiere cambiar el segmento/día/acción/plantilla (dile que eso es solo desde la web, en Configuración → Cadencias).',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'ID de la cadencia (de listar_cadencias).' },
        activa: { type: 'boolean', description: 'true = activar, false = desactivar.' },
      },
      required: ['id', 'activa'],
    },
  },
  {
    name: 'ejecutar_cadencias_ahora',
    description:
      'Cuándo usar: orden explícita de un supervisor de correr las cadencias YA, sin esperar a la corrida automática — "corre las cadencias ahora", "aplica la cobranza automática de una vez".\n' +
      'Qué hace: ejecuta el mismo job que corre solo cada hora (evaluar facturas vencidas contra las reglas de cadencia y aplicar la acción que corresponda a cada una).\n' +
      'Devuelve: { empresas, evaluadas, aplicadas, fastForward, omitidas, errores }.\n' +
      'Pre-condiciones: SOLO SUPERVISOR.\n' +
      'NO usar si: no eres supervisor, o el usuario no lo pidió explícitamente — esto APLICA acciones reales, no es de solo lectura.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'generar_cola_hoy',
    description:
      'Cuándo usar: orden explícita de un supervisor de generar la cola de aprobación del día — "genera la cola de hoy", "arma los mensajes de cobranza pendientes".\n' +
      'Qué hace: toma hasta 20 facturas vencidas sin gestión activa (excluye disputas CP-03, clientes pausados y clientes cubiertos por saldo a favor CP-15), redacta el mensaje de cada una con Claude o plantilla, y las deja en PENDIENTE de aprobación.\n' +
      'Devuelve: { generadas, total_facturas, clientes_excluidos_por_saldo_a_favor, facturas_excluidas_por_saldo_a_favor, modo }.\n' +
      'Pre-condiciones: SOLO SUPERVISOR. Cuesta llamadas reales a la API de Claude — nunca la llames por iniciativa propia.\n' +
      'NO usar si: no eres supervisor, o el usuario no lo pidió explícitamente en este turno.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'editar_gestion',
    description:
      'Cuándo usar: "cambia el asunto de la gestión 123 a...", "edita el correo de la 123: ...", "el WhatsApp de la 123 debería decir...", antes de aprobarla.\n' +
      'Qué hace: sobreescribe el asunto y/o el texto de email/WhatsApp de una gestión PENDIENTE. El mensaje original generado por IA queda guardado aparte (mensaje_propuesto_*) — esto solo cambia lo que se va a enviar.\n' +
      'Devuelve: { mensaje }. La gestión sigue PENDIENTE — no la envía ni la aprueba.\n' +
      'Pre-condiciones: gestion_id exacto (de listar_mensajes_pendientes_aprobacion), la gestión debe estar PENDIENTE, y al menos uno de asunto/texto_email/texto_whatsapp.\n' +
      'NO usar si: la gestión ya no está PENDIENTE (dirá el estado actual). Para aprobar después de editar, usa aprobar_gestion por separado.',
    input_schema: {
      type: 'object' as const,
      properties: {
        gestion_id: { type: 'number', description: 'ID de la gestión (de listar_mensajes_pendientes_aprobacion).' },
        asunto: { type: 'string', description: 'Nuevo asunto del email.' },
        texto_email: { type: 'string', description: 'Nuevo texto del email.' },
        texto_whatsapp: { type: 'string', description: 'Nuevo texto del WhatsApp.' },
      },
      required: ['gestion_id'],
    },
  },
  {
    name: 'pausar_cliente',
    description:
      'Cuándo usar: "pausa a Padrón hasta el 15 de septiembre", "no le mandes cobranza a X por ahora", "detén los mensajes automáticos a X hasta nuevo aviso".\n' +
      'Qué hace: excluye al cliente de la cadencia automática y de generar_cola_hoy hasta la fecha dada (no borra ni toca su email/whatsapp/notas guardados).\n' +
      'Devuelve: { mensaje }.\n' +
      'Pre-condiciones: SOLO SUPERVISOR. codigo_cliente exacto (usa buscar_cliente si solo hay nombre) y fecha hasta en YYYY-MM-DD.\n' +
      'NO usar si: no eres supervisor, o no hay fecha clara — pregunta hasta cuándo antes de pausar indefinidamente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente.' },
        hasta: { type: 'string', description: 'Fecha YYYY-MM-DD hasta la que queda pausado.' },
        motivo: { type: 'string', description: 'Motivo de la pausa, si el usuario lo da. Opcional.' },
      },
      required: ['codigo_cliente', 'hasta'],
    },
  },
  {
    name: 'reactivar_cliente',
    description:
      'Cuándo usar: "reactiva a Padrón", "ya puedes volver a cobrarle a X", "quita la pausa de X".\n' +
      'Qué hace: quita la pausa del cliente — vuelve a ser elegible para cadencia automática y generar_cola_hoy.\n' +
      'Devuelve: { mensaje }.\n' +
      'Pre-condiciones: SOLO SUPERVISOR. codigo_cliente exacto.\n' +
      'NO usar si: no eres supervisor, o el cliente no tenía pausa activa (te lo dirá).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente.' },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'generar_link_portal',
    description:
      'Cuándo usar: "dame el link del portal de 0000274", "mándale a X su link de autogestión", "necesito el portal del cliente Y".\n' +
      'Qué hace: genera un link de acceso al portal de autogestión del cliente (ve su estado de cuenta y facturas). Válido 30 días; genera uno nuevo invalida el anterior.\n' +
      'Devuelve: { mensaje, url, expiracion }.\n' +
      'Pre-condiciones: codigo_cliente exacto (usa buscar_cliente si solo hay nombre).\n' +
      'NO usar si: no se pudo identificar el cliente con certeza.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente.' },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'recordar_conversaciones',
    description:
      'Cuándo usar: "qué hablamos de X la semana pasada", "cuándo mencioné a Y", "busca en el historial cuándo dijimos Z".\n' +
      'Qué hace: busca en el historial de chat (texto libre y/o cliente y/o rango de fechas). SOLO busca en el grupo del equipo y en TU propio chat — nunca en chats privados de otras personas.\n' +
      'Devuelve: { total, resultados: [{rol, contenido, codigo_cliente, chat_id, created_at}] }.\n' +
      'Pre-condiciones: al menos uno de termino/codigo_cliente/desde/hasta — no traer todo el historial sin filtro. Si el usuario menciona un cliente por NOMBRE (no código), pasa el nombre directo como termino — NO hace falta resolver el código primero con buscar_cliente, el texto se busca tal cual aparece en los mensajes.\n' +
      'NO usar si: quieres TODO lo que pasó con un cliente en orden (facturas, pagos, tareas, no solo mensajes de chat) — para eso usa linea_de_tiempo_cliente.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: { type: 'string', description: 'Texto a buscar en el contenido de los mensajes.' },
        codigo_cliente: { type: 'string', description: 'Filtrar por cliente (código exacto).' },
        desde: { type: 'string', description: 'Fecha YYYY-MM-DD desde.' },
        hasta: { type: 'string', description: 'Fecha YYYY-MM-DD hasta.' },
        limite: { type: 'number', description: 'Cantidad máxima (default 15, tope 50).' },
      },
    },
  },
  {
    name: 'linea_de_tiempo_cliente',
    description:
      'Cuándo usar: "línea de tiempo de X", "qué ha pasado con X", "historial completo de X", "todo lo de X en agosto".\n' +
      'Qué hace: cruza TODO lo registrado del cliente en orden cronológico — gestiones, conversaciones enviadas, promesas de pago, conciliación bancaria, tareas, disputas y mensajes de chat.\n' +
      'Devuelve: { codigo_cliente, total, eventos: [{fecha, tipo, resumen}] } — tipo en {GESTION, CONVERSACION, PROMESA, CONCILIACION, TAREA, DISPUTA, MENSAJE}.\n' +
      'Pre-condiciones: codigo_cliente exacto (usa buscar_cliente si solo hay nombre).\n' +
      'NO usar si: solo quiere mensajes de chat (más barato: recordar_conversaciones), o el saldo/facturas actuales (consultar_saldo_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: { type: 'string', description: 'Código exacto del cliente.' },
        desde: { type: 'string', description: 'Fecha YYYY-MM-DD desde.' },
        hasta: { type: 'string', description: 'Fecha YYYY-MM-DD hasta.' },
        limite: { type: 'number', description: 'Cantidad máxima de eventos (default 30, tope 100).' },
      },
      required: ['codigo_cliente'],
    },
  },
];

interface ResultadoTool {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Envuelve aprobar_gestion/descartar_gestion/escalar_gestion: arma el
 * ActorGestion a partir del ctx (rol ya resuelto por el caller vía
 * TelegramUserAuth, sin round-trip extra a la DB) y valida que exista antes
 * de mutar nada.
 */
async function ejecutarAccionGestion(
  accion: (gestionId: number, actor: ActorGestion) => Promise<ResultadoAccionGestion>,
  gestionId: number,
  ctx?: { userId?: string; userEmail?: string; rol?: 'supervisor' | 'agente_cobros' }
): Promise<ResultadoTool> {
  if (!gestionId || Number.isNaN(gestionId)) {
    return { ok: false, error: 'gestion_id inválido o ausente.' };
  }
  if (!ctx?.rol) {
    return { ok: false, error: 'No se pudo verificar tu usuario de Telegram.' };
  }
  const resultado = await accion(gestionId, {
    userId: ctx.userId || 'desconocido',
    userEmail: ctx.userEmail || 'telegram:desconocido',
    esSupervisor: ctx.rol === 'supervisor',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

export async function ejecutarTool(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx?: {
    userId?: string;
    userEmail?: string;
    telegramUserId?: number;
    rol?: 'supervisor' | 'agente_cobros';
    chatId?: number;
  }
): Promise<ResultadoTool> {
  try {
    switch (nombre) {
      case 'consultar_saldo_cliente':
        return await consultarSaldoCliente(
          String(argumentos.termino),
          Boolean(argumentos.mostrar_todas)
        );

      case 'resumen_estado_cobros_hoy':
        return await estadoCobrosHoy();

      case 'listar_mensajes_pendientes_aprobacion':
        return await listarPendientesAprobacion(Number(argumentos.limite) || 10);

      case 'aprobar_gestion':
        return await ejecutarAccionGestion(aprobarGestion, Number(argumentos.gestion_id), ctx);

      case 'descartar_gestion': {
        const motivo = String(argumentos.motivo || '').trim();
        if (!motivo) return { ok: false, error: 'Falta el motivo del descarte.' };
        return await ejecutarAccionGestion(
          (id, actor) => descartarGestion(id, actor, motivo),
          Number(argumentos.gestion_id),
          ctx
        );
      }

      case 'escalar_gestion':
        return await ejecutarAccionGestion(
          (id, actor) => escalarGestion(id, actor, String(argumentos.notas || '')),
          Number(argumentos.gestion_id),
          ctx
        );

      case 'listar_promesas_pago_incumplidas':
        return await listarPromesasVencidas(Number(argumentos.limite) || 10);

      case 'consultar_historial_conversaciones':
        return await historialConversacionesCliente(
          String(argumentos.codigo_cliente),
          Number(argumentos.limite) || 10
        );

      case 'buscar_cliente':
        return await buscarCliente(String(argumentos.termino));

      case 'crear_tarea_recordatorio':
        return await crearTarea(argumentos, ctx);

      case 'listar_tareas_pendientes':
        return await listarTareas(argumentos);

      case 'marcar_tarea_completada':
        return await marcarTareaHecha(argumentos, ctx);

      case 'proponer_correo_cobranza_cliente': {
        const emailDestino = argumentos.email_destino ? String(argumentos.email_destino).trim() : undefined;
        const plantillaId = argumentos.plantilla_id ? Number(argumentos.plantilla_id) : undefined;
        const result = await proponerCorreoCliente(String(argumentos.termino), emailDestino, plantillaId);
        return { ok: result.ok, data: result };
      }

      case 'listar_plantillas_email': {
        const plantillas = await listarPlantillasActivas(EMPRESA_GUIPAK);
        return { ok: true, data: { total: plantillas.length, plantillas } };
      }

      case 'consultar_contactos_cliente':
      case 'consultar_contactos_cliente_detalle':
        return await obtenerContactosCliente(String(argumentos.termino));

      case 'guardar_email_cliente':
        return await guardarDatoCliente(
          String(argumentos.codigo_cliente),
          'email',
          String(argumentos.valor),
          ctx
        );

      case 'guardar_whatsapp_cliente':
        return await guardarDatoCliente(
          String(argumentos.codigo_cliente),
          'whatsapp',
          String(argumentos.valor),
          ctx
        );

      case 'guardar_contacto_cobros_cliente':
        return await guardarDatoCliente(
          String(argumentos.codigo_cliente),
          'contacto_cobros',
          String(argumentos.valor),
          ctx
        );

      case 'listar_clientes_con_datos_faltantes':
        return await listarClientesSinDatos(
          String(argumentos.faltante || 'cualquiera') as 'email' | 'whatsapp' | 'cualquiera',
          Number(argumentos.limite) || 15
        );

      case 'resumen_cadencias_automaticas':
        return await estadoCadencias();

      case 'resumen_conciliacion_bancaria':
        return await estadoConciliacion();

      case 'listar_depositos_pendientes': {
        const estadoFiltro = argumentos.estado as 'DESCONOCIDO' | 'POR_APLICAR' | 'CHEQUE_DEVUELTO' | 'TODOS' | undefined;
        const depositos = await listarDepositosPendientes({
          estado: estadoFiltro,
          soloUltimoExtracto: argumentos.solo_ultimo_extracto !== false,
          limite: Number(argumentos.limite) || 20,
        });
        return { ok: true, data: { total: depositos.length, depositos } };
      }

      case 'asignar_deposito_a_cliente':
        return await asignarDepositoTool(argumentos, ctx);

      case 'aprobar_deposito':
        return await aprobarDepositoTool(argumentos, ctx);

      case 'proponer_whatsapp_cobranza_cliente': {
        const result = await proponerWhatsAppCliente(String(argumentos.termino));
        return { ok: result.ok, data: result };
      }

      case 'consultar_notas_cliente':
        return await consultarMemoriaCliente(String(argumentos.codigo_cliente));

      case 'guardar_patron_pago_cliente':
        return await guardarMemoriaCliente(
          { codigo_cliente: argumentos.codigo_cliente, patron_pago: argumentos.patron_pago },
          ctx
        );

      case 'guardar_canal_efectivo_cliente':
        return await guardarMemoriaCliente(
          { codigo_cliente: argumentos.codigo_cliente, canal_efectivo: argumentos.canal_efectivo },
          ctx
        );

      case 'guardar_nota_libre_cliente':
        return await guardarMemoriaCliente(
          { codigo_cliente: argumentos.codigo_cliente, notas_daria: argumentos.nota },
          ctx
        );

      case 'guardar_preferencia_equipo':
        return await guardarMemoriaEquipoTool(argumentos, ctx);

      case 'consultar_perfil_riesgo_cliente':
        return await obtenerPerfilRiesgoCliente(String(argumentos.codigo_cliente));

      case 'resumen_riesgo_cartera':
        return await analizarRiesgoCartera(Number(argumentos.limite_criticos) || 5);

      case 'listar_disputas':
        return await listarDisputasTool(argumentos);

      case 'crear_disputa':
        return await crearDisputaTool(argumentos, ctx);

      case 'resolver_disputa':
        return await resolverDisputaTool(argumentos, ctx);

      case 'enviar_reporte_excel':
        return await enviarReporteExcelTool(argumentos, ctx);

      case 'enviar_factura_cliente':
        return await enviarFacturaClienteTool(argumentos, ctx);

      case 'listar_cadencias':
        return await listarCadenciasTool();

      case 'activar_cadencia':
        return await activarCadenciaTool(argumentos, ctx);

      case 'ejecutar_cadencias_ahora':
        return await ejecutarCadenciasAhoraTool(ctx);

      case 'generar_cola_hoy':
        return await generarColaHoyTool(ctx);

      case 'editar_gestion':
        return await editarGestionTool(argumentos, ctx);

      case 'pausar_cliente':
        return await pausarClienteTool(argumentos, ctx);

      case 'reactivar_cliente':
        return await reactivarClienteTool(argumentos, ctx);

      case 'generar_link_portal':
        return await generarLinkPortalTool(argumentos, ctx);

      case 'recordar_conversaciones':
        return await recordarConversacionesTool(argumentos, ctx);

      case 'linea_de_tiempo_cliente':
        return await lineaDeTiempoClienteTool(argumentos);

      default:
        return { ok: false, error: `Tool desconocida: ${nombre}` };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =====================================================================
// Implementaciones
// =====================================================================

const TOP_FACTURAS_DEFAULT = 5;

async function consultarSaldoCliente(
  termino: string,
  mostrarTodas: boolean = false
): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'No hay conexión a Softec' };

  const esCodigo = pareceCodigoCliente(termino);
  const filtro = esCodigo
    ? 'c.IC_CODE = ?'
    : '(c.IC_NAME LIKE ? OR c.IC_CODE = ?)';
  const params = esCodigo
    ? [normalizarCodigoCliente(termino)]
    : [`%${termino}%`, termino.trim()];

  const facturas = await softecQuery<{
    codigo: string;
    cliente: string;
    factura: number;
    fecha_vence: Date;
    dias_vencida: number;
    monto_total: number;
    saldo: number;
  }>(
    `SELECT
      c.IC_CODE AS codigo,
      c.IC_NAME AS cliente,
      f.IJ_INUM AS factura,
      f.IJ_DUEDATE AS fecha_vence,
      DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencida,
      f.IJ_TOT AS monto_total,
      (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE ${filtro}
      AND f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    ORDER BY f.IJ_DUEDATE ASC
    LIMIT 50`,
    params
  );

  if (facturas.length === 0) {
    return { ok: true, data: { mensaje: 'Cliente no tiene facturas pendientes', facturas: [] } };
  }

  const totalSaldo = facturas.reduce((sum, f) => sum + Number(f.saldo), 0);
  const cliente = String(facturas[0].cliente).trim();
  const codigo = String(facturas[0].codigo).trim();

  // CP-15: descontar saldo a favor del cliente (recibos sin aplicar).
  const saldosFavor = await obtenerSaldoAFavorPorCliente([codigo]);
  const saldoFavor = saldosFavor.get(codigo) ?? 0;
  const ajuste = ajustarSaldoCliente(totalSaldo, saldoFavor);

  // Enriquecer con perfil de riesgo si existe (Capa 2)
  const perfilRows = await cobranzasQuery<{
    risk_score: number;
    risk_level: string;
    tendencia: string;
    accion_credito: string;
    accion_ventas: string;
    accion_cobranza: string;
    resumen: string | null;
  }>(
    'SELECT risk_score, risk_level, tendencia, accion_credito, accion_ventas, accion_cobranza, resumen FROM cobranza_cliente_inteligencia WHERE empresa_id = 1 AND codigo_cliente = ?',
    [codigo]
  );
  const perfil = perfilRows[0] ?? null;

  // Conteo por segmento (rangos definidos en system prompt).
  const facturasPorSegmento = { VERDE: 0, AMARILLO: 0, NARANJA: 0, ROJO: 0 };
  for (const f of facturas) {
    const d = Number(f.dias_vencida);
    if (d <= 0) facturasPorSegmento.VERDE++;
    else if (d <= 15) facturasPorSegmento.AMARILLO++;
    else if (d <= 30) facturasPorSegmento.NARANJA++;
    else facturasPorSegmento.ROJO++;
  }

  // Top N facturas (ya vienen ordenadas por fecha_vence ASC = más vencidas primero).
  const facturasMostradas = mostrarTodas
    ? facturas
    : facturas.slice(0, TOP_FACTURAS_DEFAULT);

  return {
    ok: true,
    data: {
      cliente,
      codigo,
      total_facturas: facturas.length,
      saldo_total: totalSaldo,
      saldo_a_favor: ajuste.saldo_a_favor,
      saldo_neto: ajuste.saldo_neto,
      cubierto_por_anticipo: ajuste.cubierto_por_anticipo,
      perfil_riesgo: perfil
        ? {
            risk_score: perfil.risk_score,
            risk_level: perfil.risk_level,
            tendencia: perfil.tendencia,
            accion_credito: perfil.accion_credito,
            accion_ventas: perfil.accion_ventas,
            accion_cobranza: perfil.accion_cobranza,
            resumen: perfil.resumen,
          }
        : null,
      facturas_por_segmento: facturasPorSegmento,
      facturas: facturasMostradas.map((f) => ({
        factura: f.factura,
        fecha_vence: new Date(f.fecha_vence).toISOString().split('T')[0],
        dias_vencida: Number(f.dias_vencida),
        saldo: Number(f.saldo),
      })),
      facturas_truncadas:
        !mostrarTodas && facturas.length > TOP_FACTURAS_DEFAULT,
    },
  };
}

async function estadoCobrosHoy(): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();

  let cartera_total = 0;
  let cartera_a_favor = 0;
  let cartera_neta = 0;
  let clientes_cubiertos = 0;
  let total_facturas = 0;
  let total_clientes = 0;
  let dso = 0;
  const segmentos: Record<string, number> = { VERDE: 0, AMARILLO: 0, NARANJA: 0, ROJO: 0 };

  if (softecOk) {
    const seg = await softecQuery<{ segmento: string; num: number; saldo: number }>(`
      SELECT
        CASE
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
          WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30 THEN 'ROJO'
          ELSE 'VERDE'
        END AS segmento,
        COUNT(*) AS num,
        SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo
      FROM v_cobr_ijnl f
      WHERE f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F' AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      GROUP BY segmento
    `);
    for (const s of seg) {
      segmentos[s.segmento] = Number(s.num);
      total_facturas += Number(s.num);
      cartera_total += Number(s.saldo);
    }
    const tc = await softecQuery<{ total: number }>(
      `SELECT COUNT(DISTINCT IJ_CCODE) AS total FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0`
    );
    total_clientes = Number(tc[0]?.total) || 0;

    // CP-15: descontar saldo a favor por cliente para reportar bruto vs neto.
    const pendientesPorCliente = await softecQuery<{
      codigo_cliente: string;
      pendiente: number;
    }>(`
      SELECT IJ_CCODE AS codigo_cliente, SUM(IJ_TOT - IJ_TOTAPPL) AS pendiente
        FROM v_cobr_ijnl
       WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F'
         AND (IJ_TOT - IJ_TOTAPPL) > 0
       GROUP BY IJ_CCODE
    `);
    const codigos = pendientesPorCliente.map((p) => String(p.codigo_cliente).trim());
    const saldosFavor = await obtenerSaldoAFavorPorCliente(codigos);
    let aFavorAplicable = 0;
    let netoAcumulado = 0;
    for (const r of pendientesPorCliente) {
      const codigo = String(r.codigo_cliente).trim();
      const pendiente = Number(r.pendiente) || 0;
      const favor = saldosFavor.get(codigo) ?? 0;
      aFavorAplicable += Math.min(pendiente, favor);
      netoAcumulado += Math.max(0, pendiente - favor);
      if (favor >= pendiente && pendiente > 0) clientes_cubiertos += 1;
    }
    cartera_a_favor = Math.round(aFavorAplicable * 100) / 100;
    cartera_neta = Math.round(netoAcumulado * 100) / 100;

    // DSO = (CxC / ventas últimos 90 días) × 90 — sobre BRUTO a propósito
    // (misma query que app/api/cobranzas/dashboard/route.ts, CP-15 no aplica
    // aquí: es una métrica de disciplina contable, no de cobrabilidad real).
    const dsoData = await softecQuery<{ cxc: number; ventas_90: number }>(`
      SELECT
        (SELECT SUM(IJ_TOT - IJ_TOTAPPL) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_PAID='F' AND (IJ_TOT - IJ_TOTAPPL) > 0) AS cxc,
        (SELECT SUM(IJ_TOT) FROM v_cobr_ijnl WHERE IJ_TYPEDOC='IN' AND IJ_INVTORF='T' AND IJ_DATE >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)) AS ventas_90
    `);
    if (dsoData[0] && Number(dsoData[0].ventas_90) > 0) {
      dso = Math.round((Number(dsoData[0].cxc) / Number(dsoData[0].ventas_90)) * 90);
    }
  } else {
    // Mismo centinela que el dashboard web (dashboard/route.ts) — 45 exacto
    // es la señal de "sin conexión a Softec", documentada en CONOCIMIENTO_APP.
    dso = 45;
  }

  const pendientes = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE empresa_id = 1 AND estado='PENDIENTE'"
  );
  const promesasHoy = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE empresa_id = 1 AND estado='PENDIENTE' AND fecha_prometida = CURDATE()"
  );
  const promesasVencidas = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE empresa_id = 1 AND estado='PENDIENTE' AND fecha_prometida < CURDATE()"
  );

  return {
    ok: true,
    data: {
      cartera_total,
      cartera_a_favor,
      cartera_neta,
      clientes_cubiertos,
      total_facturas,
      total_clientes,
      dso,
      modo_mock: !softecOk,
      por_segmento: segmentos,
      mensajes_pendientes_aprobacion: Number(pendientes[0]?.total) || 0,
      promesas_vencen_hoy: Number(promesasHoy[0]?.total) || 0,
      promesas_vencidas: Number(promesasVencidas[0]?.total) || 0,
    },
  };
}

async function listarPendientesAprobacion(limite: number): Promise<ResultadoTool> {
  // LIMIT como literal, no como parámetro: mysql2/prepared statements
  // rechaza "LIMIT ?" en este servidor con "Incorrect arguments to
  // mysqld_stmt_execute" (2026-09-04).
  const limiteSeguro = Math.min(Math.max(Math.trunc(limite) || 10, 1), 50);
  const rows = await cobranzasQuery<{
    id: number;
    codigo_cliente: string;
    ij_inum: number;
    canal: string;
    saldo_pendiente: number;
    dias_vencida: number;
    segmento: string;
    created_at: string;
  }>(
    `SELECT id, codigo_cliente, ij_inum, canal, saldo_pendiente, dias_vencida, segmento, created_at
     FROM cobranza_gestiones
     WHERE empresa_id = 1 AND estado='PENDIENTE'
     ORDER BY created_at ASC
     LIMIT ${limiteSeguro}`,
    []
  );

  return {
    ok: true,
    data: {
      total: rows.length,
      mensajes: rows.map((r) => ({
        id: r.id,
        codigo_cliente: r.codigo_cliente,
        factura: r.ij_inum,
        canal: r.canal,
        saldo: Number(r.saldo_pendiente),
        dias_vencida: r.dias_vencida,
        segmento: r.segmento,
      })),
    },
  };
}

async function listarPromesasVencidas(limite: number): Promise<ResultadoTool> {
  // LIMIT como literal (ver nota en listarPendientesAprobacion arriba).
  const limiteSeguro = Math.min(Math.max(Math.trunc(limite) || 10, 1), 50);
  const rows = await cobranzasQuery<{
    id: number;
    codigo_cliente: string;
    ij_inum: number;
    monto_prometido: number;
    fecha_prometida: string;
  }>(
    `SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida
     FROM cobranza_acuerdos
     WHERE empresa_id = 1 AND estado='PENDIENTE' AND fecha_prometida < CURDATE()
     ORDER BY fecha_prometida ASC
     LIMIT ${limiteSeguro}`,
    []
  );

  return {
    ok: true,
    data: {
      total: rows.length,
      promesas: rows.map((r) => ({
        id: r.id,
        codigo_cliente: r.codigo_cliente,
        factura: r.ij_inum,
        monto: Number(r.monto_prometido),
        fecha_prometida: r.fecha_prometida,
        dias_retraso: Math.floor(
          (Date.now() - new Date(r.fecha_prometida).getTime()) / 86400000
        ),
      })),
    },
  };
}

async function historialConversacionesCliente(
  codigoCliente: string,
  limite: number
): Promise<ResultadoTool> {
  // LIMIT como literal (ver nota en listarPendientesAprobacion arriba).
  const limiteSeguro = Math.min(Math.max(Math.trunc(limite) || 10, 1), 50);
  const rows = await cobranzasQuery<{
    canal: string;
    direccion: string;
    contenido: string;
    created_at: string;
  }>(
    `SELECT canal, direccion, contenido, created_at
     FROM cobranza_conversaciones
     WHERE empresa_id = 1 AND codigo_cliente = ?
     ORDER BY created_at DESC
     LIMIT ${limiteSeguro}`,
    [normalizarCodigoCliente(codigoCliente)]
  );

  return {
    ok: true,
    data: {
      codigo_cliente: codigoCliente,
      total: rows.length,
      conversaciones: rows.map((r) => ({
        canal: r.canal,
        direccion: r.direccion,
        contenido: r.contenido?.substring(0, 500),
        fecha: r.created_at,
      })),
    },
  };
}

async function buscarCliente(termino: string): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  const esCodigo = pareceCodigoCliente(termino);
  const rows = await softecQuery<{
    codigo: string;
    nombre: string;
    saldo: number;
    facturas: number;
  }>(
    `SELECT
       c.IC_CODE AS codigo,
       c.IC_NAME AS nombre,
       COALESCE(SUM(f.IJ_TOT - f.IJ_TOTAPPL), 0) AS saldo,
       COUNT(f.IJ_INUM) AS facturas
     FROM v_cobr_icust c
     LEFT JOIN v_cobr_ijnl f ON f.IJ_CCODE = c.IC_CODE
       AND f.IJ_TYPEDOC='IN' AND f.IJ_INVTORF='T' AND f.IJ_PAID='F' AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
     WHERE c.IC_STATUS='A' AND (c.IC_NAME LIKE ? OR c.IC_CODE = ?)
     GROUP BY c.IC_CODE, c.IC_NAME
     ORDER BY saldo DESC
     LIMIT 15`,
    [`%${termino}%`, esCodigo ? normalizarCodigoCliente(termino) : termino.trim()]
  );

  // CP-15: enriquecer con saldo a favor y reordenar por saldo neto. Solo
  // consulta el helper si hay resultados con saldo > 0; si todos vienen en
  // cero (clientes sin facturas), no tiene sentido el query.
  const codigosConPendiente = rows
    .filter((r) => Number(r.saldo) > 0)
    .map((r) => String(r.codigo).trim());
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigosConPendiente);

  const clientes = rows
    .map((r) => {
      const codigo = String(r.codigo).trim();
      const saldoBruto = Number(r.saldo);
      const favor = saldosFavor.get(codigo) ?? 0;
      const ajuste = ajustarSaldoCliente(saldoBruto, favor);
      return {
        codigo,
        nombre: String(r.nombre).trim(),
        saldo_pendiente: saldoBruto,
        saldo_a_favor: ajuste.saldo_a_favor,
        saldo_neto: ajuste.saldo_neto,
        cubierto_por_anticipo: ajuste.cubierto_por_anticipo,
        facturas_pendientes: Number(r.facturas),
      };
    })
    .sort((a, b) => b.saldo_neto - a.saldo_neto);

  return {
    ok: true,
    data: {
      total: clientes.length,
      clientes,
    },
  };
}

// =====================================================================
// Tareas
// =====================================================================

function validarFechaIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

async function crearTarea(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const titulo = String(args.titulo || '').trim();
  const fecha = String(args.fecha_vencimiento || '').trim();
  if (!titulo || titulo.length < 2) return { ok: false, error: 'Título inválido' };
  if (!validarFechaIso(fecha))
    return { ok: false, error: 'fecha_vencimiento debe ser AAAA-MM-DD' };

  const tipo = String(args.tipo || 'OTRO');
  const tiposValidos = ['LLAMAR', 'DEPOSITAR_CHEQUE', 'SEGUIMIENTO', 'DOCUMENTO', 'REUNION', 'OTRO'];
  const tipoFinal = tiposValidos.includes(tipo) ? tipo : 'OTRO';

  const prioridad = String(args.prioridad || 'MEDIA');
  const prioridadFinal = ['BAJA', 'MEDIA', 'ALTA'].includes(prioridad) ? prioridad : 'MEDIA';

  const hora = args.hora ? String(args.hora) : null;
  const horaFinal = hora && /^\d{1,2}:\d{2}$/.test(hora) ? hora.padStart(5, '0') + ':00' : null;

  const codigoCliente = args.codigo_cliente ? normalizarCodigoCliente(String(args.codigo_cliente)) : null;
  const descripcion = args.descripcion ? String(args.descripcion) : null;
  const creadoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_tareas
     (empresa_id, titulo, descripcion, tipo, fecha_vencimiento, hora, codigo_cliente,
      prioridad, asignada_a, creado_por, origen)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')`,
    [
      titulo,
      descripcion,
      tipoFinal,
      fecha,
      horaFinal,
      codigoCliente,
      prioridadFinal,
      creadoPor,
      creadoPor,
    ]
  );

  const id = (result as { insertId?: number }).insertId;
  await logAccion(ctx?.userId || null, 'TAREA_CREADA_BOT', 'tarea', String(id), {
    titulo,
    fecha,
    via: 'telegram',
  });

  return {
    ok: true,
    data: {
      id,
      titulo,
      fecha_vencimiento: fecha,
      hora: horaFinal,
      tipo: tipoFinal,
      prioridad: prioridadFinal,
      codigo_cliente: codigoCliente,
    },
  };
}

async function listarTareas(args: Record<string, unknown>): Promise<ResultadoTool> {
  const rango = String(args.rango || 'hoy');
  const codigoCliente = args.codigo_cliente ? normalizarCodigoCliente(String(args.codigo_cliente)) : null;

  let where = "empresa_id = 1 AND estado IN ('PENDIENTE','EN_PROGRESO')";
  const params: (string | number)[] = [];

  if (rango === 'hoy') {
    where += ' AND fecha_vencimiento = CURDATE()';
  } else if (rango === 'mañana' || rango === 'manana') {
    where += ' AND fecha_vencimiento = DATE_ADD(CURDATE(), INTERVAL 1 DAY)';
  } else if (rango === 'semana') {
    where += ' AND fecha_vencimiento BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
  } else if (rango === 'atrasadas') {
    where += ' AND fecha_vencimiento < CURDATE()';
  }
  // 'todas' → sin filtro fecha

  if (codigoCliente) {
    where += ' AND codigo_cliente = ?';
    params.push(codigoCliente);
  }

  const rows = await cobranzasQuery<{
    id: number;
    titulo: string;
    tipo: string;
    fecha_vencimiento: string;
    hora: string | null;
    codigo_cliente: string | null;
    prioridad: string;
    estado: string;
    asignada_a: string | null;
  }>(
    `SELECT id, titulo, tipo, fecha_vencimiento, hora, codigo_cliente,
            prioridad, estado, asignada_a
       FROM cobranza_tareas
      WHERE ${where}
      ORDER BY fecha_vencimiento ASC, hora IS NULL, hora ASC, prioridad DESC, id ASC
      LIMIT 50`,
    params
  );

  return {
    ok: true,
    data: {
      rango,
      total: rows.length,
      tareas: rows.map((r) => ({
        id: r.id,
        titulo: r.titulo,
        tipo: r.tipo,
        fecha: typeof r.fecha_vencimiento === 'string'
          ? r.fecha_vencimiento.slice(0, 10)
          : new Date(r.fecha_vencimiento).toISOString().split('T')[0],
        hora: r.hora ? r.hora.slice(0, 5) : null,
        codigo_cliente: r.codigo_cliente,
        prioridad: r.prioridad,
        estado: r.estado,
        asignada_a: r.asignada_a,
      })),
    },
  };
}

// =====================================================================
// Datos de cliente (Capa C)
// =====================================================================

async function obtenerContactosCliente(termino: string): Promise<{
  ok: boolean;
  codigo?: string;
  nombre?: string;
  emails: { valor: string; fuente: string; es_principal: boolean }[];
  telefonos: { valor: string; fuente: string }[];
  error?: string;
}> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec', emails: [], telefonos: [] };

  const esCodigo = pareceCodigoCliente(termino);
  const filtro = esCodigo ? 'IC_CODE = ?' : 'IC_NAME LIKE ?';
  const param = esCodigo ? normalizarCodigoCliente(termino) : `%${termino.trim()}%`;

  const clientes = await softecQuery<{
    codigo: string;
    nombre: string;
    email_softec: string | null;
    telefono_softec: string | null;
  }>(
    `SELECT IC_CODE AS codigo, IC_NAME AS nombre, IC_ARCONTC AS email_softec, IC_PHONE AS telefono_softec
     FROM v_cobr_icust WHERE ${filtro} AND IC_STATUS='A' LIMIT 1`,
    [param]
  );

  if (clientes.length === 0) {
    return { ok: false, error: 'Cliente no encontrado', emails: [], telefonos: [] };
  }

  const { codigo, nombre, email_softec, telefono_softec } = clientes[0];
  const cod = String(codigo).trim();

  // Emails de nuestra BD
  const contactosEmail = await obtenerContactos(cod, EMPRESA_GUIPAK, 'EMAIL');
  const emailPropio = await resolverEmailPropio(cod, EMPRESA_GUIPAK);

  // Teléfonos de nuestra BD
  const contactosWa = await obtenerContactos(cod, EMPRESA_GUIPAK, 'WHATSAPP');
  const waPropio = await resolverWhatsAppPropio(cod, EMPRESA_GUIPAK);

  const emails: { valor: string; fuente: string; es_principal: boolean }[] = [];
  const telefonos: { valor: string; fuente: string }[] = [];

  // Primero emails de nuestra tabla nueva
  for (const c of contactosEmail) {
    emails.push({ valor: c.valor, fuente: 'BD propia', es_principal: c.es_principal });
  }

  // Email legacy enriquecidos (si no está ya en la lista)
  if (emailPropio && !contactosEmail.find((c) => c.valor === emailPropio)) {
    emails.push({ valor: emailPropio, fuente: 'BD propia (legacy)', es_principal: false });
  }

  // Email de Softec IC_ARCONTC
  const emailS = email_softec?.trim() || '';
  if (emailS && !emails.find((e) => e.valor === emailS)) {
    emails.push({ valor: emailS, fuente: 'Softec CxP', es_principal: false });
  }

  // WhatsApp
  for (const c of contactosWa) {
    telefonos.push({ valor: c.valor, fuente: 'BD propia' });
  }
  if (waPropio && !contactosWa.find((c) => c.valor === waPropio)) {
    telefonos.push({ valor: waPropio, fuente: 'BD propia (legacy)' });
  }
  const telS = telefono_softec?.trim() || '';
  if (telS && !telefonos.find((t) => t.valor === telS)) {
    telefonos.push({ valor: telS, fuente: 'Softec' });
  }

  return { ok: true, codigo: cod, nombre: String(nombre).trim(), emails, telefonos };
}

// =====================================================================

async function guardarDatoCliente(
  codigoCliente: string,
  campo: 'email' | 'whatsapp' | 'contacto_cobros',
  valor: string,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(codigoCliente);
  const valorTrimmed = valor.trim();
  if (!valorTrimmed) return { ok: false, error: 'Valor vacío' };

  const camposPermitidos = ['email', 'whatsapp', 'contacto_cobros'];
  if (!camposPermitidos.includes(campo)) {
    return { ok: false, error: `Campo inválido: ${campo}` };
  }

  const existente = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_clientes_enriquecidos WHERE empresa_id = 1 AND codigo_cliente = ? LIMIT 1',
    [codigo]
  );

  if (existente.length > 0) {
    await cobranzasExecute(
      `UPDATE cobranza_clientes_enriquecidos SET \`${campo}\` = ?, actualizado_por = ? WHERE empresa_id = 1 AND codigo_cliente = ?`,
      [valorTrimmed, ctx?.userEmail || `telegram:${ctx?.userId}`, codigo]
    );
  } else {
    await cobranzasExecute(
      `INSERT INTO cobranza_clientes_enriquecidos (empresa_id, codigo_cliente, \`${campo}\`, canal_preferido, actualizado_por)
       VALUES (1, ?, ?, 'EMAIL', ?)`,
      [codigo, valorTrimmed, ctx?.userEmail || `telegram:${ctx?.userId}`]
    );
  }

  await logAccion(ctx?.userId || null, 'DATO_CLIENTE_GUARDADO_BOT', 'cliente', codigo, {
    campo,
    valor: valorTrimmed,
    via: 'telegram',
  });

  return { ok: true, data: { codigo_cliente: codigo, campo, valor: valorTrimmed } };
}

// =====================================================================
// Capa C — Clientes sin datos de contacto
// =====================================================================

async function listarClientesSinDatos(
  faltante: 'email' | 'whatsapp' | 'cualquiera',
  limite: number
): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'Sin conexión a Softec' };

  // Obtener clientes con facturas vencidas desde Softec
  const clientesSoftec = await softecQuery<{
    codigo: string;
    nombre: string;
    email_softec: string | null;
    telefono_softec: string | null;
    saldo_bruto: number;
    facturas: number;
  }>(`
    SELECT
      c.IC_CODE  AS codigo,
      c.IC_NAME  AS nombre,
      c.IC_ARCONTC AS email_softec,
      c.IC_PHONE AS telefono_softec,
      SUM(f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_bruto,
      COUNT(f.IJ_INUM) AS facturas
    FROM v_cobr_ijnl f
    INNER JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
      AND DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 0
    GROUP BY c.IC_CODE, c.IC_NAME, c.IC_ARCONTC, c.IC_PHONE
    ORDER BY saldo_bruto DESC
    LIMIT 200
  `);

  if (clientesSoftec.length === 0) {
    return { ok: true, data: { total: 0, clientes: [] } };
  }

  // Datos enriquecidos locales
  const codigos = clientesSoftec.map((c) => String(c.codigo).trim());
  const enriqRows = await cobranzasQuery<{
    codigo_cliente: string;
    email: string | null;
    whatsapp: string | null;
  }>(
    `SELECT codigo_cliente, email, whatsapp
     FROM cobranza_clientes_enriquecidos
     WHERE empresa_id = 1 AND codigo_cliente IN (${codigos.map(() => '?').join(',')})`,
    codigos
  );
  const enriqMap = new Map(enriqRows.map((r) => [String(r.codigo_cliente).trim(), r]));

  // CP-15: saldos a favor
  const codigosConPendiente = clientesSoftec
    .filter((c) => Number(c.saldo_bruto) > 0)
    .map((c) => String(c.codigo).trim());
  const saldosFavor = await obtenerSaldoAFavorPorCliente(codigosConPendiente);

  const resultado: {
    codigo: string;
    nombre: string;
    saldo_neto: number;
    facturas: number;
    falta_email: boolean;
    falta_whatsapp: boolean;
  }[] = [];

  for (const c of clientesSoftec) {
    const codigo = String(c.codigo).trim();
    const enriq = enriqMap.get(codigo);

    const tieneEmail = !!(
      (c.email_softec && c.email_softec.trim()) ||
      (enriq?.email && enriq.email.trim())
    );
    const tieneWhatsapp = !!(
      (c.telefono_softec && c.telefono_softec.trim()) ||
      (enriq?.whatsapp && enriq.whatsapp.trim())
    );

    const faltaEmail = !tieneEmail;
    const faltaWhatsapp = !tieneWhatsapp;

    const pasaFiltro =
      faltante === 'cualquiera'
        ? faltaEmail || faltaWhatsapp
        : faltante === 'email'
        ? faltaEmail
        : faltaWhatsapp;

    if (!pasaFiltro) continue;

    const saldoBruto = Number(c.saldo_bruto) || 0;
    const favor = saldosFavor.get(codigo) ?? 0;
    const saldoNeto = Math.max(0, saldoBruto - favor);

    resultado.push({
      codigo,
      nombre: String(c.nombre).trim(),
      saldo_neto: saldoNeto,
      facturas: Number(c.facturas),
      falta_email: faltaEmail,
      falta_whatsapp: faltaWhatsapp,
    });
  }

  // Ordenar por saldo neto desc y cortar
  resultado.sort((a, b) => b.saldo_neto - a.saldo_neto);
  const paginado = resultado.slice(0, limite);

  return {
    ok: true,
    data: {
      total: resultado.length,
      mostrados: paginado.length,
      filtro: faltante,
      clientes: paginado,
    },
  };
}

// =====================================================================
// Capa D — Estado del sistema de cadencias
// =====================================================================

async function estadoCadencias(): Promise<ResultadoTool> {
  // Configuración activa
  const cadenciasConfig = await cobranzasQuery<{
    segmento: string;
    dia_desde_vencimiento: number;
    accion: string;
    requiere_aprobacion: number;
  }>(
    'SELECT segmento, dia_desde_vencimiento, accion, requiere_aprobacion FROM cobranza_cadencias WHERE empresa_id = 1 AND activa=1 ORDER BY dia_desde_vencimiento ASC'
  );

  // Último run
  const ultimoRun = await cobranzasQuery<{ detalle: string; created_at: string }>(
    "SELECT detalle, created_at FROM cobranza_logs WHERE empresa_id = 1 AND accion='CADENCIAS_HORARIAS' ORDER BY created_at DESC LIMIT 1"
  );

  // Facturas con estado de cadencia registrado
  const conEstado = await cobranzasQuery<{ total: number }>(
    'SELECT COUNT(*) AS total FROM cobranza_factura_cadencia_estado WHERE empresa_id = 1'
  );

  // Facturas pausadas individualmente
  const pausadas = await cobranzasQuery<{ total: number }>(
    'SELECT COUNT(*) AS total FROM cobranza_factura_cadencia_estado WHERE empresa_id = 1 AND pausada_hasta > NOW()'
  );

  // Stats del último run (extraído del JSON en detalle)
  let statsUltimoRun: Record<string, number> | null = null;
  if (ultimoRun[0]?.detalle) {
    try {
      statsUltimoRun = JSON.parse(ultimoRun[0].detalle) as Record<string, number>;
    } catch { /* ignorar parse errors */ }
  }

  // Gestiones generadas por cadencias en las últimas 24h
  const generadasHoy = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE empresa_id = 1 AND creado_por='cadencias' AND created_at >= NOW() - INTERVAL 24 HOUR"
  );

  return {
    ok: true,
    data: {
      cadencias_activas: cadenciasConfig.length,
      configuracion: cadenciasConfig.map((c) => ({
        segmento: c.segmento,
        dia: c.dia_desde_vencimiento,
        accion: c.accion,
        aprobacion: c.requiere_aprobacion ? 'manual' : 'auto',
      })),
      facturas_con_estado: Number(conEstado[0]?.total) || 0,
      facturas_pausadas: Number(pausadas[0]?.total) || 0,
      gestiones_generadas_24h: Number(generadasHoy[0]?.total) || 0,
      ultimo_run: ultimoRun[0]
        ? {
            fecha: ultimoRun[0].created_at,
            stats: statsUltimoRun,
          }
        : null,
    },
  };
}

// =====================================================================
// Capa 1 — Memoria estructurada del cliente
// =====================================================================

async function consultarMemoriaCliente(codigoCliente: string): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(codigoCliente);
  const rows = await cobranzasQuery<{
    patron_pago: string | null;
    canal_efectivo: string | null;
    contacto_real: string | null;
    mejor_momento: string | null;
    notas_daria: string | null;
    updated_at: string;
  }>(
    'SELECT patron_pago, canal_efectivo, contacto_real, mejor_momento, notas_daria, updated_at FROM cobranza_memoria_cliente WHERE empresa_id = 1 AND codigo_cliente = ?',
    [codigo]
  );

  if (rows.length === 0) {
    return { ok: true, data: { codigo_cliente: codigo, tiene_memoria: false } };
  }

  return {
    ok: true,
    data: {
      codigo_cliente: codigo,
      tiene_memoria: true,
      ...rows[0],
    },
  };
}

async function guardarMemoriaCliente(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || ''));
  if (codigo.replace(/[^0-9]/g, '').length === 0) {
    return { ok: false, error: 'codigo_cliente inválido' };
  }

  const campos: Record<string, string | null> = {};
  if (args.patron_pago !== undefined) campos.patron_pago = args.patron_pago ? String(args.patron_pago) : null;
  if (args.canal_efectivo !== undefined) campos.canal_efectivo = args.canal_efectivo ? String(args.canal_efectivo) : null;
  if (args.contacto_real !== undefined) campos.contacto_real = args.contacto_real ? String(args.contacto_real) : null;
  if (args.mejor_momento !== undefined) campos.mejor_momento = args.mejor_momento ? String(args.mejor_momento) : null;
  if (args.notas_daria !== undefined) campos.notas_daria = args.notas_daria ? String(args.notas_daria) : null;

  if (Object.keys(campos).length === 0) {
    return { ok: false, error: 'No se proporcionó ningún campo para actualizar' };
  }

  const actualizadoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;
  campos.actualizado_por = actualizadoPor;

  const existente = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_memoria_cliente WHERE empresa_id = 1 AND codigo_cliente = ?',
    [codigo]
  );

  if (existente.length > 0) {
    const sets = Object.keys(campos).map((k) => `\`${k}\` = ?`).join(', ');
    await cobranzasExecute(
      `UPDATE cobranza_memoria_cliente SET ${sets} WHERE empresa_id = 1 AND codigo_cliente = ?`,
      [...Object.values(campos), codigo]
    );
  } else {
    const colsExtra = Object.keys(campos).map((k) => `\`${k}\``).join(', ');
    const vals = Object.values(campos);
    await cobranzasExecute(
      `INSERT INTO cobranza_memoria_cliente (empresa_id, codigo_cliente, ${colsExtra}) VALUES (1, ?, ${vals.map(() => '?').join(', ')})`,
      [codigo, ...vals]
    );
  }

  await logAccion(ctx?.userId || null, 'MEMORIA_CLIENTE_GUARDADA', 'cliente', codigo, {
    campos: Object.keys(campos).filter((k) => k !== 'actualizado_por'),
    via: 'telegram',
  });

  return { ok: true, data: { codigo_cliente: codigo, campos_guardados: Object.keys(campos).filter((k) => k !== 'actualizado_por') } };
}

async function guardarMemoriaEquipoTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string; telegramUserId?: number; rol?: 'supervisor' | 'agente_cobros' }
): Promise<ResultadoTool> {
  const clave = String(args.clave || '').trim();
  const valor = String(args.valor || '').trim();
  if (!clave || clave.length < 2) return { ok: false, error: 'clave inválida' };
  if (!valor || valor.length < 2) return { ok: false, error: 'valor inválido' };

  const ambitoPedido = String(args.ambito || 'usuario').toLowerCase();
  if (ambitoPedido !== 'usuario' && ambitoPedido !== 'equipo') {
    return { ok: false, error: 'ambito inválido — debe ser usuario o equipo.' };
  }
  if (ambitoPedido === 'equipo' && ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede guardar una preferencia para todo el equipo.' };
  }
  const ambito: 'USUARIO' | 'EQUIPO' = ambitoPedido === 'equipo' ? 'EQUIPO' : 'USUARIO';

  // usuario_id (no telegram_user_id) es la identidad real: el widget web usa
  // telegram_user_id=0 para todos, así que guardar por eso colapsaba las
  // preferencias de cualquier persona que usara el chat web en un solo balde.
  const telegramUserId = ctx?.telegramUserId ?? 0;
  const usuarioId = Number(ctx?.userId) || 0;
  await guardarMemoriaEquipo(telegramUserId, usuarioId, clave, valor, ambito);
  await logAccion(ctx?.userId || null, 'MEMORIA_EQUIPO_GUARDADA', 'telegram', clave, {
    valor,
    ambito,
    usuario_id: usuarioId,
    via: 'telegram',
  });
  return { ok: true, data: { clave, valor, ambito: ambitoPedido } };
}

async function marcarTareaHecha(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const id = Number(args.tarea_id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'tarea_id inválido' };

  const existentes = await cobranzasQuery<{ id: number; titulo: string; estado: string }>(
    'SELECT id, titulo, estado FROM cobranza_tareas WHERE id = ? AND empresa_id = 1',
    [id]
  );
  if (existentes.length === 0) return { ok: false, error: 'Tarea no encontrada' };
  const t = existentes[0];
  if (t.estado === 'HECHA') return { ok: true, data: { id, mensaje: 'ya estaba HECHA' } };

  const cerradoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;
  const notas = args.notas ? String(args.notas) : null;

  await cobranzasExecute(
    `UPDATE cobranza_tareas
        SET estado='HECHA', completada_at=NOW(), completada_por=?, notas_completado=?
      WHERE id = ?`,
    [cerradoPor, notas, id]
  );

  await logAccion(ctx?.userId || null, 'TAREA_HECHA_BOT', 'tarea', String(id), { via: 'telegram' });

  return { ok: true, data: { id, titulo: t.titulo, mensaje: 'Marcada HECHA' } };
}

// =====================================================================
// Capa 2 — Inteligencia pre-computada de clientes
// =====================================================================

async function obtenerPerfilRiesgoCliente(codigoCliente: string): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(codigoCliente);

  const rows = await cobranzasQuery<{
    risk_score: number;
    risk_level: string;
    tendencia: string;
    saldo_pendiente: number;
    saldo_neto: number;
    saldo_a_favor: number;
    total_facturas: number;
    dias_mora_promedio: number;
    factura_mas_antigua_dias: number;
    promesas_total: number;
    promesas_cumplidas: number;
    tasa_cumplimiento_promesas: number;
    accion_credito: string;
    accion_ventas: string;
    accion_cobranza: string;
    razones: string | null;
    resumen: string | null;
    calculado_at: string;
  }>(
    `SELECT risk_score, risk_level, tendencia,
            saldo_pendiente, saldo_neto, saldo_a_favor, total_facturas,
            dias_mora_promedio, factura_mas_antigua_dias,
            promesas_total, promesas_cumplidas, tasa_cumplimiento_promesas,
            accion_credito, accion_ventas, accion_cobranza,
            razones, resumen, calculado_at
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND codigo_cliente = ?`,
    [codigo]
  );

  if (rows.length === 0) {
    return {
      ok: true,
      data: {
        codigo_cliente: codigo,
        tiene_perfil: false,
        mensaje: 'Perfil no calculado aún. El job nocturno lo generará esta noche si el cliente tiene saldo pendiente. Puedes ver el saldo actual con consultar_saldo_cliente.',
      },
    };
  }

  const r = rows[0];
  let razonesArr: string[] = [];
  try { razonesArr = r.razones ? JSON.parse(r.razones) : []; } catch { /* ignorar */ }

  return {
    ok: true,
    data: {
      codigo_cliente: codigo,
      tiene_perfil: true,
      risk_score: r.risk_score,
      risk_level: r.risk_level,
      tendencia: r.tendencia,
      saldo_pendiente: Number(r.saldo_pendiente),
      saldo_neto: Number(r.saldo_neto),
      saldo_a_favor: Number(r.saldo_a_favor),
      total_facturas: r.total_facturas,
      dias_mora_promedio: Number(r.dias_mora_promedio),
      factura_mas_antigua_dias: r.factura_mas_antigua_dias,
      promesas: {
        total: r.promesas_total,
        cumplidas: r.promesas_cumplidas,
        tasa_cumplimiento: Number(r.tasa_cumplimiento_promesas),
      },
      acciones_recomendadas: {
        credito: r.accion_credito,
        ventas: r.accion_ventas,
        cobranza: r.accion_cobranza,
      },
      razones: razonesArr,
      resumen: r.resumen,
      calculado_at: r.calculado_at,
    },
  };
}

async function analizarRiesgoCartera(limiteCriticos: number): Promise<ResultadoTool> {
  // LIMIT como literal (ver nota en listarPendientesAprobacion arriba).
  const limiteCriticosSeguro = Math.min(Math.max(Math.trunc(limiteCriticos) || 5, 1), 30);

  // Distribución por nivel
  const distribucion = await cobranzasQuery<{
    risk_level: string;
    cantidad: number;
    saldo_neto_total: number;
  }>(
    `SELECT risk_level, COUNT(*) AS cantidad, SUM(saldo_neto) AS saldo_neto_total
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1
     GROUP BY risk_level
     ORDER BY FIELD(risk_level, 'CRITICO','ROJO','AMARILLO','VERDE')`
  );

  // Top clientes críticos
  const criticos = await cobranzasQuery<{
    codigo_cliente: string;
    nombre_cliente: string;
    risk_score: number;
    risk_level: string;
    saldo_neto: number;
    accion_credito: string;
    accion_ventas: string;
    tendencia: string;
  }>(
    `SELECT codigo_cliente, nombre_cliente, risk_score, risk_level, saldo_neto,
            accion_credito, accion_ventas, tendencia
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND risk_level IN ('CRITICO','ROJO')
     ORDER BY risk_score DESC, saldo_neto DESC
     LIMIT ${limiteCriticosSeguro}`,
    []
  );

  // Clientes con tendencia empeorando
  const empeorando = await cobranzasQuery<{
    codigo_cliente: string;
    nombre_cliente: string;
    risk_level: string;
    saldo_neto: number;
  }>(
    `SELECT codigo_cliente, nombre_cliente, risk_level, saldo_neto
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND tendencia = 'EMPEORANDO'
     ORDER BY saldo_neto DESC
     LIMIT 10`
  );

  // No vender
  const noVender = await cobranzasQuery<{
    codigo_cliente: string;
    nombre_cliente: string;
    accion_ventas: string;
    risk_level: string;
  }>(
    `SELECT codigo_cliente, nombre_cliente, accion_ventas, risk_level
     FROM cobranza_cliente_inteligencia
     WHERE empresa_id = 1 AND accion_ventas IN ('NO_VENDER','REQUIERE_ABONO')
     ORDER BY FIELD(accion_ventas,'NO_VENDER','REQUIERE_ABONO'), risk_score DESC
     LIMIT 15`
  );

  // Total de clientes en tabla
  const totalRows = await cobranzasQuery<{ total: number; calculado_at: string }>(
    `SELECT COUNT(*) AS total, MAX(calculado_at) AS calculado_at FROM cobranza_cliente_inteligencia WHERE empresa_id = 1`
  );

  return {
    ok: true,
    data: {
      total_clientes_en_cartera: Number(totalRows[0]?.total) || 0,
      ultimo_calculo: totalRows[0]?.calculado_at || null,
      distribucion_riesgo: distribucion.map((d) => ({
        nivel: d.risk_level,
        cantidad: Number(d.cantidad),
        saldo_neto: Number(d.saldo_neto_total),
      })),
      clientes_criticos_rojo: criticos.map((c) => ({
        codigo: c.codigo_cliente,
        nombre: c.nombre_cliente,
        score: c.risk_score,
        nivel: c.risk_level,
        saldo_neto: Number(c.saldo_neto),
        accion_credito: c.accion_credito,
        accion_ventas: c.accion_ventas,
        tendencia: c.tendencia,
      })),
      clientes_empeorando: empeorando.map((c) => ({
        codigo: c.codigo_cliente,
        nombre: c.nombre_cliente,
        nivel: c.risk_level,
        saldo_neto: Number(c.saldo_neto),
      })),
      restriccion_ventas: noVender.map((c) => ({
        codigo: c.codigo_cliente,
        nombre: c.nombre_cliente,
        restriccion: c.accion_ventas,
        nivel: c.risk_level,
      })),
    },
  };
}

/**
 * Reescrita (2026-09-03) para acotar al ÚLTIMO extracto en vez de agregar TODA
 * la historia — la forma real no coincidía con lo que la description del tool
 * prometía, y para un cierre diario hacía falta distinguir "hoy" de
 * "acumulado". Ya no expone montos/cantidades sin ids: para eso está
 * listar_depositos_pendientes.
 */
async function estadoConciliacion(): Promise<ResultadoTool> {
  const extracto = await ultimoExtracto(EMPRESA_GUIPAK);

  const porEstadoDelExtracto = extracto
    ? await cobranzasQuery<{ estado: string; cantidad: number; total: number }>(
        `SELECT estado, COUNT(*) AS cantidad, SUM(monto) AS total
         FROM cobranza_conciliacion
         WHERE empresa_id = ? AND archivo_origen = ?
         GROUP BY estado`,
        [EMPRESA_GUIPAK, extracto.archivo]
      )
    : [];

  const pendientesHistoricos = await cobranzasQuery<{ estado: string; cantidad: number }>(
    `SELECT estado, COUNT(*) AS cantidad
     FROM cobranza_conciliacion
     WHERE empresa_id = ? AND estado IN ('POR_APLICAR','DESCONOCIDO','CHEQUE_DEVUELTO')
     GROUP BY estado`,
    [EMPRESA_GUIPAK]
  );

  const tareas = await cobranzasQuery<{ id: number; tipo: string; titulo: string; created_at: string }>(
    `SELECT id, tipo, titulo, created_at
     FROM cobranza_tareas
     WHERE empresa_id = 1 AND origen = 'CONCILIACION' AND estado IN ('PENDIENTE', 'EN_PROGRESO')
     ORDER BY created_at DESC LIMIT 20`
  );

  const porEstado = (estado: string) => {
    const r = porEstadoDelExtracto.find((x) => x.estado === estado);
    return { cantidad: Number(r?.cantidad || 0), monto: Number(r?.total || 0) };
  };
  const cantidadHistorica = (estado: string) =>
    Number(pendientesHistoricos.find((x) => x.estado === estado)?.cantidad || 0);

  return {
    ok: true,
    data: {
      ultimo_extracto: extracto
        ? {
            archivo: extracto.archivo,
            banco: extracto.banco,
            fecha_extracto: extracto.fechaExtracto,
            cargado_at: extracto.cargadoAt,
          }
        : null,
      del_ultimo_extracto: {
        conciliadas: porEstado('CONCILIADO'),
        por_aplicar: porEstado('POR_APLICAR'),
        desconocidas: porEstado('DESCONOCIDO'),
        cheques_devueltos: porEstado('CHEQUE_DEVUELTO'),
      },
      pendientes_historicos: {
        por_aplicar: cantidadHistorica('POR_APLICAR'),
        desconocidas: cantidadHistorica('DESCONOCIDO'),
        cheques_devueltos: cantidadHistorica('CHEQUE_DEVUELTO'),
      },
      tareas_abiertas: tareas.map((t) => ({
        id: t.id,
        tipo: t.tipo,
        titulo: t.titulo,
        dias_abierta: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000),
      })),
    },
  };
}

/** Exige supervisor (paridad con /conciliacion/[id]/asignar-cliente, ADMIN|SUPERVISOR). */
async function asignarDepositoTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string; rol?: 'supervisor' | 'agente_cobros' }
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede asignar un cliente a un depósito.' };
  }
  const id = Number(args.conciliacion_id);
  if (!id || Number.isNaN(id)) return { ok: false, error: 'conciliacion_id inválido o ausente.' };
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };

  // Nombre canónico desde Softec (no el que el modelo haya transcrito) — para
  // que cobranza_cuentas_aprendizaje y el log de CP-08 queden con el nombre
  // real del cliente, igual que hace enviar-gestion.ts para el destinatario.
  const cliente = await softecQuery<{ nombre: string }>(
    "SELECT IC_NAME AS nombre FROM v_cobr_icust WHERE IC_CODE = ? LIMIT 1",
    [codigo]
  );
  const nombre = cliente[0]?.nombre ? String(cliente[0].nombre).trim() : codigo;

  const resultado = await asignarClienteADeposito(id, codigo, nombre, {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

/** Exige supervisor (paridad con /conciliacion/[id]/aprobar, ADMIN|SUPERVISOR). */
async function aprobarDepositoTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string; rol?: 'supervisor' | 'agente_cobros' }
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede aprobar un depósito.' };
  }
  const id = Number(args.conciliacion_id);
  if (!id || Number.isNaN(id)) return { ok: false, error: 'conciliacion_id inválido o ausente.' };

  const resultado = await aprobarDeposito(id, {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function listarDisputasTool(args: Record<string, unknown>): Promise<ResultadoTool> {
  const estado = args.estado as 'ABIERTA' | 'EN_REVISION' | 'RESUELTA' | 'ANULADA' | undefined;
  const codigoCliente = args.codigo_cliente
    ? normalizarCodigoCliente(String(args.codigo_cliente))
    : undefined;
  const disputas = await listarDisputas({
    estado,
    codigoCliente,
    limite: Number(args.limite) || 20,
  });
  return { ok: true, data: { total: disputas.length, disputas } };
}

async function crearDisputaTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };
  const ijInum = Number(args.ij_inum);
  if (!ijInum || Number.isNaN(ijInum)) return { ok: false, error: 'ij_inum inválido o ausente.' };
  const motivo = String(args.motivo || '').trim();
  if (motivo.length < 5) return { ok: false, error: 'El motivo debe tener al menos 5 caracteres.' };
  const montoDisputado = args.monto_disputado != null ? Number(args.monto_disputado) : undefined;

  const resultado = await crearDisputa(
    { codigoCliente: codigo, ijInum, motivo, montoDisputado },
    { userId: ctx?.userId || 'desconocido', userEmail: ctx?.userEmail || 'telegram:desconocido' }
  );
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje, id: resultado.id } };
}

async function resolverDisputaTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const id = Number(args.disputa_id);
  if (!id || Number.isNaN(id)) return { ok: false, error: 'disputa_id inválido o ausente.' };
  const estado = args.estado as 'EN_REVISION' | 'RESUELTA' | 'ANULADA';
  if (!['EN_REVISION', 'RESUELTA', 'ANULADA'].includes(estado)) {
    return { ok: false, error: 'estado inválido — debe ser EN_REVISION, RESUELTA o ANULADA.' };
  }
  const resolucion = args.resolucion ? String(args.resolucion).trim() : undefined;

  const resultado = await actualizarDisputa(
    id,
    { estado, resolucion },
    { userId: ctx?.userId || 'desconocido', userEmail: ctx?.userEmail || 'telegram:desconocido' }
  );
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

/**
 * En Telegram (telegramUserId != 0) manda el documento directo al chat con
 * sendDocument. En el widget web (telegramUserId === 0, sentinela fijado en
 * app/api/cobranzas/asistente/chat/route.ts) no hay a quién mandarle un
 * adjunto — se devuelve la URL de la ruta de descarga existente, que ya
 * autentica con la cookie de sesión del propio navegador.
 */
async function enviarReporteExcelTool(
  args: Record<string, unknown>,
  ctx?: { telegramUserId?: number; chatId?: number }
): Promise<ResultadoTool> {
  const tipo = String(args.tipo || '');
  if (!['cartera', 'gestiones', 'estado_cuenta'].includes(tipo)) {
    return { ok: false, error: 'tipo inválido — debe ser cartera, gestiones o estado_cuenta.' };
  }

  let codigo = '';
  if (tipo === 'estado_cuenta') {
    codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
    if (!codigo) return { ok: false, error: 'codigo_cliente es obligatorio para tipo=estado_cuenta.' };
  }

  const esWeb = (ctx?.telegramUserId ?? 0) === 0;

  if (esWeb) {
    const params = new URLSearchParams();
    let ruta = '';
    if (tipo === 'cartera') {
      ruta = '/api/cobranzas/reportes/cartera-excel';
    } else if (tipo === 'gestiones') {
      ruta = '/api/cobranzas/reportes/gestiones-excel';
      if (args.desde) params.set('desde', String(args.desde));
      if (args.hasta) params.set('hasta', String(args.hasta));
    } else {
      ruta = '/api/cobranzas/reportes/estado-cuenta-excel';
      params.set('cliente', codigo);
    }
    const query = params.toString();
    const url = query ? `${ruta}?${query}` : ruta;
    return { ok: true, data: { mensaje: 'Reporte listo para descargar.', url } };
  }

  if (!ctx?.chatId) return { ok: false, error: 'No se pudo determinar el chat destino.' };

  const reporte =
    tipo === 'cartera'
      ? await generarExcelCartera(EMPRESA_GUIPAK)
      : tipo === 'gestiones'
        ? await generarExcelGestiones(
            EMPRESA_GUIPAK,
            args.desde ? String(args.desde) : undefined,
            args.hasta ? String(args.hasta) : undefined
          )
        : await generarExcelEstadoCuenta(EMPRESA_GUIPAK, codigo);

  await getTelegraf().telegram.sendDocument(
    ctx.chatId,
    Input.fromBuffer(reporte.buffer, reporte.filename)
  );
  return {
    ok: true,
    data: { mensaje: `Te envié ${reporte.filename} (${reporte.registros} filas).` },
  };
}

type CtxSupervisor = { userId?: string; userEmail?: string; rol?: 'supervisor' | 'agente_cobros' };

async function enviarFacturaClienteTool(
  args: Record<string, unknown>,
  ctx?: CtxSupervisor
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede enviar una factura manualmente.' };
  }
  const ijInum = Number(args.ij_inum);
  if (!ijInum || Number.isNaN(ijInum)) return { ok: false, error: 'ij_inum inválido o ausente.' };
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };
  const canal = args.canal as 'EMAIL' | 'WHATSAPP';
  if (canal !== 'EMAIL' && canal !== 'WHATSAPP') return { ok: false, error: 'canal debe ser EMAIL o WHATSAPP.' };

  // No hay tool que exponga el id interno de cobranza_facturas_documentos —
  // se resuelve aquí por número de factura, que es lo que el usuario dice.
  const docs = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_facturas_documentos WHERE ij_inum = ? AND codigo_cliente = ? AND empresa_id = ? LIMIT 1',
    [ijInum, codigo, EMPRESA_GUIPAK]
  );
  if (docs.length === 0) {
    return { ok: false, error: `No hay un PDF vinculado a la factura ${ijInum} de ${codigo}. Eso se sube desde la web, en Documentos.` };
  }

  let destinatario = args.destinatario ? String(args.destinatario).trim() : '';
  if (!destinatario) {
    destinatario =
      (canal === 'EMAIL'
        ? await resolverEmailPropio(codigo, EMPRESA_GUIPAK)
        : await resolverWhatsAppPropio(codigo, EMPRESA_GUIPAK)) || '';
  }
  if (!destinatario) {
    return {
      ok: false,
      error: 'No se pudo determinar el destinatario — dalo explícito o registra el contacto del cliente primero.',
    };
  }

  const resultado = await enviarFacturaCliente(
    { documentoId: docs[0].id, canal, destinatario },
    { userId: ctx?.userId || 'desconocido', userEmail: ctx?.userEmail || 'telegram:desconocido' }
  );
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function listarCadenciasTool(): Promise<ResultadoTool> {
  const resultado = await listarCadencias();
  return { ok: true, data: resultado };
}

async function activarCadenciaTool(
  args: Record<string, unknown>,
  ctx?: CtxSupervisor
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede activar o desactivar una cadencia.' };
  }
  const id = Number(args.id);
  if (!id || Number.isNaN(id)) return { ok: false, error: 'id inválido o ausente.' };
  const resultado = await actualizarCadencia(id, Boolean(args.activa), {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function ejecutarCadenciasAhoraTool(ctx?: CtxSupervisor): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede ejecutar las cadencias manualmente.' };
  }
  const stats = await ejecutarCadenciasHorarias();
  return { ok: true, data: stats };
}

async function generarColaHoyTool(ctx?: CtxSupervisor): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') {
    return { ok: false, error: 'Solo un supervisor puede generar la cola de aprobación.' };
  }
  const resultado = await generarColaAprobacion({
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: true, data: resultado };
}

async function editarGestionTool(
  args: Record<string, unknown>,
  ctx?: CtxSupervisor
): Promise<ResultadoTool> {
  const id = Number(args.gestion_id);
  if (!id || Number.isNaN(id)) return { ok: false, error: 'gestion_id inválido o ausente.' };

  const resultado = await editarGestion(
    id,
    {
      userId: ctx?.userId || 'desconocido',
      userEmail: ctx?.userEmail || 'telegram:desconocido',
      esSupervisor: ctx?.rol === 'supervisor',
    },
    {
      asunto: args.asunto ? String(args.asunto) : undefined,
      textoEmail: args.texto_email ? String(args.texto_email) : undefined,
      textoWhatsapp: args.texto_whatsapp ? String(args.texto_whatsapp) : undefined,
    }
  );
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function pausarClienteTool(
  args: Record<string, unknown>,
  ctx?: CtxSupervisor
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') return { ok: false, error: 'Solo un supervisor puede pausar un cliente.' };
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };
  const hasta = String(args.hasta || '').trim();
  if (!hasta) return { ok: false, error: 'Falta la fecha hasta la que se pausa (YYYY-MM-DD).' };
  const motivo = args.motivo ? String(args.motivo).trim() : undefined;

  const resultado = await pausarCliente(codigo, hasta, motivo, {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function reactivarClienteTool(
  args: Record<string, unknown>,
  ctx?: CtxSupervisor
): Promise<ResultadoTool> {
  if (ctx?.rol !== 'supervisor') return { ok: false, error: 'Solo un supervisor puede reactivar un cliente.' };
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };

  const resultado = await reactivarCliente(codigo, {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return { ok: resultado.ok, data: { mensaje: resultado.mensaje } };
}

async function generarLinkPortalTool(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };

  const resultado = await generarTokenPortal(codigo, {
    userId: ctx?.userId || 'desconocido',
    userEmail: ctx?.userEmail || 'telegram:desconocido',
  });
  return {
    ok: resultado.ok,
    data: { mensaje: resultado.mensaje, url: resultado.url, expiracion: resultado.expiracion },
  };
}

/** Grupo del equipo + el chat propio de quien pregunta — nunca privados ajenos. */
function chatIdsPermitidosParaRecordar(ctx?: { chatId?: number }): number[] {
  const ids = new Set<number>();
  const grupo = Number(process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS);
  if (!Number.isNaN(grupo) && process.env.TELEGRAM_CHAT_ID_GRUPO_COBROS) ids.add(grupo);
  if (ctx?.chatId != null) ids.add(ctx.chatId);
  return Array.from(ids);
}

async function recordarConversacionesTool(
  args: Record<string, unknown>,
  ctx?: { chatId?: number }
): Promise<ResultadoTool> {
  const chatIds = chatIdsPermitidosParaRecordar(ctx);
  if (chatIds.length === 0) return { ok: false, error: 'No se pudo determinar en qué chats buscar.' };

  if (!args.termino && !args.codigo_cliente && !args.desde && !args.hasta) {
    return { ok: false, error: 'Da al menos un término, cliente o rango de fechas para buscar.' };
  }

  const resultados = await buscarHistorial({
    termino: args.termino ? String(args.termino) : undefined,
    codigoCliente: args.codigo_cliente ? normalizarCodigoCliente(String(args.codigo_cliente)) : undefined,
    desde: args.desde ? String(args.desde) : undefined,
    hasta: args.hasta ? String(args.hasta) : undefined,
    chatIds,
    limite: Number(args.limite) || 15,
  });
  return { ok: true, data: { total: resultados.length, resultados } };
}

async function lineaDeTiempoClienteTool(args: Record<string, unknown>): Promise<ResultadoTool> {
  const codigo = normalizarCodigoCliente(String(args.codigo_cliente || '').trim());
  if (!codigo) return { ok: false, error: 'codigo_cliente inválido o ausente.' };

  const eventos = await lineaDeTiempoCliente(codigo, {
    desde: args.desde ? String(args.desde) : undefined,
    hasta: args.hasta ? String(args.hasta) : undefined,
    limite: Number(args.limite) || 30,
  });
  return { ok: true, data: { codigo_cliente: codigo, total: eventos.length, eventos } };
}
