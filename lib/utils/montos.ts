/**
 * Parsing robusto de montos de extractos bancarios.
 *
 * `parseFloat("1,234.56")` devuelve 1 — un depósito de RD$1,234.56 entraba
 * a conciliación como RD$1.00. Este helper maneja separadores de miles
 * (formato dominicano 1,234.56 y europeo 1.234,56), símbolos de moneda
 * y negativos contables entre paréntesis.
 */
export function parsearMonto(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  if (valor === null || valor === undefined) return NaN;

  let s = String(valor).trim();
  if (!s) return NaN;

  // Quitar símbolos de moneda, espacios y cualquier cosa no numérica
  s = s.replace(/[^\d.,()-]/g, '');

  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negativo = true;
    s = s.slice(1);
  }

  const ultimaComa = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');

  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    if (ultimaComa > ultimoPunto) {
      // 1.234,56 — coma decimal, puntos de miles
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,234.56 — punto decimal, comas de miles
      s = s.replace(/,/g, '');
    }
  } else if (ultimaComa !== -1) {
    const digitosTrasComa = s.length - ultimaComa - 1;
    const variasComas = (s.match(/,/g) || []).length > 1;
    if (!variasComas && digitosTrasComa === 2) {
      // 1234,56 — coma decimal
      s = s.replace(',', '.');
    } else {
      // 1,234 / 1,234,567 — comas de miles
      s = s.replace(/,/g, '');
    }
  }

  const n = parseFloat(s);
  return negativo ? -n : n;
}
