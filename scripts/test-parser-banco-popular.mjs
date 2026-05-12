/**
 * Script de prueba: parsea los extractos de Banco Popular de la carpeta Extractos/
 * y muestra estadísticas + primeras transacciones.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// Inline the parser logic for testing (avoids TS compilation)
function esBancoPopular(text) {
  if (text.includes('Fecha Posteo,')) return 'csv';
  if (/^\d{21},\d{2}\/\d{2}\/\d{4},/.test(text)) return 'txt';
  if (text.includes('Banco Popular')) return 'csv';
  return false;
}

function parsearFechaDMY(texto) {
  const match = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function esCredito(descCorta) {
  const d = descCorta.trim().toLowerCase();
  return d.startsWith('crédito') || d.startsWith('credito') ||
         d.startsWith('depósito') || d.startsWith('deposito');
}

function esExcluido(desc) {
  const d = desc.toUpperCase();
  return d.includes('DESEMBOLSO PRESTAMO') || d.includes('REVERSO DE CHEQUE DEPOSITADO DEVUELTO');
}

function limpiarDescripcion(desc) {
  return desc.replace(/\s*RD\$\s+\.00\s*/g, '').replace(/\s{2,}/g, ' ').trim();
}

function stripLeadingZeros(num) {
  return num.replace(/^0+/, '') || '';
}

function elegirReferencia(primary, secondary) {
  const p = stripLeadingZeros(primary);
  const s = stripLeadingZeros(secondary);
  if (p && p.length > 1) return p;
  if (s && s.length > 1) return s;
  return p || s || '';
}

function extraerCuentaOrigen(serial, descripcion) {
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

function esChequeDevuelto(desc) {
  const d = desc.toUpperCase();
  return d.includes('CHEQUE DEPOSITADO DEVUELTO') && !d.includes('REVERSO');
}

function parsearCSV(text) {
  const lines = text.split(/\r?\n/);
  const results = [];
  let enDatos = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('Fecha Posteo,')) { enDatos = true; continue; }
    if (!enDatos) continue;

    const cols = trimmed.split(',');
    if (cols.length < 7) continue;

    const descCorta = cols[1];
    const descripcion = cols.slice(6).join(',');

    const monto = parseFloat(cols[2]);
    if (!monto || monto <= 0) continue;

    const fecha = parsearFechaDMY(cols[0]);
    if (!fecha) continue;

    const noRef = (cols[4] || '').trim();
    const noSerial = (cols[5] || '').trim();

    if (esCredito(descCorta)) {
      if (esExcluido(descripcion)) continue;
      results.push({
        fecha_transaccion: fecha,
        descripcion: limpiarDescripcion(descripcion),
        referencia: elegirReferencia(noSerial, noRef),
        cuenta_origen: extraerCuentaOrigen(noSerial, descripcion),
        monto,
        moneda: 'DOP',
        tipo: 'CREDITO',
      });
    } else if (esChequeDevuelto(descripcion)) {
      results.push({
        fecha_transaccion: fecha,
        descripcion: limpiarDescripcion(descripcion),
        referencia: elegirReferencia(noSerial, noRef),
        cuenta_origen: '',
        monto,
        moneda: 'DOP',
        tipo: 'CHEQUE_DEVUELTO',
      });
    }
  }
  return results;
}

function parsearTXT(text) {
  const lines = text.split(/\r?\n/);
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',');
    if (cols.length < 8) continue;

    const tipo = cols[4].trim();
    const serial = cols[cols.length - 1].trim();
    const descripcion = cols.slice(5, cols.length - 2).join(',');

    const monto = parseFloat(cols[3]);
    if (!monto || monto <= 0) continue;

    const fecha = parsearFechaDMY(cols[1]);
    if (!fecha) continue;

    const referencia = cols[2].trim();

    if (tipo === 'CR') {
      if (esExcluido(descripcion)) continue;
      results.push({
        fecha_transaccion: fecha,
        descripcion: limpiarDescripcion(descripcion),
        referencia: elegirReferencia(referencia, serial),
        cuenta_origen: extraerCuentaOrigen(referencia, descripcion),
        monto,
        moneda: 'DOP',
        tipo: 'CREDITO',
      });
    } else if (tipo === 'DB' && esChequeDevuelto(descripcion)) {
      results.push({
        fecha_transaccion: fecha,
        descripcion: limpiarDescripcion(descripcion),
        referencia: elegirReferencia(referencia, serial),
        cuenta_origen: '',
        monto,
        moneda: 'DOP',
        tipo: 'CHEQUE_DEVUELTO',
      });
    }
  }
  return results;
}

// --- Run tests ---
const extractosDir = 'E:\\IA\\cobranzas-guipak\\Extractos';

