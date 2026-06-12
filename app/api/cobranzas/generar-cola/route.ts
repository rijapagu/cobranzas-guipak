import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion, logError } from '@/lib/db/cobranzas';
import { generarMensajeCobranza } from '@/lib/claude/client';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import type { FacturaVencida } from '@/lib/types/cartera';
import { seleccionarPlantilla } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';
import { obtenerSaldoAFavorPorCliente } from '@/lib/cobranzas/saldo-favor';
import { empresaIdDeSesion, EMPRESA_GUIPAK } from '@/lib/tenant';
import { adaptadorParaEmpresa } from '@/lib/erp';
import { carteraCompatParaEmpresa } from '@/lib/erp/compat';
import { configDeEmpresa } from '@/lib/empresas/config';

/**
 * POST /api/cobranzas/generar-cola
 * Genera mensajes de cobranza con Claude AI para facturas vencidas.
 * Inserta en cobranza_gestiones con estado PENDIENTE.
 * CP-03: Excluye facturas con disputa activa.
 * CP-10: Claude solo genera texto.
 */
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden generar cola' }, { status: 403 });
    }

    // Todas las empresas generan desde el adaptador ERP (lib/erp) — solo
    // facturas YA vencidas. El mock solo aplica a Guipak sin conexión Softec.
    const empresaId = empresaIdDeSesion(session);
    const esGuipak = empresaId === EMPRESA_GUIPAK;
    const adapter = await adaptadorParaEmpresa(empresaId);
    const softecOk = esGuipak && (await adapter.disponible());
    let facturas: FacturaVencida[];

    if (esGuipak && !softecOk) {
      facturas = getMockCartera();
    } else {
      facturas = await carteraCompatParaEmpresa(empresaId, { soloVencidas: true });
    }

    // CP-03: Excluir facturas con disputa activa
    const disputas = await cobranzasQuery<{ ij_inum: number }>(
      "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE empresa_id = ? AND estado IN ('ABIERTA', 'EN_REVISION')",
      [empresaId]
    );
    const disputaIds = new Set(disputas.map((d) => d.ij_inum));
    facturas = facturas.filter((f) => !disputaIds.has(f.numero_interno));

    // Excluir facturas que ya tienen una gestión activa (no solo PENDIENTE:
    // una gestión APROBADA aún no enviada también cuenta — si no, el cliente
    // recibiría dos cobros por la misma factura el mismo día).
    const pendientes = await cobranzasQuery<{ ij_inum: number }>(
      "SELECT DISTINCT ij_inum FROM cobranza_gestiones WHERE empresa_id = ? AND estado IN ('PENDIENTE','APROBADO','EDITADO','ENVIANDO')",
      [empresaId]
    );
    const pendienteIds = new Set(pendientes.map((p) => p.ij_inum));
    facturas = facturas.filter((f) => !pendienteIds.has(f.numero_interno));

    // Excluir clientes pausados o marcados no_contactar (un cliente con
    // no_contactar=1 se excluye aunque no tenga pausa_hasta).
    const pausados = await cobranzasQuery<{ codigo_cliente: string }>(
      'SELECT codigo_cliente FROM cobranza_clientes_enriquecidos WHERE empresa_id = ? AND (no_contactar = 1 OR pausa_hasta >= CURDATE())',
      [empresaId]
    );
    const pausadoIds = new Set(pausados.map((p) => p.codigo_cliente.trim()));
    facturas = facturas.filter((f) => !pausadoIds.has(f.codigo_cliente.trim()));

    // CP-15: excluir clientes cuyo saldo a favor (anticipos / recibos sin
    // aplicar) cubre o excede su saldo pendiente bruto. No tiene sentido
    // mandar cobranza a un cliente al que le debemos dinero — el supervisor
    // debe aplicar el anticipo. Registramos cuántos se excluyen para
    // trazabilidad (CP-08).
    let clientesCubiertosExcluidos = 0;
    let facturasExcluidasPorCobertura = 0;
    if (softecOk && facturas.length > 0) {
      const pendientePorCliente = new Map<string, number>();
      for (const f of facturas) {
        const codigo = String(f.codigo_cliente).trim();
        pendientePorCliente.set(
          codigo,
          (pendientePorCliente.get(codigo) ?? 0) + (Number(f.saldo_pendiente) || 0)
        );
      }
      const codigosDeFacturas = Array.from(pendientePorCliente.keys());
      const saldosFavor = await obtenerSaldoAFavorPorCliente(codigosDeFacturas);
      const clientesCubiertos = new Set<string>();
      for (const [codigo, pendiente] of pendientePorCliente.entries()) {
        const favor = saldosFavor.get(codigo) ?? 0;
        if (favor >= pendiente && pendiente > 0) {
          clientesCubiertos.add(codigo);
        }
      }
      if (clientesCubiertos.size > 0) {
        const facturasAntes = facturas.length;
        facturas = facturas.filter(
          (f) => !clientesCubiertos.has(String(f.codigo_cliente).trim())
        );
        clientesCubiertosExcluidos = clientesCubiertos.size;
        facturasExcluidasPorCobertura = facturasAntes - facturas.length;
      }
    }

    // Limitar a 20 facturas por generación
    const facturasAGenerar = facturas.slice(0, 20);
    let generadas = 0;

    // Identidad de la empresa para los mensajes generados por IA
    // (nombre/alias/firma — Guipak por defecto, tenants desde empresas.config).
    const { identidad } = await configDeEmpresa(empresaId);

    for (const f of facturasAGenerar) {
      // Determinar canal
      const tieneWa = !!f.telefono;
      const tieneEmail = !!f.email;
      let canal: 'WHATSAPP' | 'EMAIL' | 'AMBOS' = 'WHATSAPP';
      if (tieneWa && tieneEmail) canal = 'AMBOS';
      else if (tieneEmail && !tieneWa) canal = 'EMAIL';
      else if (!tieneWa && !tieneEmail) continue; // Sin contacto, skip

      // 1. Buscar plantilla apropiada en DB (enfoque A: render directo sin Claude)
      const plantilla = await seleccionarPlantilla({
        segmento: f.segmento_riesgo,
        diasVencido: f.dias_vencido,
        empresaId,
      });

      let asuntoEmail = '';
      let mensajeEmail = '';
      let mensajeWa = '';

      if (plantilla) {
        // Renderizar plantilla con datos de la factura
        const rendered = renderPlantilla(
          { asunto: plantilla.asunto, cuerpo: plantilla.cuerpo },
          {
            cliente: f.contacto_cobros || f.nombre_cliente,
            empresa_cliente: f.nombre_cliente,
            numero_factura: f.numero_interno,
            ncf_fiscal: f.ncf_fiscal,
            monto: f.saldo_pendiente,
            moneda: f.moneda,
            fecha_vencimiento: f.fecha_vencimiento,
            dias_vencida: f.dias_vencido,
          }
        );
        asuntoEmail = rendered.asunto;
        mensajeEmail = rendered.cuerpo;

        // WhatsApp: generamos siempre con Claude (las plantillas son solo email)
        // Solo si el canal lo requiere
        if (canal === 'WHATSAPP' || canal === 'AMBOS') {
          const wa = await generarMensajeCobranza({
            nombre_cliente: f.nombre_cliente,
            contacto_cobros: f.contacto_cobros,
            codigo_cliente: f.codigo_cliente,
            numero_factura: f.numero_interno,
            ncf_fiscal: f.ncf_fiscal,
            saldo_pendiente: f.saldo_pendiente,
            moneda: f.moneda,
            dias_vencido: f.dias_vencido,
            fecha_vencimiento: f.fecha_vencimiento,
            segmento_riesgo: f.segmento_riesgo,
            tiene_pdf: f.tiene_pdf || false,
            url_pdf: f.url_pdf || null,
          }, identidad);
          mensajeWa = wa.mensaje_wa;
        }
      } else {
        // Fallback: sin plantilla disponible → Claude genera todo (comportamiento previo)
        const mensajes = await generarMensajeCobranza({
          nombre_cliente: f.nombre_cliente,
          contacto_cobros: f.contacto_cobros,
          codigo_cliente: f.codigo_cliente,
          numero_factura: f.numero_interno,
          ncf_fiscal: f.ncf_fiscal,
          saldo_pendiente: f.saldo_pendiente,
          moneda: f.moneda,
          dias_vencido: f.dias_vencido,
          fecha_vencimiento: f.fecha_vencimiento,
          segmento_riesgo: f.segmento_riesgo,
          tiene_pdf: f.tiene_pdf || false,
          url_pdf: f.url_pdf || null,
        }, identidad);
        asuntoEmail = mensajes.asunto_email;
        mensajeEmail = mensajes.mensaje_email;
        mensajeWa = mensajes.mensaje_wa;
      }
      const mensajes = {
        mensaje_wa: mensajeWa,
        mensaje_email: mensajeEmail,
        asunto_email: asuntoEmail,
      };

      // Insertar gestión en DB
      await cobranzasExecute(
        `INSERT INTO cobranza_gestiones (
          empresa_id, ij_local, ij_typedoc, ij_inum, codigo_cliente,
          total_factura, saldo_pendiente, moneda, fecha_vencimiento,
          dias_vencido, segmento_riesgo, canal,
          mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
          estado, tiene_pdf, url_pdf, creado_por, ultima_consulta_softec
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, NOW())`,
        [
          empresaId, f.localidad, f.tipo_doc, f.numero_interno, f.codigo_cliente,
          f.total_factura, f.saldo_pendiente, f.moneda, f.fecha_vencimiento,
          f.dias_vencido, f.segmento_riesgo, canal,
          mensajes.mensaje_wa, mensajes.mensaje_email, mensajes.asunto_email,
          f.tiene_pdf ? 1 : 0, f.url_pdf || null, session.email,
        ]
      );

      generadas++;
    }

    // Log
    await logAccion(
      session.userId.toString(),
      'COLA_GENERADA',
      'sistema',
      '0',
      {
        facturas_procesadas: facturasAGenerar.length,
        gestiones_generadas: generadas,
        // CP-15: trazabilidad de exclusiones por saldo a favor
        clientes_excluidos_por_saldo_a_favor: clientesCubiertosExcluidos,
        facturas_excluidas_por_saldo_a_favor: facturasExcluidasPorCobertura,
        modo: esGuipak && !softecOk ? 'mock' : 'live',
      }
    );

    return NextResponse.json({
      message: `Cola generada: ${generadas} gestiones creadas`,
      generadas,
      total_facturas: facturas.length,
      // CP-15: feedback al UI de cuántos clientes se omitieron por anticipos.
      clientes_excluidos_por_saldo_a_favor: clientesCubiertosExcluidos,
      facturas_excluidas_por_saldo_a_favor: facturasExcluidasPorCobertura,
      modo: esGuipak && !softecOk ? 'mock' : 'live',
    });
  } catch (error) {
    await logError('generar-cola', error);
    return NextResponse.json({ error: 'Error generando cola' }, { status: 500 });
  }
}
