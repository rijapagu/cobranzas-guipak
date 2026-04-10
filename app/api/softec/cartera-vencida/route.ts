import { NextRequest, NextResponse } from 'next/server';
import { softecQuery, testSoftecConnection } from '@/lib/db/softec';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { getMockCartera } from '@/lib/mock/cartera-mock';
import type { FacturaVencida, CarteraResponse, SegmentoRiesgo } from '@/lib/types/cartera';

/**
 * GET /api/softec/cartera-vencida
 *
 * Retorna la cartera vencida. Si Softec no está disponible, usa datos mock.
 * Implementa el filtro cross-DB de disputas en dos pasos (CP-03).
 * Respeta CP-04: siempre filtra IJ_TYPEDOC='IN', IJ_INVTORF='T', IJ_PAID='F'.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const segmentos = searchParams.get('segmentos')?.split(',') as SegmentoRiesgo[] | undefined;
    const busqueda = searchParams.get('busqueda')?.trim();
    const vendedor = searchParams.get('vendedor')?.trim();
    const diasMin = searchParams.get('dias_min') ? Number(searchParams.get('dias_min')) : undefined;
    const diasMax = searchParams.get('dias_max') ? Number(searchParams.get('dias_max')) : undefined;
    const montoMin = searchParams.get('monto_min') ? Number(searchParams.get('monto_min')) : undefined;
    const montoMax = searchParams.get('monto_max') ? Number(searchParams.get('monto_max')) : undefined;

    const softecOk = await testSoftecConnection();
    let facturas: FacturaVencida[];

    if (softecOk) {
      facturas = await queryCarteraReal();
    } else {
      facturas = getMockCartera();
    }

    // Aplicar filtros
    if (segmentos && segmentos.length > 0) {
      facturas = facturas.filter((f) => segmentos.includes(f.segmento_riesgo));
    }
    if (busqueda) {
      const q = busqueda.toLowerCase();
      facturas = facturas.filter(
        (f) =>
          f.nombre_cliente.toLowerCase().includes(q) ||
          f.codigo_cliente.includes(q) ||
          f.ncf_fiscal.includes(q)
      );
    }
    if (vendedor) {
      facturas = facturas.filter((f) => f.vendedor === vendedor);
    }
    if (diasMin !== undefined) {
      facturas = facturas.filter((f) => f.dias_vencido >= diasMin);
    }
    if (diasMax !== undefined) {
      facturas = facturas.filter((f) => f.dias_vencido <= diasMax);
    }
    if (montoMin !== undefined) {
      facturas = facturas.filter((f) => f.saldo_pendiente >= montoMin);
    }
    if (montoMax !== undefined) {
      facturas = facturas.filter((f) => f.saldo_pendiente <= montoMax);
    }

    const response: CarteraResponse = {
      facturas,
      total: facturas.length,
      modo: softecOk ? 'live' : 'mock',
      ultima_consulta: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('[CARTERA] Error:', error);
    return NextResponse.json({ error: 'Error consultando cartera' }, { status: 500 });
  }
}

/**
 * Query real a Softec con filtro de disputas en dos pasos.
 * Paso 1: Query cartera en Softec
 * Paso 2: Query disputas activas en cobranzas_guipak
 * Paso 3: Filtrar en app (excluir disputas)
 */
