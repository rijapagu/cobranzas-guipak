/**
 * Mocks de las 22 tools del agente de Cobros, para evaluación de LLM.
 *
 * Devuelven datos sintéticos pero estructuralmente fieles a lo que la versión
 * de producción retorna. NO tocan DB, NO tocan Softec. Determinista (mismo input
 * → mismo output) para que el eval sea reproducible.
 *
 * El contrato es: `{ ok: boolean; data?: unknown; error?: string }`,
 * idéntico al de `ejecutarTool` en lib/telegram/tools.ts.
 */

export interface MockResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

let gestionSeq = 1000;
let tareaSeq = 500;

function tieneDigitos(s: string): boolean {
  return /\d/.test(s);
}

function clienteFromTermino(termino: string): { codigo: string; cliente: string } {
  // Si el término tiene formato de código (alfanum largo o solo dígitos) → match único
  if (/^\d{6,7}$/.test(termino)) {
    return { codigo: termino.padStart(7, '0'), cliente: 'CLIENTE_DEMO_01' };
  }
  if (/^[A-Z]{2}\d{4}$/.test(termino.toUpperCase())) {
    return { codigo: termino.toUpperCase(), cliente: 'CLIENTE_DEMO_02' };
  }
  // Texto libre → match único con datos predecibles
  return { codigo: 'CG0001', cliente: termino.toUpperCase().slice(0, 30) };
}

const facturasMock = [
  { ncf: 'B0100000001', numero: 'INV-25-0123', monto: 35000, dias_vencido: 45, fecha: '2026-04-04' },
  { ncf: 'B0100000002', numero: 'INV-25-0145', monto: 22500, dias_vencido: 22, fecha: '2026-04-27' },
  { ncf: 'B0100000003', numero: 'INV-25-0167', monto: 12000, dias_vencido: 8,  fecha: '2026-05-11' },
];

