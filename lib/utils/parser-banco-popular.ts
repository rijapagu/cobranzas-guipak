/**
 * Parser especializado para extractos de Banco Popular Dominicano.
 * Soporta formato CSV (Consulta de Transacciones) y TXT (raw).
 *
 * CSV columns: Fecha Posteo, Descripción Corta, Monto Transacción,
 *              Balance, No. Referencia, No. Serial, Descripción
 *
 * TXT columns: Cuenta(21), Fecha, Referencia(13), Monto(12), CR/DB,
 *              Descripción(~120), CódigoTipo(3), Serial(13)
 */

import type { LineaExtracto } from '@/lib/types/conciliacion';

type FormatoBP = 'csv' | 'txt' | false;

export function esBancoPopular(text: string): FormatoBP {
  if (text.includes('Fecha Posteo,')) return 'csv';
  if (/^\d{21},\d{2}\/\d{2}\/\d{4},/.test(text)) return 'txt';
  if (text.includes('Banco Popular')) return 'csv';
  return false;
}

export function parsearBancoPopular(buffer: Buffer): LineaExtracto[] {
  const text = buffer.toString('utf-8').replace(/^﻿/, '');
  const formato = esBancoPopular(text);
  if (formato === 'csv') return parsearCSV(text);
  if (formato === 'txt') return parsearTXT(text);
  return [];
}

function parsearCSV(text: string): LineaExtracto[] {
  const lines = text.split(/\r?\n/);
  const results: LineaExtracto[] = [];
  let enDatos = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('Fecha Posteo,')) {
      enDatos = true;
      continue;
    }
    if (!enDatos) continue;

    const cols = trimmed.split(',');
    if (cols.length < 7) continue;

    const descCorta = cols[1];
    if (!esCredito(descCorta)) continue;

    const descripcion = cols.slice(6).join(',');
    if (esExcluido(descripcion)) continue;

    const monto = parseFloat(cols[2]);
    if (!monto || monto <= 0) continue;

    const fecha = parsearFechaDMY(cols[0]);
    if (!fecha) continue;

    const noRef = (cols[4] || '').trim();
    const noSerial = (cols[5] || '').trim();

    results.push({
      fecha_transaccion: fecha,
      descripcion: limpiarDescripcion(descripcion),
      referencia: elegirReferencia(noSerial, noRef),
      cuenta_origen: extraerCuentaOrigen(noSerial, descripcion),
      monto,
      moneda: 'DOP',
    });
  }

  return results;
}

function parsearTXT(text: string): LineaExtracto[] {
  const lines = text.split(/\r?\n/);
  const results: LineaExtracto[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const cols = trimmed.split(',');
    if (cols.length < 8) continue;

    const tipo = cols[4].trim();
    if (tipo !== 'CR') continue;

    const serial = cols[cols.length - 1].trim();
    const descripcion = cols.slice(5, cols.length - 2).join(',');

    if (esExcluido(descripcion)) continue;

    const monto = parseFloat(cols[3]);
    if (!monto || monto <= 0) continue;

    const fecha = parsearFechaDMY(cols[1]);
    if (!fecha) continue;

    const referencia = cols[2].trim();

    results.push({
      fecha_transaccion: fecha,
      descripcion: limpiarDescripcion(descripcion),
      referencia: elegirReferencia(referencia, serial),
      cuenta_origen: extraerCuentaOrigen(referencia, descripcion),
      monto,
      moneda: 'DOP',
    });
  }

  return results;
}

function esCredito(descCorta: string): boolean {
  const d = descCorta.trim().toLowerCase();
  return (
    d.startsWith('crédito') ||
    d.startsWith('credito') ||
    d.startsWith('depósito') ||
    d.startsWith('deposito')
  );
}

function esExcluido(desc: string): boolean {
  const d = desc.toUpperCase();
  return (
    d.includes('DESEMBOLSO PRESTAMO') ||
    d.includes('REVERSO DE CHEQUE DEPOSITADO DEVUELTO')
  );
}

function parsearFechaDMY(texto: string): string {
  const match = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function limpiarDescripcion(desc: string): string {
  return desc
    .replace(/\s*RD\$\s+\.00\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripLeadingZeros(num: string): string {
  return num.replace(/^0+/, '') || '';
}

function elegirReferencia(primary: string, secondary: string): string {
  const p = stripLeadingZeros(primary);
  const s = stripLeadingZeros(secondary);
  if (p && p.length > 1) return p;
  if (s && s.length > 1) return s;
  return p || s || '';
}

function extraerCuentaOrigen(serial: string, descripcion: string): string {
  const desc = descripcion.trim();

  const mbMatch = desc.match(/MB desde (\d{6,})/i);
  if (mbMatch) return mbMatch[1];

  const appMatch = desc.match(/Transf App Neg de (\d{6,})/i);
  if (appMatch) return appMatch[1];

  const inetMatch = desc.match(/Desde INTERNET (\d{6,})/i);
  if (inetMatch) return inetMatch[1];

  const serialClean = stripLeadingZeros(serial);
  if (serialClean && serialClean.length >= 6) return serialClean;

  const cuentaMatch = desc.match(/^(\d{6,}):/);
  if (cuentaMatch) return cuentaMatch[1];

  return '';
}