async function queryCarteraReal(): Promise<FacturaVencida[]> {
  // Paso 1: Cartera vencida desde Softec (CP-04: filtros obligatorios)
  const facturasRaw = await softecQuery<FacturaVencida>(`
    SELECT
      c.IC_CODE                                           AS codigo_cliente,
      c.IC_NAME                                           AS nombre_cliente,
      c.IC_RAZON                                          AS razon_social,
      c.IC_RNC                                            AS rnc,
      c.IC_EMAIL                                          AS email,
      c.IC_PHONE                                          AS telefono,
      c.IC_PHONE2                                         AS telefono2,
      c.IC_CONTACT                                        AS contacto_general,
      c.IC_ARCONTC                                        AS contacto_cobros,
      c.IC_CRDLMT                                         AS limite_credito,
      f.IJ_LOCAL                                          AS localidad,
      f.IJ_TYPEDOC                                        AS tipo_doc,
      f.IJ_INUM                                           AS numero_interno,
      CONCAT(f.IJ_NCFFIX, LPAD(f.IJ_NCFNUM, 8, '0'))    AS ncf_fiscal,
      f.IJ_DATE                                           AS fecha_emision,
      f.IJ_DUEDATE                                        AS fecha_vencimiento,
      DATEDIFF(CURDATE(), f.IJ_DUEDATE)                   AS dias_vencido,
      f.IJ_TAXSUB                                         AS subtotal_gravable,
      f.IJ_TAX                                            AS itbis,
      f.IJ_TOT                                            AS total_factura,
      f.IJ_TOTAPPL                                        AS total_pagado,
      (f.IJ_TOT - f.IJ_TOTAPPL)                          AS saldo_pendiente,
      f.IJ_DTOT                                           AS total_factura_dop,
      f.IJ_DTOTAPP                                        AS total_pagado_dop,
      (f.IJ_DTOT - f.IJ_DTOTAPP)                         AS saldo_pendiente_dop,
      f.IJ_CURRENC                                        AS moneda,
      f.IJ_EXCHRAT                                        AS tasa_cambio,
      f.IJ_TERMS                                          AS terminos_pago,
      f.IJ_NET                                            AS dias_credito,
      f.IJ_SLSCODE                                        AS vendedor,
      MAX(r.IR_PDATE)                                     AS fecha_ultimo_pago,
      CASE
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 1  AND 15 THEN 'AMARILLO'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) BETWEEN 16 AND 30 THEN 'NARANJA'
        WHEN DATEDIFF(CURDATE(), f.IJ_DUEDATE) > 30              THEN 'ROJO'
        ELSE 'VERDE'
      END                                                 AS segmento_riesgo
    FROM ijnl f
    INNER JOIN icust c
      ON  c.IC_CODE   = f.IJ_CCODE
      AND c.IC_STATUS = 'A'
    LEFT JOIN irjnl r
      ON  r.IR_FLOCAL  = f.IJ_LOCAL
      AND r.IR_FTYPDOC = f.IJ_TYPEDOC
      AND r.IR_FINUM   = f.IJ_INUM
      AND r.IR_CCODE   = f.IJ_CCODE
    WHERE
      f.IJ_TYPEDOC    = 'IN'
      AND f.IJ_INVTORF = 'T'
      AND f.IJ_PAID    = 'F'
      AND f.IJ_DUEDATE < CURDATE()
      AND (f.IJ_TOT - f.IJ_TOTAPPL) > 0
    GROUP BY
      c.IC_CODE, c.IC_NAME, c.IC_RAZON, c.IC_RNC,
      c.IC_EMAIL, c.IC_PHONE, c.IC_PHONE2,
      c.IC_CONTACT, c.IC_ARCONTC, c.IC_CRDLMT,
      f.IJ_LOCAL, f.IJ_TYPEDOC, f.IJ_INUM,
      f.IJ_NCFFIX, f.IJ_NCFNUM,
      f.IJ_DATE, f.IJ_DUEDATE,
      f.IJ_TAXSUB, f.IJ_TAX,
      f.IJ_TOT, f.IJ_TOTAPPL,
      f.IJ_DTOT, f.IJ_DTOTAPP,
      f.IJ_CURRENC, f.IJ_EXCHRAT,
      f.IJ_TERMS, f.IJ_NET, f.IJ_SLSCODE
    ORDER BY dias_vencido DESC, c.IC_CODE ASC
  `);

  // Paso 2: IDs de facturas con disputa activa (CP-03)
  const disputas = await cobranzasQuery<{ ij_inum: number }>(
    "SELECT DISTINCT ij_inum FROM cobranza_disputas WHERE estado IN ('ABIERTA', 'EN_REVISION')"
  );
  const disputaIds = new Set(disputas.map((d) => d.ij_inum));

  // Paso 3: Filtrar en app
  const facturasFiltradas = facturasRaw.filter(
    (f) => !disputaIds.has(f.numero_interno)
  );

  // Enriquecer con datos de documentos
  const docs = await cobranzasQuery<{ ij_inum: number; url_pdf: string }>(
    'SELECT ij_inum, url_pdf FROM cobranza_facturas_documentos'
  );
  const docsMap = new Map(docs.map((d) => [d.ij_inum, d.url_pdf]));

  return facturasFiltradas.map((f) => ({
    ...f,
    tiene_pdf: docsMap.has(f.numero_interno),
    url_pdf: docsMap.get(f.numero_interno) || null,
  }));
}
