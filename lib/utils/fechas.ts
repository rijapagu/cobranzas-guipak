/**
 * Utilidades de fecha para conciliación.
 *
 * mysql2 devuelve columnas DATE/DATETIME como objetos Date de JS.
 * `String(fecha).substring(0, 10)` sobre un Date produce "Wed Jun 10",
 * NO "2026-06-10" — ese bug rompía el matching de fechas en toda la
 * conciliación. Usar siempre toYmd() para obtener la clave YYYY-MM-DD.
 */

/** Convierte Date | string a 'YYYY-MM-DD' usando el calendario local. */
export function toYmd(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).substring(0, 10);
}

/** Parsea 'YYYY-MM-DD' como fecha local (new Date('YYYY-MM-DD') sería UTC). */
export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Suma días a una fecha 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD'. */
export function addDiasYmd(ymd: string, dias: number): string {
  const fecha = parseYmd(ymd);
  fecha.setDate(fecha.getDate() + dias);
  return toYmd(fecha);
}
