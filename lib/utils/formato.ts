/**
 * Utilidades de formato para el sistema de cobranzas
 * Fechas en America/Santo_Domingo, montos con formato dominicano
 */

import type { SegmentoRiesgo } from '@/lib/types/cartera';

/**
 * Formatea un monto con símbolo de moneda.
 * DOP → "RD$12,596.34"
 * USD → "US$1,234.56"
 */
export function formatMonto(monto: number, moneda: string = 'DOP'): string {
  const simbolo = moneda === 'USD' ? 'US$' : 'RD$';
  return `${simbolo}${monto.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Formatea una fecha corta: "10/abr/2026"
 */
export function formatFecha(fecha: string | Date): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()}/${meses[d.getMonth()]}/${d.getFullYear()}`;
}

/**
 * Color hex por segmento de riesgo.
 */
export function colorSegmento(segmento: SegmentoRiesgo): string {
  const colores: Record<SegmentoRiesgo, string> = {
    VERDE: '#52c41a',
    AMARILLO: '#faad14',
    NARANJA: '#fa8c16',
    ROJO: '#f5222d',
  };
  return colores[segmento] || '#d9d9d9';
}

/**
 * Color de fondo suave por segmento.
 */
export function bgColorSegmento(segmento: SegmentoRiesgo): string {
  const colores: Record<SegmentoRiesgo, string> = {
    VERDE: '#f6ffed',
    AMARILLO: '#fffbe6',
    NARANJA: '#fff7e6',
    ROJO: '#fff1f0',
  };
  return colores[segmento] || '#fafafa';
}

/**
 * Texto descriptivo de días vencido.
 */
export function diasVencidoTexto(dias: number): string {
  if (dias < 0) return `Vence en ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}`;
  if (dias === 0) return 'Vence hoy';
  return `${dias} día${dias === 1 ? '' : 's'} vencida`;
}
