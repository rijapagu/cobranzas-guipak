/**
 * Test de lib/conciliacion/acciones.ts contra la DB de cobranzas real.
 *
 * Inserta su PROPIA fila de prueba en cobranza_conciliacion (empresa_id=1,
 * cuenta_origen sintética que no colisiona con bancos reales) y la lleva
 * DESCONOCIDO -> POR_APLICAR -> CONCILIADO con las mismas funciones que usan
 * la web y el agente conversacional. Limpia todo lo que creó (incluida la
 * fila de aprendizaje) en un finally, pase o falle el test.
 *
 * Uso: npx tsx scripts/test-conciliacion-acciones.ts
 */
import { readFileSync } from 'node:fs';

// Cargar .env.local ANTES de importar lib/db/cobranzas (el pool se
// inicializa al cargar el módulo) — mismo patrón que test-saldo-favor.ts.
function cargarEnv() {
  let envContent = '';
  try {
    envContent = readFileSync('.env.local', 'utf8');
  } catch {
    envContent = readFileSync('../../../.env.local', 'utf8');
  }
  // split en \r?\n: .env.local tiene CRLF -- con split('\n') a secas cada
  // línea queda con un \r colgando al final, y como `.` en JS no matchea
  // \r, la regex de abajo nunca hace match y NINGUNA variable se carga.
  for (const line of envContent.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim();
    }
  }
}

let failures = 0;
function assert(cond: boolean, label: string, detalle?: string) {
  if (cond) {
    console.log(`    OK    ${label}`);
  } else {
    failures++;
    console.error(`    FAIL  ${label}${detalle ? ' — ' + detalle : ''}`);
  }
}

const CUENTA_ORIGEN_TEST = 'TEST-ACCIONES-CONCILIACION-9999';
const ARCHIVO_TEST = 'test-acciones-conciliacion.xlsx';
const CODIGO_CLIENTE_TEST = 'TEST9999';
const ACTOR = { userId: 'test-suite', userEmail: 'test-suite@local' };

