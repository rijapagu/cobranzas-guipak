/**
 * Mocks de las tools del agente de Cobros, para evaluación de LLM.
 *
 * Devuelven datos sintéticos pero estructuralmente fieles a lo que la versión
 * de producción retorna (mismo shape de `data` que `ejecutarTool` en
 * lib/telegram/tools.ts). NO tocan DB, NO tocan Softec, NO tocan Telegram.
 * Determinista (mismo input → mismo output) para que el eval sea reproducible.
 *
 * Nombres de tool (2026-09-03): reescrito completo -- la versión anterior
 * tenía los 22 nombres PRE-Fase-0 (estado_cobros_hoy, listar_pendientes_aprobacion,
 * crear_tarea, etc.), ninguno de los cuales existe ya en tools.ts. Con esos
 * nombres viejos, CUALQUIER tool call real durante un eval caía en el fallback
 * "Tool desconocida (mock)" -- el eval runner llevaba meses corriendo sin
 * poder mockear ni una sola tool. scripts/test-prompt-tools.ts (offline) NO
 * lo detecta porque solo valida tools.ts contra el prompt, no contra este
 * archivo -- por eso hace falta este comentario y no basta con el test.
 *
 * El contrato es: `{ ok: boolean; data?: unknown; error?: string }`.
 */

export interface MockResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

let gestionSeq = 1000;
let tareaSeq = 500;
let disputaSeq = 50;

function tieneDigitos(s: string): boolean {
  return /\d/.test(s);
}

function clienteFromTermino(termino: string): { codigo: string; cliente: string } {
  if (/^\d{6,7}$/.test(termino)) {
    return { codigo: termino.padStart(7, '0'), cliente: 'CLIENTE_DEMO_01' };
  }
  if (/^[A-Z]{2}\d{4}$/.test(termino.toUpperCase())) {
    return { codigo: termino.toUpperCase(), cliente: 'CLIENTE_DEMO_02' };
  }
  return { codigo: 'CG0001', cliente: termino.toUpperCase().slice(0, 30) };
}

const facturasMock = [
  { numero: 'INV-25-0123', ncf_fiscal: 'B0100000001', total_factura: 35000, saldo_pendiente: 35000, dias_vencido: 45, fecha_vencimiento: '2026-04-04' },
  { numero: 'INV-25-0145', ncf_fiscal: 'B0100000002', total_factura: 22500, saldo_pendiente: 22500, dias_vencido: 22, fecha_vencimiento: '2026-04-27' },
  { numero: 'INV-25-0167', ncf_fiscal: 'B0100000003', total_factura: 12000, saldo_pendiente: 12000, dias_vencido: 8, fecha_vencimiento: '2026-05-11' },
];

function obtenerContactosClienteMock({ termino }: Record<string, unknown>): MockResult {
  const c = clienteFromTermino(String(termino ?? ''));
  return {
    ok: true,
    data: {
      codigo: c.codigo,
      nombre: c.cliente,
      emails: [{ valor: `cobros_${c.codigo.toLowerCase()}@example.com`, fuente: 'BD propia', es_principal: true }],
      telefonos: [{ valor: '+18095551234', fuente: 'BD propia' }],
    },
  };
}

