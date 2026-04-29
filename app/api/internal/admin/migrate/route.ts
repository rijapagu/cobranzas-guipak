import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQuery } from '@/lib/db/cobranzas';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

/**
 * POST /api/internal/admin/migrate
 * Ejecuta todas las migrations en db/migrations/ en orden.
 * Las migrations deben ser idempotentes (CREATE TABLE IF NOT EXISTS, INSERT IGNORE, etc.).
 *
 * Auth: header `x-internal-secret` con INTERNAL_CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.INTERNAL_CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const migrationsDir = join(process.cwd(), 'db', 'migrations');
  const ejecutadas: string[] = [];
  const errores: { archivo: string; error: string }[] = [];

  try {
    const archivos = await readdir(migrationsDir);
    const sqls = archivos.filter((a) => a.endsWith('.sql')).sort();

    for (const archivo of sqls) {
      try {
        const contenido = await readFile(join(migrationsDir, archivo), 'utf-8');
        // Ejecutar cada statement separado por ;
        const statements = contenido
          .split(/;\s*\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('--'));

        for (const stmt of statements) {
          // Ignorar comentarios solos
          const sinComentarios = stmt
            .split('\n')
            .filter((l) => !l.trim().startsWith('--'))
            .join('\n')
            .trim();
          if (sinComentarios.length === 0) continue;
          await cobranzasQuery(sinComentarios);
        }
        ejecutadas.push(archivo);
      } catch (err) {
        errores.push({
          archivo,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      ok: errores.length === 0,
      ejecutadas,
      errores,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Error leyendo migrations',
        detalle: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