export const TOOL_MOCKS: Record<string, (args: Record<string, unknown>) => MockResult> = {
  buscar_cliente: ({ termino }) => {
    const t = String(termino ?? '');
    if (!t) return { ok: false, error: 'termino vacío' };
    if (tieneDigitos(t)) {
      const c = clienteFromTermino(t);
      return { ok: true, data: { clientes: [c] } };
    }
    // texto libre → ambigüedad simulada (2 matches)
    return {
      ok: true,
      data: {
        clientes: [
          { codigo: 'CG0001', nombre: `${t.toUpperCase()} OFFICE` },
          { codigo: 'CG0042', nombre: `${t.toUpperCase()} COMERCIAL` },
        ],
      },
    };
  },

  consultar_saldo_cliente: ({ termino }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    return {
      ok: true,
      data: {
        codigo: c.codigo,
        cliente: c.cliente,
        saldo_total: 69500,
        saldo_neto: 64500,
        saldo_a_favor: 5000,
        total_facturas: facturasMock.length,
        dias_mora_promedio: 25,
        facturas: facturasMock,
        perfil_riesgo: {
          score: 42,
          nivel: 'AMARILLO',
          tendencia: 'ESTABLE',
          accion_credito: 'REDUCIR_LIMITE',
          accion_ventas: 'SUBIR_MARGEN',
          accion_cobranza: 'SEGUIMIENTO_INTENSIVO',
        },
      },
    };
  },

  estado_cobros_hoy: () => ({
    ok: true,
    data: {
      cartera_total: 2_450_000,
      por_segmento: { VERDE: 850_000, AMARILLO: 620_000, NARANJA: 480_000, ROJO: 500_000 },
      mensajes_pendientes_aprobacion: 4,
      promesas_vencen_hoy: 2,
      alertas: ['2 clientes en CRITICO sin gestión hace >7 días'],
    },
  }),

  listar_pendientes_aprobacion: ({ limite }) => {
    const n = Math.min(Number(limite) || 10, 5);
    const items = Array.from({ length: n }, (_, i) => ({
      id: 800 + i,
      canal: i % 2 === 0 ? 'EMAIL' : 'WHATSAPP',
      cliente: `CLIENTE_DEMO_${String(i + 1).padStart(2, '0')}`,
      monto: 15000 + i * 5000,
      generado_hace_min: 30 + i * 15,
    }));
    return { ok: true, data: { total: items.length, items } };
  },

  listar_promesas_vencidas: ({ limite }) => {
    const n = Math.min(Number(limite) || 10, 3);
    const items = Array.from({ length: n }, (_, i) => ({
      id: 200 + i,
      cliente: `CLIENTE_DEMO_${String(i + 1).padStart(2, '0')}`,
      monto_prometido: 25000 + i * 10000,
      fecha_promesa: `2026-05-${10 + i}`,
      dias_retraso: 5 + i * 3,
    }));
    return { ok: true, data: { total: items.length, items } };
  },

  historial_conversaciones_cliente: ({ codigo_cliente, limite }) => {
    const n = Math.min(Number(limite) || 10, 3);
    const items = Array.from({ length: n }, (_, i) => ({
      fecha: `2026-05-${15 - i}`,
      canal: i % 2 === 0 ? 'EMAIL' : 'WHATSAPP',
      direccion: i % 2 === 0 ? 'SALIENTE' : 'ENTRANTE',
      resumen: i === 0 ? 'Cliente prometió pagar el viernes' : 'Recordatorio enviado',
    }));
    return { ok: true, data: { codigo_cliente, items } };
  },

  crear_tarea: (args) => {
    tareaSeq++;
    return {
      ok: true,
      data: {
        tarea_id: tareaSeq,
        titulo: args.titulo,
        fecha_vencimiento: args.fecha_vencimiento,
        tipo: args.tipo ?? 'OTRO',
      },
    };
  },

  listar_tareas: ({ rango }) => ({
    ok: true,
    data: {
      rango: rango ?? 'hoy',
      items: [
        { id: 480, titulo: 'Llamar a CLIENTE_DEMO_01', fecha: '2026-05-19', tipo: 'LLAMAR', prioridad: 'ALTA' },
        { id: 481, titulo: 'Depositar cheque CLIENTE_DEMO_02', fecha: '2026-05-19', tipo: 'DEPOSITAR_CHEQUE', prioridad: 'MEDIA' },
      ],
    },
  }),

  marcar_tarea_hecha: ({ tarea_id }) => ({
    ok: true,
    data: { tarea_id, status: 'HECHA' },
  }),

  proponer_correo_cliente: ({ termino, email_destino, plantilla_id }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    gestionSeq++;
    return {
      ok: true,
      data: {
        ok: true,
        gestion_id: gestionSeq,
        codigo: c.codigo,
        cliente: c.cliente,
        saldo_neto: 64500,
        dias_vencida_max: 45,
        destinatario_email: email_destino ?? `cobros_${c.codigo.toLowerCase()}@example.com`,
        asunto: `Recordatorio de pago — Facturas pendientes por RD$64,500`,
        plantilla_id: plantilla_id ?? 4,
        plantilla_nombre: 'Cobranza formal (NARANJA)',
        preview: 'Estimado cliente, le contactamos para recordarle...',
      },
    };
  },

  listar_plantillas: () => ({
    ok: true,
    data: {
      total: 6,
      plantillas: [
        { id: 1, nombre: 'Recordatorio suave', segmento: 'VERDE',    tono: 'AMABLE' },
        { id: 2, nombre: 'Recordatorio',        segmento: 'AMARILLO', tono: 'CORDIAL' },
        { id: 4, nombre: 'Cobranza formal',     segmento: 'NARANJA',  tono: 'FIRME' },
        { id: 5, nombre: 'Cobranza urgente',    segmento: 'ROJO',     tono: 'URGENTE' },
        { id: 7, nombre: 'Estado de cuenta',    segmento: 'TODOS',    tono: 'INFORMATIVO' },
        { id: 9, nombre: 'Pre-legal',           segmento: 'ROJO',     tono: 'LEGAL' },
      ],
    },
  }),

  obtener_contactos_cliente: ({ termino }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    // Para variar escenarios: si el código termina en par, devolver 1 email; si impar, 2.
    const ultimoDigito = parseInt(c.codigo.slice(-1), 10);
    const emails = ultimoDigito % 2 === 0
      ? [{ email: `cobros_${c.codigo.toLowerCase()}@example.com`, fuente: 'BD propia' }]
      : [
          { email: `cobros_${c.codigo.toLowerCase()}@example.com`, fuente: 'BD propia' },
          { email: `pagos_${c.codigo.toLowerCase()}@example.com`, fuente: 'Softec CxP' },
        ];
    return {
      ok: true,
      data: {
        codigo: c.codigo,
        cliente: c.cliente,
        emails,
        telefonos: [{ telefono: '+18095551234', fuente: 'BD propia', whatsapp: true }],
      },
    };
  },

  guardar_dato_cliente: ({ codigo_cliente, campo, valor }) => ({
    ok: true,
    data: { codigo_cliente, campo, valor, status: 'GUARDADO' },
  }),

  listar_clientes_sin_datos: ({ faltante, limite }) => {
    const n = Math.min(Number(limite) || 15, 4);
    const items = Array.from({ length: n }, (_, i) => ({
      codigo: `CG${String(100 + i).padStart(4, '0')}`,
      cliente: `CLIENTE_DEMO_${String(i + 1).padStart(2, '0')}`,
      saldo_neto: 100000 - i * 15000,
      sin_email: i % 2 === 0,
      sin_whatsapp: i % 3 === 0,
    }));
    return { ok: true, data: { faltante: faltante ?? 'cualquiera', items } };
  },

  estado_cadencias: () => ({
    ok: true,
    data: {
      facturas_con_cadencia_activa: 145,
      gestiones_generadas_ultimo_run: 23,
      facturas_listas_para_hoy: 8,
      ultimo_run: '2026-05-19 06:00:00',
      cadencias_configuradas: 4,
    },
  }),

  proponer_whatsapp_cliente: ({ termino }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    gestionSeq++;
    return {
      ok: true,
      data: {
        ok: true,
        gestion_id: gestionSeq,
        codigo: c.codigo,
        cliente: c.cliente,
        destinatario_telefono: '+18095551234',
        tiene_pdf: true,
        preview: 'Hola, recordatorio de factura pendiente RD$64,500...',
      },
    };
  },

  estado_conciliacion: () => ({
    ok: true,
    data: {
      transacciones_conciliadas: 142,
      transacciones_desconocidas: 7,
      cheques_devueltos_pendientes: 2,
      tareas_conciliacion_abiertas: 9,
      ultimo_run: '2026-05-19 08:30:00',
    },
  }),

  consultar_memoria_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      codigo_cliente,
      patron_pago: 'Suele pagar quincenalmente, primera y tercera semana del mes',
      canal_efectivo: 'WHATSAPP',
      contacto_real: 'María en contabilidad',
      mejor_momento: 'martes y miércoles después de 10am',
      notas_daria: null,
    },
  }),

  guardar_memoria_cliente: (args) => ({
    ok: true,
    data: { codigo_cliente: args.codigo_cliente, actualizado: true },
  }),

  guardar_memoria_equipo: ({ clave, valor }) => ({
    ok: true,
    data: { clave, valor, status: 'GUARDADO' },
  }),

  obtener_perfil_riesgo_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      codigo_cliente,
      score: 58,
      nivel: 'ROJO',
      tendencia: 'EMPEORANDO',
      score_anterior: 42,
      saldo_neto: 64500,
      tasa_cumplimiento_promesas: 0.40,
      accion_credito: 'AUTORIZAR_MANUAL',
      accion_ventas: 'REQUIERE_ABONO',
      accion_cobranza: 'GESTION_DIRECTA',
      razones: [
        'Mora promedio > 30 días',
        'Score subió +16 puntos vs cálculo anterior',
        'Solo cumplió 2 de 5 promesas en últimos 90 días',
      ],
      resumen: 'Cliente con riesgo creciente. Mora promedio 35 días, cumplimiento de promesas bajo (40%). Requiere gestión directa.',
    },
  }),

  analizar_riesgo_cartera: ({ limite_criticos }) => ({
    ok: true,
    data: {
      total_clientes: 271,
      por_nivel: { VERDE: 178, AMARILLO: 52, ROJO: 33, CRITICO: 8 },
      criticos: Array.from({ length: Math.min(Number(limite_criticos) || 5, 3) }, (_, i) => ({
        codigo: `CG${String(900 + i).padStart(4, '0')}`,
        cliente: `CLIENTE_DEMO_CRIT_${i + 1}`,
        score: 82 - i,
        saldo_neto: 150000 - i * 20000,
      })),
      empeorando_top: [
        { codigo: 'CG0099', cliente: 'CLIENTE_DEMO_03', delta_score: 22 },
      ],
    },
  }),
};

export function mockTool(name: string, args: Record<string, unknown>): MockResult {
  const fn = TOOL_MOCKS[name];
  if (!fn) {
    return { ok: false, error: `Tool desconocida (mock): ${name}` };
  }
  try {
    return fn(args);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
