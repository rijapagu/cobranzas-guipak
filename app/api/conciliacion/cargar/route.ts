import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { logError } from '@/lib/db/cobranzas';
import { cargarExtracto, ExtractoVacio } from '@/lib/conciliacion/cargar';
import { empresaIdDeSesion } from '@/lib/tenant';

/**
 * POST /api/conciliacion/cargar
 * Recibe extracto bancario (FormData) y lo procesa.
 *
 * Aquí solo vive lo que es propio de HTTP: sesión, permiso y forma de la
 * respuesta. La lógica está en `lib/conciliacion/cargar.ts` porque el bot de
 * Telegram entra por la misma puerta — CP-05 y CP-08 no pueden estar duplicados.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    if (session.rol !== 'ADMIN' && session.rol !== 'SUPERVISOR') {
      return NextResponse.json({ error: 'Solo supervisores pueden cargar extractos' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('archivo') as File | null;
    const banco = (formData.get('banco') as string) || 'Sin especificar';

    if (!file) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let r;
    try {
      r = await cargarExtracto(buffer, file.name, banco, {
        userId: session.userId,
        email: session.email,
        empresaId: empresaIdDeSesion(session),
      });
    } catch (e) {
      if (e instanceof ExtractoVacio) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    return NextResponse.json({
      message: r.mensaje,
      ya_cargado: !r.huboNovedad,
      total: r.total,
      conciliadas: r.conciliadas,
      por_aplicar: r.porAplicar,
      desconocidas: r.desconocidas,
      duplicadas_omitidas: r.duplicadasOmitidas,
      multi_recibo: r.multiRecibo,
      cheques_devueltos: r.chequesDevueltos.length,
      monto_devuelto: r.montoDevuelto,
      detalle_devueltos: r.chequesDevueltos,
      tareas_creadas: r.tareasCreadas,
    });
  } catch (error) {
    await logError('conciliacion-cargar', error);
    return NextResponse.json({ error: 'Error procesando extracto' }, { status: 500 });
  }
}
