import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { cobranzasQuery, logAccion } from '@/lib/db/cobranzas';
import { empresaIdDeSesion } from '@/lib/tenant';
import { invalidarCacheErp } from '@/lib/erp';
import { validarFacturasCsv, validarClientesCsv, importarCartera } from '@/lib/erp/importar';

export const maxDuration = 60;

/**
 * POST /api/erp/importar-cartera
 * Importa (reemplaza) el snapshot de cartera de la empresa en modo CSV.
 *
 * multipart/form-data:
 *   facturas  — archivo CSV requerido (numero, codigo_cliente, total,
 *               saldo_pendiente, fecha_vencimiento [+ opcionales])
 *   clientes  — archivo CSV opcional (codigo, nombre [+ opcionales])
 *
 * Solo SUPERVISOR/ADMIN de una empresa con erp_tipo = 'CSV'.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!['SUPERVISOR', 'ADMIN'].includes(session.rol?.toUpperCase() ?? '')) {
    return NextResponse.json({ error: 'Solo supervisores pueden importar cartera' }, { status: 403 });
  }

  const empresaId = empresaIdDeSesion(session);
  const empresa = await cobranzasQuery<{ erp_tipo: string }>(
    'SELECT erp_tipo FROM empresas WHERE id = ? AND activa = 1 LIMIT 1',
    [empresaId]
  );
  if (empresa[0]?.erp_tipo !== 'CSV') {
    return NextResponse.json(
      { error: 'La importación por archivo solo aplica a empresas en modo CSV' },
      { status: 409 }
    );
  }

  try {
    const form = await request.formData();
    const archivoFacturas = form.get('facturas');
    if (!(archivoFacturas instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo "facturas" (CSV)' }, { status: 400 });
    }
    if (archivoFacturas.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'El archivo de facturas excede 10 MB' }, { status: 413 });
    }

    const { filas: facturas, errores: erroresFacturas } = validarFacturasCsv(
      await archivoFacturas.text()
    );

    let clientes = null;
    let erroresClientes: string[] = [];
    const archivoClientes = form.get('clientes');
    if (archivoClientes instanceof File && archivoClientes.size > 0) {
      if (archivoClientes.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'El archivo de clientes excede 10 MB' }, { status: 413 });
      }
      const res = validarClientesCsv(await archivoClientes.text());
      clientes = res.filas;
      erroresClientes = res.errores;
    }

    const errores = [...erroresFacturas, ...erroresClientes];
    if (facturas.length === 0) {
      return NextResponse.json(
        { error: 'Ninguna factura válida en el archivo', errores },
        { status: 400 }
      );
    }
    // Tolerancia: si más del 20% de las filas son inválidas, se rechaza el
    // archivo completo para no reemplazar el snapshot con datos a medias.
    if (errores.length > 0 && errores.length / (facturas.length + errores.length) > 0.2) {
      return NextResponse.json(
        { error: 'Demasiadas filas inválidas — corrija el archivo y reintente', errores },
        { status: 400 }
      );
    }

    const resultado = await importarCartera(empresaId, facturas, clientes);
    invalidarCacheErp(empresaId);

    await logAccion(
      String(session.userId),
      'CARTERA_IMPORTADA_CSV',
      'erp_cartera',
      String(empresaId),
      { facturas: resultado.facturas, clientes: resultado.clientes, errores: errores.length },
      undefined,
      empresaId
    );

    return NextResponse.json({
      ok: true,
      facturas_importadas: resultado.facturas,
      clientes_importados: resultado.clientes,
      filas_descartadas: errores.length,
      errores: errores.slice(0, 50),
    });
  } catch (error) {
    console.error('[IMPORTAR-CARTERA] Error:', error);
    return NextResponse.json({ error: 'Error importando cartera' }, { status: 500 });
  }
}
