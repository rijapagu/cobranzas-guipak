import Anthropic from '@anthropic-ai/sdk';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import {
  obtenerSaldoAFavorPorCliente,
  ajustarSaldoCliente,
} from '@/lib/cobranzas/saldo-favor';
import { obtenerContactos, resolverEmailPropio, resolverWhatsAppPropio } from '@/lib/cobranzas/contactos';
import { proponerCorreoCliente } from './draft-correo';
import { proponerWhatsAppCliente } from './draft-whatsapp';
import { guardarMemoriaEquipo } from './historial';
import { listarPlantillasActivas } from '@/lib/templates/seleccionar';

/**
 * Definición de herramientas que Claude puede invocar desde el bot de Telegram.
 * Patrón inspirado en Agente Inventario (bot.py + tools.py).
 */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'consultar_saldo_cliente',
    description:
      'Cuándo usar: cuando el usuario pregunte "cuánto debe X", "saldo de X", "aging de X", "facturas de X", o variantes — siempre con un cliente identificable.\n' +
      'Qué hace: devuelve el aging detallado del cliente (facturas vencidas con días-vencido, saldo total y por tramo, segmento).\n' +
      'Devuelve: { codigo_cliente, nombre, saldo_total, segmento, facturas: [{numero, fecha, vencimiento, saldo, dias_vencido}] }. Si no se encuentra: error con motivo.\n' +
      'Pre-condiciones: ninguna. Acepta código exacto o nombre parcial.\n' +
      'NO usar si: el usuario pidió redactar un correo/whatsapp (eso es proponer_correo_cobranza_cliente). Tampoco para datos de contacto del cliente (eso es consultar_contactos_cliente).',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente (ej. "0000274") o parte del nombre',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'resumen_estado_cobros_hoy',
    description:
      'Cuándo usar: el usuario pregunta "cómo vamos", "estado del día", "dashboard", "qué hay hoy", "resumen de cobros" — sin mencionar a un cliente específico.\n' +
      'Qué hace: resumen ad-hoc del estado actual de cobros (cartera total, distribución por segmento, alertas activas, mensajes pendientes de aprobación, promesas que vencen hoy).\n' +
      'Devuelve: { cartera_total, segmentos: {...}, alertas: [...], pendientes_aprobacion: N, promesas_hoy: N, observaciones }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario pregunta por un cliente específico (eso va al contexto consulta_cliente).',
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
      'NO usar si: el usuario ya dio un código de cliente válido (formato "0000274") — en ese caso ir directo a consultar_saldo_cliente u otra tool específica.',
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
    name: 'proponer_correo_cliente',
    description:
      'Genera un draft de correo de cobranza para un cliente y lo deja en cola PENDIENTE de aprobación. NO envía el correo. Devuelve el ID de gestión, el draft completo y los datos del cliente. El bot debe presentar este draft al usuario con botones para aprobar/editar/descartar (CP-02). Si el usuario especificó un email destino explícito (ej. "envía el correo a cuentas@empresa.com"), pásalo en email_destino. Si devuelve destinatario_email=null y no se especificó email_destino, el cliente no tiene email — pedir el email al usuario y luego llamar a guardar_dato_cliente antes de presentar los botones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente (ej. "0000274") o nombre parcial',
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
    name: 'listar_plantillas',
    description:
      'Devuelve todas las plantillas de correo activas con su ID, nombre, descripción, segmento, categoría y tono. Úsala cuando el usuario quiera ver las plantillas disponibles o cuando necesites buscar el ID de una plantilla por nombre.',
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
    name: 'guardar_dato_cliente',
    description:
      'Guarda o actualiza un dato de contacto faltante de un cliente en la base de datos propia (CP-01: NUNCA modifica Softec). Úsalo cuando el usuario proporcione un email, WhatsApp o nombre de contacto para un cliente que lo tenga en blanco. Confirma siempre con el usuario antes de guardar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código del cliente en Softec (7 dígitos, ej. "0000593")',
        },
        campo: {
          type: 'string',
          enum: ['email', 'whatsapp', 'contacto_cobros'],
          description: 'Qué dato se va a guardar',
        },
        valor: {
          type: 'string',
          description: 'El valor a guardar (email, número de WhatsApp con código de país, o nombre del contacto)',
        },
      },
      required: ['codigo_cliente', 'campo', 'valor'],
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
    name: 'proponer_whatsapp_cliente',
    description:
      'Genera un draft de mensaje WhatsApp de cobranza para un cliente y lo deja en cola PENDIENTE de aprobación. NO envía el mensaje. Si hay factura en Drive, incluye el link. Si devuelve destinatario_telefono=null, el cliente no tiene WhatsApp registrado — pide el número y llama a guardar_dato_cliente con campo="whatsapp".',
    input_schema: {
      type: 'object' as const,
      properties: {
        termino: {
          type: 'string',
          description: 'Código de cliente (ej. "0000274") o nombre parcial',
        },
      },
      required: ['termino'],
    },
  },
  {
    name: 'resumen_conciliacion_bancaria',
    description:
      'Cuándo usar: el usuario pregunta "cómo va la conciliación", "depósitos sin identificar", "cheques devueltos", "qué hay pendiente del banco".\n' +
      'Qué hace: resumen del estado de la conciliación bancaria (transacciones conciliadas, desconocidas, cheques devueltos, tareas de seguimiento pendientes).\n' +
      'Devuelve: { conciliadas, desconocidas, cheques_devueltos: N, tareas_seguimiento: N, ultimo_corte }.\n' +
      'Pre-condiciones: ninguna.\n' +
      'NO usar si: el usuario quiere CARGAR un nuevo estado bancario o ASIGNAR una transacción a un cliente — esas operaciones tienen endpoints propios, no van por el agente.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'consultar_memoria_cliente',
    description:
      'Consulta la memoria estructurada del asistente sobre un cliente: patrón de pago, canal efectivo, contacto real, mejor momento de contacto, notas del equipo. Úsala antes de proponer un correo o WhatsApp para personalizar la gestión.',
    input_schema: {
      type: 'object' as const,
      properties: {
        codigo_cliente: {
          type: 'string',
          description: 'Código del cliente (7 dígitos, ej. "0000274")',
        },
      },
      required: ['codigo_cliente'],
    },
  },
  {
    name: 'guardar_memoria_cliente',
    description:
      'Guarda o actualiza la memoria del asistente sobre un cliente: patrón de pago, canal que ha funcionado mejor, nombre del contacto real, mejor momento para llamar, notas libres. Solo actualiza los campos que se proporcionan.',
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
        canal_efectivo: {
          type: 'string',
          enum: ['EMAIL', 'WHATSAPP', 'LLAMADA', 'OTRO'],
          description: 'Canal que ha respondido mejor',
        },
        contacto_real: {
          type: 'string',
          description: 'Nombre real del contacto de cobros (puede diferir del registrado en Softec)',
        },
        mejor_momento: {
          type: 'string',
          description: 'Cuándo es mejor contactar (ej. "lunes por la mañana", "después de las 3pm")',
        },
        notas_daria: {
          type: 'string',
          description: 'Notas libres del equipo de cobros sobre este cliente',
        },
      },
      required: ['codigo_cliente'],
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
          description: 'Código del cliente en Softec (7 dígitos, ej. "0000274")',
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
    name: 'guardar_memoria_equipo',
    description:
      'Guarda un dato permanente sobre el equipo, sus preferencias o el contexto del negocio. Úsalo cuando el usuario comparta algo que debas recordar en futuras conversaciones: cómo prefiere trabajar, quién maneja qué clientes, acuerdos internos, contexto de la empresa.',
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
      },
      required: ['clave', 'valor'],
    },
  },
];