export const TOOL_MOCKS: Record<string, (args: Record<string, unknown>) => MockResult> = {
  buscar_cliente: ({ termino }) => {
    const t = String(termino ?? '');
    if (!t) return { ok: false, error: 'termino vacío' };
    if (tieneDigitos(t)) {
      const c = clienteFromTermino(t);
      return { ok: true, data: { clientes: [c] } };
    }
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

  resumen_estado_cobros_hoy: () => ({
    ok: true,
    data: {
      cartera_total: 2_450_000,
      por_segmento: { VERDE: 850_000, AMARILLO: 620_000, NARANJA: 480_000, ROJO: 500_000 },
      mensajes_pendientes_aprobacion: 4,
      promesas_vencen_hoy: 2,
      dso: 38,
      modo_mock: false,
      alertas: ['2 clientes en CRITICO sin gestión hace >7 días'],
    },
  }),

  listar_mensajes_pendientes_aprobacion: ({ limite }) => {
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

  aprobar_gestion: ({ gestion_id }) => ({
    ok: true,
    data: { mensaje: `Gestión ${gestion_id} aprobada. Enviado a CLIENTE_DEMO_01.` },
  }),

  descartar_gestion: ({ gestion_id }) => ({
    ok: true,
    data: { mensaje: `Gestión ${gestion_id} descartada.` },
  }),

  escalar_gestion: ({ gestion_id }) => ({
    ok: true,
    data: { mensaje: `Gestión ${gestion_id} escalada para seguimiento manual.` },
  }),

  editar_gestion: ({ gestion_id }) => ({
    ok: true,
    data: { mensaje: `Gestión ${gestion_id} actualizada. Sigue PENDIENTE — apruébala cuando quieras enviarla.` },
  }),

  listar_promesas_pago_incumplidas: ({ limite }) => {
    const n = Math.min(Number(limite) || 10, 3);
    const promesas = Array.from({ length: n }, (_, i) => ({
      id: 200 + i,
      codigo_cliente: `CG${String(100 + i).padStart(4, '0')}`,
      factura: 90000 + i,
      monto: 25000 + i * 10000,
      fecha_prometida: `2026-05-${10 + i}`,
    }));
    return { ok: true, data: { total: promesas.length, promesas } };
  },

  consultar_historial_conversaciones: ({ codigo_cliente, limite }) => {
    const n = Math.min(Number(limite) || 10, 3);
    const items = Array.from({ length: n }, (_, i) => ({
      fecha: `2026-05-${15 - i}`,
      canal: i % 2 === 0 ? 'EMAIL' : 'WHATSAPP',
      direccion: i % 2 === 0 ? 'SALIENTE' : 'ENTRANTE',
      resumen: i === 0 ? 'Cliente prometió pagar el viernes' : 'Recordatorio enviado',
    }));
    return { ok: true, data: { codigo_cliente, items } };
  },

  crear_tarea_recordatorio: (args) => {
    tareaSeq++;
    return {
      ok: true,
      data: {
        id: tareaSeq,
        titulo: args.titulo,
        fecha_vencimiento: args.fecha_vencimiento,
        tipo: args.tipo ?? 'OTRO',
        prioridad: args.prioridad ?? 'MEDIA',
        codigo_cliente: args.codigo_cliente ?? null,
      },
    };
  },

  listar_tareas_pendientes: ({ rango }) => ({
    ok: true,
    data: {
      rango: rango ?? 'hoy',
      total: 2,
      tareas: [
        { id: 480, titulo: 'Llamar a CLIENTE_DEMO_01', tipo: 'LLAMAR', fecha: '2026-05-19', hora: null, codigo_cliente: 'CG0001', prioridad: 'ALTA', estado: 'PENDIENTE', asignada_a: null },
        { id: 481, titulo: 'Depositar cheque CLIENTE_DEMO_02', tipo: 'DEPOSITAR_CHEQUE', fecha: '2026-05-19', hora: null, codigo_cliente: 'CG0042', prioridad: 'MEDIA', estado: 'PENDIENTE', asignada_a: null },
      ],
    },
  }),

  marcar_tarea_completada: ({ tarea_id }) => ({
    ok: true,
    data: { id: tarea_id, titulo: 'Llamar a CLIENTE_DEMO_01', mensaje: 'Marcada HECHA' },
  }),

  proponer_correo_cobranza_cliente: ({ termino, email_destino, plantilla_id }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    gestionSeq++;
    return {
      ok: true,
      data: {
        ok: true,
        gestion_id: gestionSeq,
        codigo: c.codigo,
        cliente: c.cliente,
        factura: 12345,
        total_facturas: facturasMock.length,
        saldo: 64500,
        asunto: 'Recordatorio de pago — Facturas pendientes por RD$64,500',
        mensaje_email: 'Estimado cliente, le contactamos para recordarle...',
        destinatario_email: email_destino ?? `cobros_${c.codigo.toLowerCase()}@example.com`,
        plantilla_usada: plantilla_id ?? 4,
      },
    };
  },

  proponer_whatsapp_cobranza_cliente: ({ termino }) => {
    const c = clienteFromTermino(String(termino ?? ''));
    gestionSeq++;
    return {
      ok: true,
      data: {
        ok: true,
        gestion_id: gestionSeq,
        codigo: c.codigo,
        cliente: c.cliente,
        factura: 12345,
        saldo: 64500,
        mensaje_wa: 'Hola, recordatorio de factura pendiente RD$64,500...',
        destinatario_telefono: '+18095551234',
        tiene_pdf: true,
        url_pdf: 'https://drive.google.com/file/d/mock/view',
      },
    };
  },

  listar_plantillas_email: () => ({
    ok: true,
    data: {
      total: 6,
      plantillas: [
        { id: 1, nombre: 'Recordatorio suave', segmento: 'VERDE', tono: 'AMABLE' },
        { id: 2, nombre: 'Recordatorio', segmento: 'AMARILLO', tono: 'CORDIAL' },
        { id: 4, nombre: 'Cobranza formal', segmento: 'NARANJA', tono: 'FIRME' },
        { id: 5, nombre: 'Cobranza urgente', segmento: 'ROJO', tono: 'URGENTE' },
      ],
    },
  }),

  consultar_contactos_cliente: obtenerContactosClienteMock,
  consultar_contactos_cliente_detalle: obtenerContactosClienteMock,

  guardar_email_cliente: ({ codigo_cliente, valor }) => ({
    ok: true,
    data: { codigo_cliente, campo: 'email', valor },
  }),

  guardar_whatsapp_cliente: ({ codigo_cliente, valor }) => ({
    ok: true,
    data: { codigo_cliente, campo: 'whatsapp', valor },
  }),

  guardar_contacto_cobros_cliente: ({ codigo_cliente, valor }) => ({
    ok: true,
    data: { codigo_cliente, campo: 'contacto_cobros', valor },
  }),

  listar_clientes_con_datos_faltantes: ({ faltante, limite }) => {
    const n = Math.min(Number(limite) || 15, 4);
    const clientes = Array.from({ length: n }, (_, i) => ({
      codigo: `CG${String(100 + i).padStart(4, '0')}`,
      nombre: `CLIENTE_DEMO_${String(i + 1).padStart(2, '0')}`,
      saldo_neto: 100000 - i * 15000,
      facturas: 3,
      falta_email: i % 2 === 0,
      falta_whatsapp: i % 3 === 0,
    }));
    return { ok: true, data: { total: clientes.length, mostrados: clientes.length, filtro: faltante ?? 'cualquiera', clientes } };
  },

  resumen_cadencias_automaticas: () => ({
    ok: true,
    data: {
      cadencias_activas: 4,
      configuracion: [
        { segmento: 'AMARILLO', dia: 1, accion: 'EMAIL', aprobacion: 'auto' },
        { segmento: 'NARANJA', dia: 16, accion: 'WHATSAPP', aprobacion: 'manual' },
      ],
      facturas_con_estado: 145,
      facturas_pausadas: 3,
      gestiones_generadas_24h: 23,
      ultimo_run: { fecha: '2026-05-19 06:00:00', stats: { evaluadas: 145, aplicadas: 23 } },
    },
  }),

  listar_cadencias: () => ({
    ok: true,
    data: {
      cadencias: [
        { id: 1, segmento: 'AMARILLO', dia_desde_vencimiento: 1, accion: 'EMAIL', requiere_aprobacion: false, plantilla_mensaje_id: 2, activa: true },
        { id: 2, segmento: 'NARANJA', dia_desde_vencimiento: 16, accion: 'WHATSAPP', requiere_aprobacion: true, plantilla_mensaje_id: 4, activa: true },
      ],
      ultimo_run: { created_at: '2026-05-19 06:00:00' },
    },
  }),

  activar_cadencia: ({ id, activa }) => ({
    ok: true,
    data: { mensaje: `Cadencia ${id} ${activa ? 'activada' : 'desactivada'}.` },
  }),

  ejecutar_cadencias_ahora: () => ({
    ok: true,
    data: { empresas: 1, evaluadas: 145, aplicadas: 23, fastForward: 0, omitidas: 122, errores: [] },
  }),

  generar_cola_hoy: () => ({
    ok: true,
    data: {
      generadas: 6,
      total_facturas: 6,
      clientes_excluidos_por_saldo_a_favor: 1,
      facturas_excluidas_por_saldo_a_favor: 1,
      modo: 'mock',
    },
  }),

  resumen_conciliacion_bancaria: () => ({
    ok: true,
    data: {
      ultimo_extracto: { archivo: 'extracto-mock.xlsx', banco: 'BANRESERVAS', fecha_extracto: '2026-05-19', cargado_at: '2026-05-19 08:15:00' },
      del_ultimo_extracto: {
        conciliadas: { cantidad: 12, monto: 450000 },
        por_aplicar: { cantidad: 2, monto: 30000 },
        desconocidas: { cantidad: 3, monto: 18000 },
        cheques_devueltos: { cantidad: 0, monto: 0 },
      },
      pendientes_historicos: { por_aplicar: 2, desconocidas: 5, cheques_devueltos: 1 },
      tareas_abiertas: [{ id: 90, tipo: 'CHEQUE_DEVUELTO', titulo: 'Cheque devuelto CLIENTE_DEMO_03', dias_abierta: 4 }],
    },
  }),

  listar_depositos_pendientes: ({ estado, limite }) => {
    const n = Math.min(Number(limite) || 20, 3);
    const depositos = Array.from({ length: n }, (_, i) => ({
      id: 500 + i,
      estado: estado && estado !== 'TODOS' ? String(estado) : (i === 0 ? 'DESCONOCIDO' : 'POR_APLICAR'),
      fecha_transaccion: '2026-05-19',
      descripcion: `TRANSF ${500 + i}`,
      referencia: `REF-${500 + i}`,
      cuenta_origen: '001-2345678-9',
      monto: 15000 + i * 3000,
      moneda: 'DOP',
      archivo_origen: 'extracto-mock.xlsx',
      codigo_cliente: i === 0 ? null : 'CG0001',
    }));
    return { ok: true, data: { total: depositos.length, depositos } };
  },

  asignar_deposito_a_cliente: ({ conciliacion_id, codigo_cliente }) => ({
    ok: true,
    data: { mensaje: `Depósito ${conciliacion_id} asignado a CLIENTE_DEMO_01 (${codigo_cliente}) — queda POR APLICAR.` },
  }),

  aprobar_deposito: ({ conciliacion_id }) => ({
    ok: true,
    data: { mensaje: `Depósito ${conciliacion_id} aprobado — queda CONCILIADO.` },
  }),

  consultar_notas_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      codigo_cliente,
      tiene_memoria: true,
      patron_pago: 'Suele pagar quincenalmente, primera y tercera semana del mes',
      canal_efectivo: 'WHATSAPP',
      contacto_real: 'María en contabilidad',
      mejor_momento: 'martes y miércoles después de 10am',
      notas_daria: null,
    },
  }),

  guardar_patron_pago_cliente: ({ codigo_cliente, patron_pago }) => ({
    ok: true,
    data: { codigo_cliente, patron_pago, actualizado_por: 'test-suite' },
  }),

  guardar_canal_efectivo_cliente: ({ codigo_cliente, canal_efectivo }) => ({
    ok: true,
    data: { codigo_cliente, canal_efectivo, actualizado_por: 'test-suite' },
  }),

  guardar_nota_libre_cliente: ({ codigo_cliente, nota }) => ({
    ok: true,
    data: { codigo_cliente, notas_daria: nota, actualizado_por: 'test-suite' },
  }),

  consultar_perfil_riesgo_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      codigo_cliente,
      tiene_perfil: true,
      risk_score: 58,
      risk_level: 'ROJO',
      tendencia: 'EMPEORANDO',
      saldo_pendiente: 69500,
      saldo_neto: 64500,
      saldo_a_favor: 5000,
      total_facturas: 3,
      dias_mora_promedio: 35,
      factura_mas_antigua_dias: 45,
      promesas: { total: 5, cumplidas: 2, tasa_cumplimiento: 0.4 },
      acciones_recomendadas: { credito: 'AUTORIZAR_MANUAL', ventas: 'REQUIERE_ABONO', cobranza: 'GESTION_DIRECTA' },
      razones: ['Mora promedio > 30 días', 'Solo cumplió 2 de 5 promesas en últimos 90 días'],
      resumen: 'Cliente con riesgo creciente. Mora promedio 35 días, cumplimiento de promesas bajo (40%). Requiere gestión directa.',
    },
  }),

  resumen_riesgo_cartera: ({ limite_criticos }) => ({
    ok: true,
    data: {
      distribucion: { VERDE: 178, AMARILLO: 52, ROJO: 33, CRITICO: 8 },
      criticos: Array.from({ length: Math.min(Number(limite_criticos) || 5, 3) }, (_, i) => ({
        codigo: `CG${String(900 + i).padStart(4, '0')}`,
        cliente: `CLIENTE_DEMO_CRIT_${i + 1}`,
        score: 82 - i,
        saldo_neto: 150000 - i * 20000,
      })),
      a_no_vender: [{ codigo: 'CG0900', cliente: 'CLIENTE_DEMO_CRIT_1' }],
      deteriorando: [{ codigo: 'CG0099', cliente: 'CLIENTE_DEMO_03', delta_score: 22 }],
    },
  }),

  guardar_preferencia_equipo: ({ clave, valor, ambito }) => ({
    ok: true,
    data: { clave, valor, ambito: ambito ?? 'usuario' },
  }),

  listar_disputas: ({ limite }) => {
    const n = Math.min(Number(limite) || 20, 3);
    const disputas = Array.from({ length: n }, (_, i) => ({
      id: 40 + i,
      codigo_cliente: 'CG0001',
      nombre_cliente: 'CLIENTE_DEMO_01',
      ij_inum: 90000 + i,
      motivo: 'Mercancía dañada',
      monto_disputado: 5000,
      estado: i === 0 ? 'ABIERTA' : 'EN_REVISION',
      resolucion: null,
      resuelto_por: null,
      fecha_resolucion: null,
      registrado_por: 'test-suite',
      created_at: '2026-05-15',
    }));
    return { ok: true, data: { total: disputas.length, disputas } };
  },

  crear_disputa: ({ ij_inum }) => {
    disputaSeq++;
    return { ok: true, data: { mensaje: `Disputa ${disputaSeq} abierta para la factura ${ij_inum}.`, id: disputaSeq } };
  },

  resolver_disputa: ({ disputa_id, estado }) => ({
    ok: true,
    data: { mensaje: `Disputa ${disputa_id} pasó a ${estado}.` },
  }),

  enviar_reporte_excel: ({ tipo }) => ({
    ok: true,
    data: { mensaje: `Te envié el reporte de ${tipo} (12 filas).` },
  }),

  enviar_factura_cliente: ({ ij_inum, canal, destinatario }) => ({
    ok: true,
    data: { mensaje: `Factura ${ij_inum} enviada por ${canal} a ${destinatario ?? 'contacto guardado'}.` },
  }),

  pausar_cliente: ({ codigo_cliente, hasta }) => ({
    ok: true,
    data: { mensaje: `${codigo_cliente} pausado hasta ${hasta}. No recibirá cobranza automática hasta entonces.` },
  }),

  reactivar_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: { mensaje: `${codigo_cliente} reactivado — vuelve a la cobranza normal.` },
  }),

  generar_link_portal: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      mensaje: `Link del portal para ${codigo_cliente}, válido 30 días.`,
      url: `https://cobros.sguipak.com/portal/mock-token-${codigo_cliente}`,
      expiracion: '2026-06-19T00:00:00.000Z',
    },
  }),

  recordar_conversaciones: ({ termino, codigo_cliente }) => ({
    ok: true,
    data: {
      total: 2,
      resultados: [
        { rol: 'usuario', contenido: `cuánto debe ${termino ?? codigo_cliente ?? 'el cliente'}`, codigo_cliente: codigo_cliente ?? 'CG0001', chat_id: -900001, created_at: '2026-05-12 10:00:00' },
        { rol: 'asistente', contenido: 'Debe RD$64,500', codigo_cliente: codigo_cliente ?? 'CG0001', chat_id: -900001, created_at: '2026-05-12 10:00:05' },
      ],
    },
  }),

  linea_de_tiempo_cliente: ({ codigo_cliente }) => ({
    ok: true,
    data: {
      codigo_cliente,
      total: 3,
      eventos: [
        { fecha: '2026-05-19 08:00:00', tipo: 'GESTION', resumen: 'Gestión #1050 (EMAIL) — ENVIADO — factura 90000, RD$35,000.00' },
        { fecha: '2026-05-15 14:00:00', tipo: 'PROMESA', resumen: 'Promesa de pago: RD$25,000.00 para el 2026-05-20 — PENDIENTE' },
        { fecha: '2026-05-10 09:00:00', tipo: 'MENSAJE', resumen: 'usuario: cuánto debe este cliente' },
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
