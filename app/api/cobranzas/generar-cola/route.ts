import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, cobranzasExecute, logAccion } from '@/lib/db/cobranzas';
import { generarMensajeCobranza } from '@/lib/claude/client';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import type { FacturaVencida } from '@/lib/types/cartera';
import { seleccionarPlantilla } from '@/lib/templates/seleccionar';
import { renderPlantilla } from '@/lib/templates/render';

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

    // Obtener facturas vencidas
    const softecOk = await testSoftecConnection();
    let facturas: FacturaVencida[];

    if (softecOk) {
      facturas = await queryCarteraSoftec();
    } else {
      facturas = getMockCartera();
    }

    // CP-03: Excluir facturas con disputa activa
    const disputas = await cobranzasQuery<{ ij_inum: number }>(
      "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE estado IN ('ABIERTA', 'EN_REVISION')"
    );
    const disputaIds = new Set(disputas.map((d) => d.ij_inum));
    facturas = facturas.filter((f) => !disputaIds.has(f.numero_interno));

    // Excluir facturas que ya tienen gestión PENDIENTE
    const pendientes = await cobranzasQuery<{ ij_inum: number }>(
      "SELECT DISTINCT ij_inum FROM cobranza_gestiones WHERE estado = 'PENDIENTE'"
    );
    const pendienteIds = new Set(pendientes.map((p) => p.ij_inum));
    facturas = facturas.filter((f) => !pendienteIds.has(f.numero_interno));

    // Excluir clientes pausados
    const pausados = await cobranzasQuery<{ codigo_cliente: string }>(
      'SELECT codigo_cliente FROM cobranza_clientes_enriquecidos WHERE pausa_hasta >= CURDATE() AND no_contactar = 0'
    );
    const pausadoIds = new Set(pausados.map((p) => p.codigo_cliente.trim()));
    facturas = facturas.filter((f) => !pausadoIds.has(f.codigo_cliente.trim()));

    // Limitar a 20 facturas por generación
    const facturasAGenerar = facturas.slice(0, 20);
    let generadas = 0;

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
          });
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
        });
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
          ij_local, ij_typedoc, ij_inum, codigo_cliente,
          total_factura, saldo_pendiente, moneda, fecha_vencimiento,
          dias_vencido, segmento_riesgo, canal,
          mensaje_propuesto_wa, mensaje_propuesto_email, asunto_email,
          estado, tiene_pdf, url_pdf, creado_por, ultima_consulta_softec
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, NOW())`,
        [
          f.localidad, f.tipo_doc, f.numero_interno, f.codigo_cliente,
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
      { facturas_procesadas: facturasAGenerar.length, gestiones_generadas: generadas, modo: softecOk ? 'live' : 'mock' }
    );

    return NextResponse.json({
      message: `Cola generada: ${generadas} gestiones creadas`,
      generadas,
      total_facturas: facturas.length,
      modo: softecOk ? 'live' : 'mock',
    });
  } catch (error) {
    console.error('[GENERAR-COLA] Error:', error);
    return NextResponse.json({ error: 'Error generando cola' }, { status: 500 });
  }
}

async function queryCarteraSoftec(): Promise<FacturaVencida[]> {
  return softecQuery<FacturaVencida>(`
    SELECT
      c.IC_CODE AS codigo_cliente, c.IC_NAME AS nombre_cliente,
      c.IC_RAZON AS razon_social, c.IC_RNC AS rnc,
      c.IC_EMAIL AS email, c.IC_PHONE AS telefono, c.IC_PHONE2 AS telefono2,
      c.IC_CONTACT AS contacto_general, c.IC_ARCONTC AS contacto_cobros,
      c.IC_CRDLMT AS limite_credito,
      f.IJ_LOCAL AS localidad, f.IJ_TYPEDOC AS tipo_doc, f.IJ_INUM AS numero_interno,
      CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0')) AS ncf_fiscal,
      f.IJ_DATE AS fecha_emision, f.IJ_DUEDATE AS fecha_vencimiento,
      DATEDIFF(CURDATE(), f.IJ_DUEDATE) AS dias_vencido,
      f.IJ_TAXSUB AS subtotal_gravable, f.IJ_TAX AS itbis,
      f.IJ_TOT AS total_factura, f.IJ_TOTAPPL AS total_pagado,
      (f.IJ_TOT - f.IJ_TOTAPPL) AS saldo_pendiente,
      f.IJ_DTOT AS total_factura_dop, f.IJ_DTOTAPP AS total_pagado_dop,
      (f.IJ_DTOT - f.IJ_DTOTAPP) AS saldo_pendiente_dop,
      f.IJ_CURRENC AS moneda, f.IJ_EXCHRAT AS tasa_cambio,
      f.IJ_TERMS AS terminos_pago, f.IJ_NET AS dias_credito, f.IJ_SLSCODE AS vendedor,
      CASE
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1 AND 15 THEN 'AMARILLO'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30 THEN 'ROJO'
        ELSE 'VERDE'
      END AS segmento_riesgo
    FROM ijnl f
    INNER JOIN icust c ON c.IC_CODE = f.IJ_CCODE AND c.IC_STATUS = 'A'
    WHERE f.IJ_TYPEDOC = 'IN' AND f.IJ_INVTORF = 'T' AND f.IJ_PAID = 'F'
      AND f.IJ_DUEDATE < CURDATE() AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    ORDER BY DATEDIFF(CURDATE(), f.IJ_DUEDATE) DESC
  `);
}