interface ResultadoTool {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function ejecutarTool(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string; telegramUserId?: number }
): Promise<ResultadoTool> {
  try {
    switch (nombre) {
      case 'consultar_saldo_cliente':
        return await consultarSaldoCliente(String(argumentos.termino));

      case 'estado_cobros_hoy': // alias deprecado, retirar tras 1 release
      case 'resumen_estado_cobros_hoy':
        return await estadoCobrosHoy();

      case 'listar_pendientes_aprobacion': // alias deprecado, retirar tras 1 release
      case 'listar_mensajes_pendientes_aprobacion':
        return await listarPendientesAprobacion(Number(argumentos.limite) || 10);

      case 'listar_promesas_vencidas': // alias deprecado, retirar tras 1 release
      case 'listar_promesas_pago_incumplidas':
        return await listarPromesasVencidas(Number(argumentos.limite) || 10);

      case 'historial_conversaciones_cliente': // alias deprecado, retirar tras 1 release
      case 'consultar_historial_conversaciones':
        return await historialConversacionesCliente(
          String(argumentos.codigo_cliente),
          Number(argumentos.limite) || 10
        );

      case 'buscar_cliente':
        return await buscarCliente(String(argumentos.termino));

      case 'crear_tarea': // alias deprecado, retirar tras 1 release
      case 'crear_tarea_recordatorio':
        return await crearTarea(argumentos, ctx);

      case 'listar_tareas': // alias deprecado, retirar tras 1 release
      case 'listar_tareas_pendientes':
        return await listarTareas(argumentos);

      case 'marcar_tarea_hecha': // alias deprecado, retirar tras 1 release
      case 'marcar_tarea_completada':
        return await marcarTareaHecha(argumentos, ctx);

      case 'proponer_correo_cliente': {
        const emailDestino = argumentos.email_destino ? String(argumentos.email_destino).trim() : undefined;
        const plantillaId = argumentos.plantilla_id ? Number(argumentos.plantilla_id) : undefined;
        const result = await proponerCorreoCliente(String(argumentos.termino), emailDestino, plantillaId);
        return { ok: result.ok, data: result };
      }

      case 'listar_plantillas': {
        const plantillas = await listarPlantillasActivas();
        return { ok: true, data: { total: plantillas.length, plantillas } };
      }

      case 'obtener_contactos_cliente': // alias deprecado, retirar tras 1 release
      case 'consultar_contactos_cliente':
        return await obtenerContactosCliente(String(argumentos.termino));

      case 'guardar_dato_cliente':
        return await guardarDatoCliente(
          String(argumentos.codigo_cliente),
          String(argumentos.campo) as 'email' | 'whatsapp' | 'contacto_cobros',
          String(argumentos.valor),
          ctx
        );

      case 'listar_clientes_sin_datos': // alias deprecado, retirar tras 1 release
      case 'listar_clientes_con_datos_faltantes':
        return await listarClientesSinDatos(
          String(argumentos.faltante || 'cualquiera') as 'email' | 'whatsapp' | 'cualquiera',
          Number(argumentos.limite) || 15
        );

      case 'estado_cadencias': // alias deprecado, retirar tras 1 release
      case 'resumen_cadencias_automaticas':
        return await estadoCadencias();

      case 'estado_conciliacion': // alias deprecado, retirar tras 1 release
      case 'resumen_conciliacion_bancaria':
        return await estadoConciliacion();

      case 'proponer_whatsapp_cliente': {
        const result = await proponerWhatsAppCliente(String(argumentos.termino));
        return { ok: result.ok, data: result };
      }

      case 'consultar_memoria_cliente':
        return await consultarMemoriaCliente(String(argumentos.codigo_cliente));

      case 'guardar_memoria_cliente':
        return await guardarMemoriaCliente(argumentos, ctx);

      case 'guardar_memoria_equipo':
        return await guardarMemoriaEquipoTool(argumentos, ctx);

      case 'obtener_perfil_riesgo_cliente': // alias deprecado, retirar tras 1 release
      case 'consultar_perfil_riesgo_cliente':
        return await obtenerPerfilRiesgoCliente(String(argumentos.codigo_cliente));

      case 'analizar_riesgo_cartera': // alias deprecado, retirar tras 1 release
      case 'resumen_riesgo_cartera':
        return await analizarRiesgoCartera(Number(argumentos.limite_criticos) || 5);

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

async function consultarSaldoCliente(termino: string): Promise<ResultadoTool> {
  const softecOk = await testSoftecConnection();
  if (!softecOk) return { ok: false, error: 'No hay conexión a Softec' };

  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo
    ? 'c.IC_CODE = ?'
    : '(c.IC_NAME LIKE ? OR c.IC_CODE = ?)';
  const params = esCodigo
    ? [termino.trim().padStart(7, '0')]
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
    'SELECT risk_score, risk_level, tendencia, accion_credito, accion_ventas, accion_cobranza, resumen FROM cobranza_cliente_inteligencia WHERE codigo_cliente = ?',
    [codigo]
  );
  const perfil = perfilRows[0] ?? null;

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
      facturas: facturas.map((f) => ({
        factura: f.factura,
        fecha_vence: new Date(f.fecha_vence).toISOString().split('T')[0],
        dias_vencida: Number(f.dias_vencida),
        saldo: Number(f.saldo),
      })),
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
  }

  const pendientes = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE estado='PENDIENTE'"
  );
  const promesasHoy = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida = CURDATE()"
  );
  const promesasVencidas = await cobranzasQuery<{ total: number }>(
    "SELECT COUNT(*) AS total FROM cobranza_acuerdos WHERE estado='PENDIENTE' AND fecha_prometida < CURDATE()"
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
      por_segmento: segmentos,
      mensajes_pendientes_aprobacion: Number(pendientes[0]?.total) || 0,
      promesas_vencen_hoy: Number(promesasHoy[0]?.total) || 0,
      promesas_vencidas: Number(promesasVencidas[0]?.total) || 0,
    },
  };
}