console.log('=== TEST PARSER BANCO POPULAR ===\n');

// Test CSV
const csvFile = join(extractosDir, 'Banco Popular Dominicano 228.csv');
const csvText = readFileSync(csvFile, 'utf-8');
const csvFmt = esBancoPopular(csvText);
console.log(`CSV detectado como: ${csvFmt}`);
const csvResults = parsearCSV(csvText);
const csvCreditos = csvResults.filter(r => r.tipo === 'CREDITO');
const csvDevueltos = csvResults.filter(r => r.tipo === 'CHEQUE_DEVUELTO');
console.log(`CSV: ${csvCreditos.length} créditos + ${csvDevueltos.length} cheques devueltos = ${csvResults.length} total`);
const csvTotal = csvCreditos.reduce((s, r) => s + r.monto, 0);
const csvTotalDev = csvDevueltos.reduce((s, r) => s + r.monto, 0);
console.log(`CSV: Monto créditos: RD$ ${csvTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`);
console.log(`CSV: Monto cheques devueltos: RD$ ${csvTotalDev.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`);

if (csvDevueltos.length > 0) {
  console.log('\n⚠️  CHEQUES DEVUELTOS:');
  csvDevueltos.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.fecha_transaccion} | RD$ ${r.monto.toFixed(2).padStart(12)} | ref: ${r.referencia.padEnd(15)} | ${r.descripcion}`);
  });
}

console.log('\nPrimeras 5 créditos CSV:');
csvCreditos.slice(0, 5).forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.fecha_transaccion} | RD$ ${r.monto.toFixed(2).padStart(12)} | ref: ${r.referencia.padEnd(15)} | cuenta: ${r.cuenta_origen.padEnd(15)} | ${r.descripcion.substring(0, 60)}`);
});

console.log('\n---\n');

// Test TXT
const txtFile = join(extractosDir, 'Banco Popular Dominicano 228.txt');
const txtText = readFileSync(txtFile, 'utf-8');
const txtFmt = esBancoPopular(txtText);
console.log(`TXT detectado como: ${txtFmt}`);
const txtResults = parsearTXT(txtText);
const txtCreditos = txtResults.filter(r => r.tipo === 'CREDITO');
const txtDevueltos = txtResults.filter(r => r.tipo === 'CHEQUE_DEVUELTO');
console.log(`TXT: ${txtCreditos.length} créditos + ${txtDevueltos.length} cheques devueltos = ${txtResults.length} total`);
const txtTotal = txtCreditos.reduce((s, r) => s + r.monto, 0);
console.log(`TXT: Monto créditos: RD$ ${txtTotal.toLocaleString('es-DO', { minimumFractionDigits: 2 })}`);
console.log('\nPrimeras 5 créditos TXT:');
txtCreditos.slice(0, 5).forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.fecha_transaccion} | RD$ ${r.monto.toFixed(2).padStart(12)} | ref: ${r.referencia.padEnd(15)} | cuenta: ${r.cuenta_origen.padEnd(15)} | ${r.descripcion.substring(0, 60)}`);
});

console.log('\n---\n');

// Compare
console.log('=== COMPARACIÓN CSV vs TXT ===');
console.log(`CSV: ${csvResults.length} total (${csvCreditos.length} créditos + ${csvDevueltos.length} devueltos), RD$ ${csvTotal.toFixed(2)} créditos`);
console.log(`TXT: ${txtResults.length} total (${txtCreditos.length} créditos + ${txtDevueltos.length} devueltos), RD$ ${txtTotal.toFixed(2)} créditos`);
console.log(`Match cantidad: ${csvResults.length === txtResults.length ? 'SÍ ✓' : 'NO ✗'}`);
console.log(`Match monto créditos: ${Math.abs(csvTotal - txtTotal) < 0.01 ? 'SÍ ✓' : `NO ✗ (diff: ${(csvTotal - txtTotal).toFixed(2)})`}`);
console.log(`Match cheques devueltos: ${csvDevueltos.length === txtDevueltos.length ? 'SÍ ✓' : 'NO ✗'}`);

const conCuenta = csvCreditos.filter(r => r.cuenta_origen).length;
const sinCuenta = csvCreditos.filter(r => !r.cuenta_origen).length;
console.log(`\nCuentas origen extraídas: ${conCuenta}/${csvCreditos.length} créditos (${sinCuenta} sin cuenta)`);

console.log('\nTransacciones SIN cuenta origen:');
csvResults.filter(r => !r.cuenta_origen).forEach((r, i) => {
  console.log(`  ${i + 1}. RD$ ${r.monto.toFixed(2).padStart(12)} | ${r.descripcion.substring(0, 70)}`);
});
