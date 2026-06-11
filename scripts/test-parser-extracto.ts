/* Test manual del parser de extractos (npx tsx scripts/test-parser-extracto.ts) */
import ExcelJS from 'exceljs';
import { parsearExtracto } from '../lib/utils/parser-extracto';

async function main() {
  // Test 1: xlsx con fecha Date, monto con comas como texto y monto numérico
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['Fecha', 'Descripcion', 'Referencia', 'Monto Credito', 'Cuenta Origen']);
  ws.addRow([new Date(Date.UTC(2026, 5, 10)), 'TRANSFERENCIA CLIENTE A', 'REF001', '1,234.56', '123456789']);
  ws.addRow([new Date(Date.UTC(2026, 5, 11)), 'PAGO CLIENTE B', 'REF002', 50000, '987654321']);
  ws.addRow([new Date(Date.UTC(2026, 5, 11)), 'CARGO (debito)', 'REF003', -200, '111']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const lineas = await parsearExtracto(buf, 'extracto.xlsx');
  console.log('XLSX:', JSON.stringify(lineas));
  if (lineas.length !== 2) throw new Error('esperaba 2 lineas xlsx, hay ' + lineas.length);
  if (lineas[0].monto !== 1234.56) throw new Error('monto con comas mal parseado: ' + lineas[0].monto);
  if (lineas[0].fecha_transaccion !== '2026-06-10') throw new Error('fecha mal: ' + lineas[0].fecha_transaccion);

  // Test 2: CSV genérico con campo entrecomillado con comas
  const csv =
    'Fecha,Descripcion,Referencia,Monto,Cuenta\n' +
    '10/06/2026,"DEPOSITO, SUCURSAL CENTRO",R1,"2,500.00",555\n' +
    '11/06/2026,PAGO X,R2,0,666\n';
  const lineasCsv = await parsearExtracto(Buffer.from(csv), 'extracto.csv');
  console.log('CSV:', JSON.stringify(lineasCsv));
  if (lineasCsv.length !== 1) throw new Error('esperaba 1 linea csv, hay ' + lineasCsv.length);
  if (lineasCsv[0].monto !== 2500) throw new Error('monto csv mal: ' + lineasCsv[0].monto);
  if (lineasCsv[0].descripcion !== 'DEPOSITO, SUCURSAL CENTRO')
    throw new Error('descripcion con coma mal: ' + lineasCsv[0].descripcion);

  console.log('TODOS LOS TESTS PASAN');
}

main().catch((e) => {
  console.error('FALLO:', e.message);
  process.exit(1);
});
