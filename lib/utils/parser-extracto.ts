/**
 * Parser de extractos bancarios (Excel/CSV).
 * Detecta columnas automáticamente.
 */

import * as XLSX from 'xlsx';
import type { LineaExtracto } from '@/lib/types/conciliacion';

const COLUMN_PATTERNS = {
  fecha: /fecha|date|fch/i,
  descripcion: /desc|concepto|detalle|narr/i,
  referencia: /ref|num|doc|check/i,
  monto: /monto|amount|credito|credit|dep[oó]sito|ingreso|valor/i,
  cuenta: /cuenta|account|orig|remit/i,
};

interface ParsedRow {
  [key: string]: string | number | Date | undefined;
}

/**
 * Parsea un archivo Excel o CSV y retorna líneas de extracto.
 */
export function parsearExtracto(buffer: Buffer, fileName: string): LineaExtracto[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rawData = XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: '' });

  if (rawData.length === 0) return [];

  // Detectar columnas
  const headers = Object.keys(rawData[0]);
  const mapping = detectarColumnas(headers);

  const lineas: LineaExtracto[] = [];

  for (const row of rawData) {
    const monto = parseFloat(String(row[mapping.monto] || '0'));
    if (!monto || monto <= 0) continue; // Solo depósitos/créditos

    const fechaRaw = row[mapping.fecha];
    let fecha = '';
    if (fechaRaw instanceof Date) {
      fecha = fechaRaw.toISOString().split('T')[0];
    } else if (typeof fechaRaw === 'number') {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(fechaRaw);
      fecha = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    } else {
      fecha = parsearFechaTexto(String(fechaRaw || ''));
    }

    if (!fecha) continue;

    lineas.push({
      fecha_transaccion: fecha,
      descripcion: String(row[mapping.descripcion] || '').trim(),
      referencia: String(row[mapping.referencia] || '').trim(),
      cuenta_origen: String(row[mapping.cuenta] || '').trim(),
      monto,
      moneda: 'DOP', // Default, se puede parametrizar
    });
  }

  return lineas;
}

function detectarColumnas(headers: string[]): {
  fecha: string;
  descripcion: string;
  referencia: string;
  monto: string;
  cuenta: string;
} {
  const result = {
    fecha: headers[0] || '',
    descripcion: headers[1] || '',
    referencia: headers[2] || '',
    monto: headers[3] || '',
    cuenta: headers[4] || '',
  };

  for (const h of headers) {
    if (COLUMN_PATTERNS.fecha.test(h)) result.fecha = h;
    else if (COLUMN_PATTERNS.monto.test(h)) result.monto = h;
    else if (COLUMN_PATTERNS.descripcion.test(h)) result.descripcion = h;
    else if (COLUMN_PATTERNS.referencia.test(h)) result.referencia = h;
    else if (COLUMN_PATTERNS.cuenta.test(h)) result.cuenta = h;
  }

  return result;
}

function parsearFechaTexto(texto: string): string {
  if (!texto) return '';
  // Intenta ISO
  const isoMatch = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  // DD/MM/YYYY
  const dmyMatch = texto.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  return '';
}