async function main() {
  cargarEnv();

  const { cobranzasQuery, cobranzasExecute } = await import('../lib/db/cobranzas');
  const { asignarClienteADeposito, aprobarDeposito, listarDepositosPendientes } = await import(
    '../lib/conciliacion/acciones'
  );

  const limpiar = async (depositoId?: number | null) => {
    await cobranzasExecute(
      'DELETE FROM cobranza_cuentas_aprendizaje WHERE empresa_id = 1 AND cuenta_origen = ?',
      [CUENTA_ORIGEN_TEST]
    );
    if (depositoId) {
      await cobranzasExecute('DELETE FROM cobranza_conciliacion WHERE id = ?', [depositoId]);
    } else {
      await cobranzasExecute(
        'DELETE FROM cobranza_conciliacion WHERE empresa_id = 1 AND cuenta_origen = ?',
        [CUENTA_ORIGEN_TEST]
      );
    }
  };

  console.log('\n=== TEST lib/conciliacion/acciones.ts (DB real) ===\n');

  // Por si una corrida anterior murió a mitad de camino.
  await limpiar();

  let depositoId: number | null = null;
  try {
    const insertado = await cobranzasExecute(
      `INSERT INTO cobranza_conciliacion
         (empresa_id, fecha_extracto, banco, archivo_origen, fecha_transaccion,
          descripcion, referencia, cuenta_origen, monto, moneda, estado, cargado_por)
       VALUES (1, CURDATE(), 'TEST', ?, CURDATE(),
               'PRUEBA test-conciliacion-acciones', 'REF-TEST-9999', ?, 12345.67, 'DOP', 'DESCONOCIDO', 'test-suite')`,
      [ARCHIVO_TEST, CUENTA_ORIGEN_TEST]
    );
    depositoId = insertado.insertId;
    console.log(`[setup] depósito de prueba insertado: id=${depositoId}`);

    console.log('\n[1] listarDepositosPendientes lo encuentra');
    const listado = await listarDepositosPendientes({ estado: 'DESCONOCIDO', archivo: ARCHIVO_TEST });
    assert(
      listado.some((d) => d.id === depositoId),
      'el depósito de prueba aparece en el listado'
    );

    console.log('\n[2] asignarClienteADeposito: DESCONOCIDO -> POR_APLICAR');
    const r1 = await asignarClienteADeposito(depositoId, CODIGO_CLIENTE_TEST, 'CLIENTE DE PRUEBA', ACTOR);
    assert(r1.ok, 'devuelve ok:true', r1.mensaje);

    const filaTrasAsignar = await cobranzasQuery<{ estado: string; codigo_cliente: string | null }>(
      'SELECT estado, codigo_cliente FROM cobranza_conciliacion WHERE id = ?',
      [depositoId]
    );
    assert(filaTrasAsignar[0]?.estado === 'POR_APLICAR', 'estado pasó a POR_APLICAR', filaTrasAsignar[0]?.estado);
    assert(filaTrasAsignar[0]?.codigo_cliente === CODIGO_CLIENTE_TEST, 'codigo_cliente quedó asignado');

    const aprendizaje = await cobranzasQuery<{ confianza: string }>(
      'SELECT confianza FROM cobranza_cuentas_aprendizaje WHERE empresa_id = 1 AND cuenta_origen = ?',
      [CUENTA_ORIGEN_TEST]
    );
    assert(aprendizaje.length === 1, 'CP-05: se creó una fila de aprendizaje para la cuenta');
    assert(aprendizaje[0]?.confianza === 'MANUAL', 'CP-05: nace en confianza MANUAL', aprendizaje[0]?.confianza);

    console.log('\n[3] Reintentar asignar sobre un depósito que ya no está DESCONOCIDO');
    const r2 = await asignarClienteADeposito(depositoId, CODIGO_CLIENTE_TEST, 'CLIENTE DE PRUEBA', ACTOR);
    assert(!r2.ok, 'la segunda asignación falla (ya no está DESCONOCIDO)', r2.mensaje);

    console.log('\n[4] aprobarDeposito: POR_APLICAR -> CONCILIADO');
    const r3 = await aprobarDeposito(depositoId, ACTOR);
    assert(r3.ok, 'devuelve ok:true', r3.mensaje);

    const filaFinal = await cobranzasQuery<{ estado: string; aprobado_por: string | null }>(
      'SELECT estado, aprobado_por FROM cobranza_conciliacion WHERE id = ?',
      [depositoId]
    );
    assert(filaFinal[0]?.estado === 'CONCILIADO', 'estado final es CONCILIADO', filaFinal[0]?.estado);
    assert(filaFinal[0]?.aprobado_por === ACTOR.userEmail, 'aprobado_por quedó registrado');

    console.log('\n[5] aprobarDeposito de nuevo sobre un depósito ya CONCILIADO');
    const r4 = await aprobarDeposito(depositoId, ACTOR);
    assert(!r4.ok, 'la segunda aprobación falla (ya no está POR_APLICAR)', r4.mensaje);

    console.log('\n[6] Ids inexistentes responden con error claro, no una excepción');
    const r5 = await asignarClienteADeposito(999999999, 'X', 'X', ACTOR);
    assert(!r5.ok && r5.mensaje.includes('no encontrado'), 'asignar sobre id inexistente -> "no encontrado"');
    const r6 = await aprobarDeposito(999999999, ACTOR);
    assert(!r6.ok && r6.mensaje.includes('no encontrado'), 'aprobar sobre id inexistente -> "no encontrado"');
  } finally {
    await limpiar(depositoId);
  }

  console.log();
  if (failures === 0) {
    console.log('=== TODOS OK ===');
    process.exit(0);
  } else {
    console.error(`=== ${failures} ASSERT(S) FALLARON ===`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('ERROR FATAL:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
