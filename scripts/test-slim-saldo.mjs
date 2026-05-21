// Test aislado de la logica slim de consultarSaldoCliente.
// No toca DB — verifica que el algoritmo produce: top-5 + segmentos + flag.
//
// Uso: node scripts/test-slim-saldo.mjs
// Espera: 4 asserts en verde y un dump del shape final.

const TOP_FACTURAS_DEFAULT = 5;

// Replica EXACTA de la logica que esta en consultarSaldoCliente:
function calcularSlim(facturas, mostrarTodas) {
  const facturasPorSegmento = { VERDE: 0, AMARILLO: 0, NARANJA: 0, ROJO: 0 };
  for (const f of facturas) {
    const d = Number(f.dias_vencida);
    if (d <= 0) facturasPorSegmento.VERDE++;
    else if (d <= 15) facturasPorSegmento.AMARILLO++;
    else if (d <= 30) facturasPorSegmento.NARANJA++;
    else facturasPorSegmento.ROJO++;
  }
  const facturasMostradas = mostrarTodas
    ? facturas
    : facturas.slice(0, TOP_FACTURAS_DEFAULT);
  return {
    total_facturas: facturas.length,
    facturas_por_segmento: facturasPorSegmento,
    facturas: facturasMostradas.map((f) => ({
      factura: f.factura,
      fecha_vence: f.fecha_vence,
      dias_vencida: Number(f.dias_vencida),
      saldo: Number(f.saldo),
    })),
    facturas_truncadas:
      !mostrarTodas && facturas.length > TOP_FACTURAS_DEFAULT,
  };
}

// Dataset sintetico: 30 facturas con distribucion realista por segmento.
// Ordenadas por fecha_vence ASC (lo que devuelve el SQL real).
const mockFacturas = [];
for (let i = 0; i < 30; i++) {
  // Reparto: 2 VERDE (dias <=0), 5 AMARILLO (1-15), 8 NARANJA (16-30), 15 ROJO (>30)
  let dias;
  if (i < 15) dias = 31 + (15 - i) * 5; // ROJO, mas vencido primero
  else if (i < 23) dias = 30 - (i - 15) * 2; // NARANJA
  else if (i < 28) dias = 15 - (i - 23) * 3; // AMARILLO
  else dias = -1 * (i - 28); // VERDE
  mockFacturas.push({
    factura: 20000 + i,
    fecha_vence: new Date(Date.now() - dias * 86400000).toISOString().split('T')[0],
    dias_vencida: dias,
    saldo: 1000 + i * 100,
  });
}

console.log(`Input: ${mockFacturas.length} facturas`);

// --- Caso 1: default (slim) ---
const slim = calcularSlim(mockFacturas, false);
const okSlim =
  slim.facturas.length === 5 &&
  slim.facturas_truncadas === true &&
  slim.total_facturas === 30 &&
  slim.facturas_por_segmento.VERDE === 2 &&
  slim.facturas_por_segmento.AMARILLO === 5 &&
  slim.facturas_por_segmento.NARANJA === 8 &&
  slim.facturas_por_segmento.ROJO === 15;

console.log(`\n[Test 1: default slim]`);
console.log(`  facturas.length === 5:      ${slim.facturas.length === 5 ? 'OK' : 'FAIL (' + slim.facturas.length + ')'}`);
console.log(`  facturas_truncadas:         ${slim.facturas_truncadas === true ? 'OK' : 'FAIL'}`);
console.log(`  total_facturas === 30:      ${slim.total_facturas === 30 ? 'OK' : 'FAIL'}`);
console.log(`  segmentos (V/A/N/R 2/5/8/15): ${JSON.stringify(slim.facturas_por_segmento)} ${okSlim ? 'OK' : 'FAIL'}`);

// --- Caso 2: mostrar_todas=true ---
const full = calcularSlim(mockFacturas, true);
const okFull =
  full.facturas.length === 30 &&
  full.facturas_truncadas === false &&
  full.total_facturas === 30;

console.log(`\n[Test 2: mostrar_todas=true]`);
console.log(`  facturas.length === 30:     ${full.facturas.length === 30 ? 'OK' : 'FAIL'}`);
console.log(`  facturas_truncadas === false: ${full.facturas_truncadas === false ? 'OK' : 'FAIL'}`);

// --- Caso 3: pocas facturas (3) — no truncar ---
const pocas = calcularSlim(mockFacturas.slice(0, 3), false);
const okPocas =
  pocas.facturas.length === 3 &&
  pocas.facturas_truncadas === false &&
  pocas.total_facturas === 3;

console.log(`\n[Test 3: 3 facturas (sin truncar)]`);
console.log(`  facturas.length === 3:        ${pocas.facturas.length === 3 ? 'OK' : 'FAIL'}`);
console.log(`  facturas_truncadas === false: ${pocas.facturas_truncadas === false ? 'OK' : 'FAIL'}`);

// --- Caso 4: tamano del payload (la metrica que importa) ---
const slimJsonSize = JSON.stringify(slim).length;
const fullJsonSize = JSON.stringify(full).length;
const reduccion = (1 - slimJsonSize / fullJsonSize) * 100;

console.log(`\n[Test 4: tamano del tool_result (bytes JSON)]`);
console.log(`  full (30 facturas):  ${fullJsonSize} bytes`);
console.log(`  slim (5 facturas):   ${slimJsonSize} bytes`);
console.log(`  Reduccion:           ${reduccion.toFixed(1)}%`);

const todoOk = okSlim && okFull && okPocas;
console.log(`\n${todoOk ? '✓ TODOS OK' : '✗ FALLOS'}`);

if (!todoOk) process.exit(1);
