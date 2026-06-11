/**
 * Parser de extractos bancarios (Excel/CSV).
 * Detecta Banco Popular automáticamente; genérico para otros bancos.
 *
 * Lectura con exceljs: la librería `xlsx` (SheetJS 0.18.x de npm) tiene CVEs
 * sin parche (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) y
 * este módulo procesa archivos subidos por usuarios.
 */

import ExcelJS from 'exceljs';
import type { LineaExtracto } from '@/lib/types/conciliacion';
import { esBancoPopular, parsearBancoPopular, splitCsvLine } from './parser-banco-popular';
import { parsearMonto } from './montos';

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
export async function parsearExtracto(buffer: Buffer, _fileName: string): Promise<LineaExtracto[]> {
  const preview = buffer.toString('utf-8', 0, Math.min(buffer.length, 2000));
  if (esBancoPopular(preview)) {
    return parsearBancoPopular(buffer);
  }

  // .xlsx empieza con la firma ZIP "PK"; lo demás se trata como CSV/texto.
  const rawData = esZip(buffer)
    ? await leerXlsx(buffer)
    : leerCsvGenerico(buffer.toString('utf-8'));

  if (rawData.length === 0) return [];

  // Detectar columnas
  const headers = Object.keys(rawData[0]);
  const mapping = detectarColumnas(headers);

  const lineas: LineaExtracto[] = [];

  for (const row of rawData) {
    const monto = parsearMonto(row[mapping.monto]);
    if (!monto || isNaN(monto) || monto <= 0) continue; // Solo depósitos/créditos

    const fechaRaw = row[mapping.fecha];
    let fecha = '';
    if (fechaRaw instanceof Date) {
      fecha = fechaRaw.toISOString().split('T')[0];
    } else if (typeof fechaRaw === 'number') {
      // Excel serial date (celda numérica sin formato de fecha)
      const ms = Date.UTC(1899, 11, 30) + fechaRaw * 86400000;
      fecha = new Date(ms).toISOString().split('T')[0];
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

function esZip(buffer: Buffer): boolean {
  return buffer.length > 3 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Convierte un CellValue de exceljs (richText, fórmulas, etc.) a primitivo. */
function celdaAPrimitivo(valor: ExcelJS.CellValue): string | number | Date | undefined {
  if (valor === null || valor === undefined) return undefined;
  if (valor instanceof Date) return valor;
  if (typeof valor === 'string' || typeof valor === 'number') return valor;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'object') {
    const v = valor as { result?: ExcelJS.CellValue; text?: string; richText?: { text: string }[] };
    if (v.result !== undefined) return celdaAPrimitivo(v.result);
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  }
  return String(valor);
}

async function leerXlsx(buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: ParsedRow[] = [];
  let headers: string[] = [];

  sheet.eachRow((row, rowNumber) => {
    // row.values es 1-based (índice 0 vacío)
    const values = row.values as ExcelJS.CellValue[];
    if (rowNumber === 1) {
      headers = values.map((v) => String(celdaAPrimitivo(v) ?? '').trim());
      return;
    }
    const obj: ParsedRow = {};
    const ancho = Math.max(values.length, headers.length);
    for (let i = 1; i < ancho; i++) {
      const h = headers[i] || `col${i}`;
      obj[h] = celdaAPrimitivo(values[i]);
    }
    rows.push(obj);
  });

  return rows;
}

function leerCsvGenerico(text: string): ParsedRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const obj: ParsedRow = {};
    headers.forEach((h, i) => {
      obj[h || `col${i}`] = cols[i];
    });
    return obj;
  });
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
