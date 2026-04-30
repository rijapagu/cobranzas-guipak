import { NextRequest, NextResponse } from 'next/server';
import { cobranzasQueryRaw } from '@/lib/db/cobranzas';
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
        // 1. Strip line comments (--) primero
        const sinComentarios = contenido
          .split('\n')
          .map((linea) => {
            const idx = linea.indexOf('--');
            return idx === -1 ? linea : linea.substring(0, idx);
          })
          .join('\n');

        // 2. Split por ; al final de línea
        const statements = sinComentarios
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const ejecutadosArchivo: string[] = [];
        for (const stmt of statements) {
          await cobranzasQueryRaw(stmt);
          // Nombre del statement para reporte (CREATE TABLE foo, INSERT INTO foo, etc.)
          const resumen = stmt.split('\n')[0].substring(0, 60);
          ejecutadosArchivo.push(resumen);
        }
        ejecutadas.push(`${archivo} (${ejecutadosArchivo.length} statements)`);
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