async function listarPendientesAprobacion(limite: number): Promise<ResultadoTool> {
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
     WHERE estado='PENDIENTE'
     ORDER BY created_at ASC
     LIMIT ?`,
    [limite]
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
  const rows = await cobranzasQuery<{
    id: number;
    codigo_cliente: string;
    ij_inum: number;
    monto_prometido: number;
    fecha_prometida: string;
  }>(
    `SELECT id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida
     FROM cobranza_acuerdos
     WHERE estado='PENDIENTE' AND fecha_prometida < CURDATE()
     ORDER BY fecha_prometida ASC
     LIMIT ?`,
    [limite]
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
  const rows = await cobranzasQuery<{
    canal: string;
    direccion: string;
    contenido: string;
    created_at: string;
  }>(
    `SELECT canal, direccion, contenido, created_at
     FROM cobranza_conversaciones
     WHERE codigo_cliente = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [codigoCliente.padStart(7, '0'), limite]
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

  const esCodigo = /^\d+$/.test(termino.trim());
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
    [`%${termino}%`, esCodigo ? termino.padStart(7, '0') : termino.trim()]
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

  const codigoCliente = args.codigo_cliente ? String(args.codigo_cliente).padStart(7, '0') : null;
  const descripcion = args.descripcion ? String(args.descripcion) : null;
  const creadoPor = ctx?.userEmail || `telegram:${ctx?.userId || 'unknown'}`;

  const result = await cobranzasExecute(
    `INSERT INTO cobranza_tareas
     (titulo, descripcion, tipo, fecha_vencimiento, hora, codigo_cliente,
      prioridad, asignada_a, creado_por, origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')`,
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
  const codigoCliente = args.codigo_cliente ? String(args.codigo_cliente).padStart(7, '0') : null;

  let where = "estado IN ('PENDIENTE','EN_PROGRESO')";
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

  const esCodigo = /^\d+$/.test(termino.trim());
  const filtro = esCodigo ? 'IC_CODE = ?' : 'IC_NAME LIKE ?';
  const param = esCodigo ? termino.trim().padStart(7, '0') : `%${termino.trim()}%`;

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
  const contactosEmail = await obtenerContactos(cod, 'EMAIL');
  const emailPropio = await resolverEmailPropio(cod);

  // Teléfonos de nuestra BD
  const contactosWa = await obtenerContactos(cod, 'WHATSAPP');
  const waPropio = await resolverWhatsAppPropio(cod);

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
  const codigo = codigoCliente.trim().padStart(7, '0');
  const valorTrimmed = valor.trim();
  if (!valorTrimmed) return { ok: false, error: 'Valor vacío' };

  const camposPermitidos = ['email', 'whatsapp', 'contacto_cobros'];
  if (!camposPermitidos.includes(campo)) {
    return { ok: false, error: `Campo inválido: ${campo}` };
  }

  const existente = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ? LIMIT 1',
    [codigo]
  );

  if (existente.length > 0) {
    await cobranzasExecute(
      `UPDATE cobranza_clientes_enriquecidos SET \`${campo}\` = ?, actualizado_por = ? WHERE codigo_cliente = ?`,
      [valorTrimmed, ctx?.userEmail || `telegram:${ctx?.userId}`, codigo]
    );
  } else {
    await cobranzasExecute(
      `INSERT INTO cobranza_clientes_enriquecidos (codigo_cliente, \`${campo}\`, canal_preferido, actualizado_por)
       VALUES (?, ?, 'EMAIL', ?)`,
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
     WHERE codigo_cliente IN (${codigos.map(() => '?').join(',')})`,
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
    'SELECT segmento, dia_desde_vencimiento, accion, requiere_aprobacion FROM cobranza_cadencias WHERE activa=1 ORDER BY dia_desde_vencimiento ASC'
  );

  // Último run
  const ultimoRun = await cobranzasQuery<{ detalle: string; created_at: string }>(
    "SELECT detalle, created_at FROM cobranza_logs WHERE accion='CADENCIAS_HORARIAS' ORDER BY created_at DESC LIMIT 1"
  );

  // Facturas con estado de cadencia registrado
  const conEstado = await cobranzasQuery<{ total: number }>(
    'SELECT COUNT(*) AS total FROM cobranza_factura_cadencia_estado'
  );

  // Facturas pausadas individualmente
  const pausadas = await cobranzasQuery<{ total: number }>(
    'SELECT COUNT(*) AS total FROM cobranza_factura_cadencia_estado WHERE pausada_hasta > NOW()'
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
    "SELECT COUNT(*) AS total FROM cobranza_gestiones WHERE creado_por='cadencias' AND created_at >= NOW() - INTERVAL 24 HOUR"
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
  const codigo = codigoCliente.trim().padStart(7, '0');
  const rows = await cobranzasQuery<{
    patron_pago: string | null;
    canal_efectivo: string | null;
    contacto_real: string | null;
    mejor_momento: string | null;
    notas_daria: string | null;
    ultima_actualizacion: string;
  }>(
    'SELECT patron_pago, canal_efectivo, contacto_real, mejor_momento, notas_daria, ultima_actualizacion FROM cobranza_memoria_cliente WHERE codigo_cliente = ?',
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
  const codigo = String(args.codigo_cliente || '').trim().padStart(7, '0');
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
    'SELECT id FROM cobranza_memoria_cliente WHERE codigo_cliente = ?',
    [codigo]
  );

  if (existente.length > 0) {
    const sets = Object.keys(campos).map((k) => `\`${k}\` = ?`).join(', ');
    await cobranzasExecute(
      `UPDATE cobranza_memoria_cliente SET ${sets} WHERE codigo_cliente = ?`,
      [...Object.values(campos), codigo]
    );
  } else {
    const colsExtra = Object.keys(campos).map((k) => `\`${k}\``).join(', ');
    const vals = Object.values(campos);
    await cobranzasExecute(
      `INSERT INTO cobranza_memoria_cliente (codigo_cliente, ${colsExtra}) VALUES (?, ${vals.map(() => '?').join(', ')})`,
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
  ctx?: { userId?: string; userEmail?: string; telegramUserId?: number }
): Promise<ResultadoTool> {
  const clave = String(args.clave || '').trim();
  const valor = String(args.valor || '').trim();
  if (!clave || clave.length < 2) return { ok: false, error: 'clave inválida' };
  if (!valor || valor.length < 2) return { ok: false, error: 'valor inválido' };

  const telegramUserId = ctx?.telegramUserId ?? 0;
  await guardarMemoriaEquipo(telegramUserId, clave, valor);
  await logAccion(ctx?.userId || null, 'MEMORIA_EQUIPO_GUARDADA', 'telegram', clave, {
    valor,
    telegram_user_id: telegramUserId,
    via: 'telegram',
  });
  return { ok: true, data: { clave, valor } };
}

async function marcarTareaHecha(
  args: Record<string, unknown>,
  ctx?: { userId?: string; userEmail?: string }
): Promise<ResultadoTool> {
  const id = Number(args.tarea_id);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'tarea_id inválido' };

  const existentes = await cobranzasQuery<{ id: number; titulo: string; estado: string }>(
    'SELECT id, titulo, estado FROM cobranza_tareas WHERE id = ?',
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
  const codigo = codigoCliente.trim().padStart(7, '0');

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
     WHERE codigo_cliente = ?`,
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
  // Distribución por nivel
  const distribucion = await cobranzasQuery<{
    risk_level: string;
    cantidad: number;
    saldo_neto_total: number;
  }>(
    `SELECT risk_level, COUNT(*) AS cantidad, SUM(saldo_neto) AS saldo_neto_total
     FROM cobranza_cliente_inteligencia
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
     WHERE risk_level IN ('CRITICO','ROJO')
     ORDER BY risk_score DESC, saldo_neto DESC
     LIMIT ?`,
    [limiteCriticos]
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
     WHERE tendencia = 'EMPEORANDO'
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
     WHERE accion_ventas IN ('NO_VENDER','REQUIERE_ABONO')
     ORDER BY FIELD(accion_ventas,'NO_VENDER','REQUIERE_ABONO'), risk_score DESC
     LIMIT 15`
  );

  // Total de clientes en tabla
  const totalRows = await cobranzasQuery<{ total: number; calculado_at: string }>(
    `SELECT COUNT(*) AS total, MAX(calculado_at) AS calculado_at FROM cobranza_cliente_inteligencia`
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

async function estadoConciliacion(): Promise<ResultadoTool> {
  const stats = await cobranzasQuery<{ estado: string; total: number; cantidad: number }>(
    `SELECT estado, SUM(monto) as total, COUNT(*) as cantidad
     FROM cobranza_conciliacion GROUP BY estado`
  );

  const tareas = await cobranzasQuery<{
    tipo: string; estado: string; titulo: string; id: number;
    created_at: string;
  }>(
    `SELECT id, tipo, estado, titulo, created_at
     FROM cobranza_tareas
     WHERE origen = 'CONCILIACION' AND estado IN ('PENDIENTE', 'EN_PROGRESO')
     ORDER BY created_at DESC LIMIT 20`
  );

  const ultimaCarga = await cobranzasQuery<{ archivo_origen: string; fecha_extracto: string; total: number }>(
    `SELECT archivo_origen, fecha_extracto, COUNT(*) as total
     FROM cobranza_conciliacion
     GROUP BY archivo_origen, fecha_extracto
     ORDER BY fecha_extracto DESC LIMIT 3`
  );

  return {
    ok: true,
    data: {
      resumen_por_estado: stats.map(s => ({
        estado: s.estado,
        cantidad: Number(s.cantidad),
        monto_total: Number(s.total),
      })),
      tareas_seguimiento_pendientes: tareas.map(t => ({
        id: t.id,
        tipo: t.tipo,
        titulo: t.titulo,
        dias_abierta: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000),
      })),
      ultimas_cargas: ultimaCarga,
    },
  };
}
