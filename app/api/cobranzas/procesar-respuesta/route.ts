import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { generarRespuestaCliente } from '@/lib/claude/client';
import type { ContextoRespuesta } from '@/lib/claude/prompts';

/**
 * POST /api/cobranzas/procesar-respuesta
 * Procesa un mensaje entrante de un cliente.
 * Genera respuesta con Claude AI → cola de aprobación.
 * CP-02: Respuesta va a cola, NO se envía automáticamente.
 * CP-08: Log de todo.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { telefono, mensaje, canal = 'WHATSAPP' } = body as {
      telefono: string;
      mensaje: string;
      canal?: string;
    };

    if (!telefono || !mensaje) {
      return NextResponse.json({ error: 'telefono y mensaje requeridos' }, { status: 400 });
    }

    // Buscar cliente por teléfono
    const cliente = await buscarClientePorTelefono(telefono);
    if (!cliente) {
      // Registrar mensaje de número desconocido
      await logAccion(null, 'MENSAJE_NUMERO_DESCONOCIDO', 'sistema', '0', { telefono, mensaje: mensaje.substring(0, 100) });
      return NextResponse.json({ message: 'Número no asociado a cliente', procesado: false });
    }

    // Buscar facturas pendientes del cliente
    const facturas = await cobranzasQuery<{ ij_inum: number; saldo_pendiente: number; moneda: string; dias_vencido: number; segmento_riesgo: string }>(
      `SELECT ij_inum, saldo_pendiente, moneda, dias_vencido, segmento_riesgo
       FROM cobranza_gestiones
       WHERE codigo_cliente = ? AND estado IN ('ENVIADO','APROBADO','EDITADO')
       ORDER BY dias_vencido DESC LIMIT 1`,
      [cliente.codigo]
    );

    // Buscar historial de conversación
    const historial = await cobranzasQuery<{ direccion: string; contenido: string; created_at: string }>(
      `SELECT direccion, contenido, created_at FROM cobranza_conversaciones
       WHERE codigo_cliente = ? ORDER BY created_at DESC LIMIT 10`,
      [cliente.codigo]
    );

    // Buscar acuerdos previos
    const acuerdos = await cobranzasQuery<{ monto_prometido: number; fecha_prometida: string; estado: string }>(
      `SELECT monto_prometido, fecha_prometida, estado FROM cobranza_acuerdos
       WHERE codigo_cliente = ? ORDER BY created_at DESC LIMIT 5`,
      [cliente.codigo]
    );

    const factura = facturas[0] || { ij_inum: 0, saldo_pendiente: 0, moneda: 'DOP', dias_vencido: 0, segmento_riesgo: 'AMARILLO' };

    // Registrar mensaje recibido en conversaciones
    const convResult = await cobranzasExecute(
      `INSERT INTO cobranza_conversaciones
       (codigo_cliente, ij_inum, canal, direccion, contenido, whatsapp_from, estado, generado_por_ia)
       VALUES (?, ?, ?, 'RECIBIDO', ?, ?, 'RESPONDIDO', 0)`,
      [cliente.codigo, factura.ij_inum || null, canal, mensaje, telefono]
    );

    // Construir contexto para Claude
    const contexto: ContextoRespuesta = {
      nombre_cliente: cliente.nombre,
      codigo_cliente: cliente.codigo,
      mensaje_cliente: mensaje,
      historial_conversacion: historial.reverse().map(
        (h) => `[${h.direccion}] ${h.contenido.substring(0, 200)}`
      ),
      saldo_pendiente: Number(factura.saldo_pendiente),
      moneda: factura.moneda,
      dias_vencido: Number(factura.dias_vencido),
      segmento_riesgo: factura.segmento_riesgo as ContextoRespuesta['segmento_riesgo'],
      acuerdos_previos: acuerdos.map(
        (a) => `${a.estado}: RD$${a.monto_prometido} para ${a.fecha_prometida}`
      ),
      numero_factura: Number(factura.ij_inum),
    };

    // Generar respuesta con Claude AI (CP-10: solo texto)
    const respuesta = await generarRespuestaCliente(contexto);

    // Si Claude detectó un acuerdo de pago
    if (respuesta.acuerdo?.fecha) {
      await cobranzasExecute(
        `INSERT INTO cobranza_acuerdos
         (codigo_cliente, ij_inum, conversacion_id, monto_prometido, moneda, fecha_prometida, descripcion, capturado_por_ia, registrado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ia_sistema')`,
        [
          cliente.codigo, factura.ij_inum, convResult.insertId,
          respuesta.acuerdo.monto || factura.saldo_pendiente,
          factura.moneda, respuesta.acuerdo.fecha,
          respuesta.acuerdo.descripcion || `Acuerdo detectado por IA del mensaje: "${mensaje.substring(0, 100)}"`,
        ]
      );
    }

    // Si Claude detectó una disputa
    if (respuesta.disputa?.motivo) {
      await cobranzasExecute(
        `INSERT INTO cobranza_disputas
         (codigo_cliente, ij_inum, motivo, monto_disputado, registrado_por)
         VALUES (?, ?, ?, ?, 'ia_sistema')`,
        [
          cliente.codigo, factura.ij_inum,
          respuesta.disputa.motivo,
          respuesta.disputa.monto_disputado || null,
        ]
      );
    }

    // CP-02: Crear gestión PENDIENTE con la respuesta (va a cola de aprobación)
    if (respuesta.respuesta_wa) {
      await cobranzasExecute(
        `INSERT INTO cobranza_gestiones
         (ij_local, ij_typedoc, ij_inum, codigo_cliente,
          total_factura, saldo_pendiente, moneda, fecha_vencimiento,
          dias_vencido, segmento_riesgo, canal,
          mensaje_propuesto_wa, estado, creado_por, ultima_consulta_softec)
         VALUES ('001', 'IN', ?, ?, ?, ?, ?, CURDATE(), ?, ?, 'WHATSAPP', ?, 'PENDIENTE', 'ia_respuesta', NOW())`,
        [
          factura.ij_inum, cliente.codigo,
          factura.saldo_pendiente, factura.saldo_pendiente, factura.moneda,
          factura.dias_vencido, factura.segmento_riesgo,
          respuesta.respuesta_wa,
        ]
      );
    }

    // CP-08: Log
    await logAccion(null, 'RESPUESTA_PROCESADA', 'conversacion', convResult.insertId.toString(), {
      cliente: cliente.codigo,
      telefono,
      intencion: respuesta.intencion,
      tiene_acuerdo: !!respuesta.acuerdo?.fecha,
      tiene_disputa: !!respuesta.disputa?.motivo,
    });

    return NextResponse.json({
      message: 'Respuesta procesada',
      procesado: true,
      intencion: respuesta.intencion,
      acuerdo_registrado: !!respuesta.acuerdo?.fecha,
      disputa_registrada: !!respuesta.disputa?.motivo,
      respuesta_en_cola: !!respuesta.respuesta_wa,
    });
  } catch (error) {
    console.error('[PROCESAR-RESPUESTA] Error:', error);
    return NextResponse.json({ error: 'Error procesando respuesta' }, { status: 500 });
  }
}

async function buscarClientePorTelefono(telefono: string): Promise<{ codigo: string; nombre: string } | null> {
  const numLimpio = telefono.replace(/[^0-9]/g, '');

  // Buscar en datos enriquecidos
  const enriq = await cobranzasQuery<{ codigo_cliente: string }>(
    `SELECT codigo_cliente FROM cobranza_clientes_enriquecidos
     WHERE whatsapp LIKE ? OR whatsapp2 LIKE ? LIMIT 1`,
    [`%${numLimpio.slice(-10)}%`, `%${numLimpio.slice(-10)}%`]
  );

  if (enriq.length > 0) {
    // Buscar nombre en gestiones recientes
    const gest = await cobranzasQuery<{ codigo_cliente: string }>(
      'SELECT codigo_cliente FROM cobranza_gestiones WHERE codigo_cliente = ? LIMIT 1',
      [enriq[0].codigo_cliente]
    );
    return { codigo: enriq[0].codigo_cliente, nombre: enriq[0].codigo_cliente };
  }

  // Buscar en conversaciones previas por teléfono
  const conv = await cobranzasQuery<{ codigo_cliente: string }>(
    `SELECT DISTINCT codigo_cliente FROM cobranza_conversaciones
     WHERE whatsapp_from LIKE ? LIMIT 1`,
    [`%${numLimpio.slice(-10)}%`]
  );

  if (conv.length > 0) {
    return { codigo: conv[0].codigo_cliente, nombre: conv[0].codigo_cliente };
  }

  // Mock: si no encontramos, retornar el primer cliente con gestión
  const mock = await cobranzasQuery<{ codigo_cliente: string }>(
    'SELECT DISTINCT codigo_cliente FROM cobranza_gestiones LIMIT 1'
  );

  if (mock.length > 0) {
    return { codigo: mock[0].codigo_cliente, nombre: mock[0].codigo_cliente };
  }

  return null;
}
