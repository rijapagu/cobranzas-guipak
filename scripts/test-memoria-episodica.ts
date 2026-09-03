/**
 * Test de memoria episódica (Fase 4) contra la DB de cobranzas real:
 * lib/telegram/historial.ts (guardarMensaje/buscarHistorial) y
 * lib/cobranzas/linea-tiempo.ts (lineaDeTiempoCliente).
 *
 * Inserta sus PROPIAS filas de prueba (chat_ids y codigo_cliente sintéticos
 * que no colisionan con datos reales) y limpia todo en un finally, pase o
 * falle el test.
 *
 * Uso: npx tsx scripts/test-memoria-episodica.ts
 */
import { readFileSync } from 'node:fs';

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

// chat_ids negativos grandes y fuera de rango real de Telegram, para no
// colisionar con un grupo o usuario de verdad.
const CHAT_PROPIO = -900001;
const CHAT_AJENO = -900002;
const CODIGO_CLIENTE_TEST = 'TEST8888';

async function main() {
  cargarEnv();

  const { cobranzasExecute } = await import('../lib/db/cobranzas');
  const { guardarMensaje, buscarHistorial } = await import('../lib/telegram/historial');
  const { lineaDeTiempoCliente } = await import('../lib/cobranzas/linea-tiempo');

  const limpiar = async () => {
    await cobranzasExecute(
      'DELETE FROM cobranza_telegram_historial WHERE chat_id IN (?, ?)',
      [CHAT_PROPIO, CHAT_AJENO]
    );
    await cobranzasExecute(
      "DELETE FROM cobranza_disputas WHERE empresa_id = 1 AND codigo_cliente = ?",
      [CODIGO_CLIENTE_TEST]
    );
    await cobranzasExecute(
      "DELETE FROM cobranza_acuerdos WHERE empresa_id = 1 AND codigo_cliente = ?",
      [CODIGO_CLIENTE_TEST]
    );
  };

  console.log('\n=== TEST memoria episódica (historial.ts + linea-tiempo.ts, DB real) ===\n');
  await limpiar();

  try {
    console.log('[setup] guardando mensajes de prueba');
    await guardarMensaje(CHAT_PROPIO, 111, 'usuario', 'cuánto debe Padron Office este mes', CODIGO_CLIENTE_TEST);
    await guardarMensaje(CHAT_PROPIO, 111, 'asistente', 'Padron Office debe RD$50,000', CODIGO_CLIENTE_TEST);
    await guardarMensaje(CHAT_PROPIO, 111, 'usuario', 'ok gracias', null);
    await guardarMensaje(CHAT_AJENO, 222, 'usuario', 'esto es de otro chat, no debe verse', CODIGO_CLIENTE_TEST);

    console.log('\n[1] buscarHistorial por término (FULLTEXT, 3+ letras)');
    const r1 = await buscarHistorial({ termino: 'Padron', chatIds: [CHAT_PROPIO] });
    assert(r1.length === 2, 'encuentra los 2 mensajes que mencionan "Padron"', `encontró ${r1.length}`);

    console.log('\n[2] buscarHistorial por término corto (<3 letras, cae a LIKE)');
    const r2 = await buscarHistorial({ termino: 'ok', chatIds: [CHAT_PROPIO] });
    assert(r2.some((m) => m.contenido === 'ok gracias'), 'LIKE encuentra "ok gracias" con término de 2 letras');

    console.log('\n[3] buscarHistorial respeta chatIds — no ve el chat ajeno');
    const r3 = await buscarHistorial({ termino: 'Padron', chatIds: [CHAT_PROPIO] });
    assert(
      !r3.some((m) => m.contenido.includes('otro chat')),
      'el mensaje del CHAT_AJENO no aparece cuando chatIds solo incluye CHAT_PROPIO'
    );
    const r3b = await buscarHistorial({ termino: 'Padron', chatIds: [CHAT_AJENO] });
    assert(
      r3b.some((m) => m.contenido.includes('otro chat')),
      'sí aparece cuando chatIds incluye explícitamente CHAT_AJENO (confirma que el filtro funciona en ambos sentidos)'
    );

    console.log('\n[4] buscarHistorial filtra por codigo_cliente');
    const r4 = await buscarHistorial({ codigoCliente: CODIGO_CLIENTE_TEST, chatIds: [CHAT_PROPIO, CHAT_AJENO] });
    assert(r4.length === 3, 'trae los 3 mensajes etiquetados con el cliente de prueba', `encontró ${r4.length}`);
    assert(
      !r4.some((m) => m.contenido === 'ok gracias'),
      'no trae el mensaje sin codigo_cliente (sesión no activa en ese turno)'
    );

    console.log('\n[5] buscarHistorial sin chatIds devuelve vacío (no explota)');
    const r5 = await buscarHistorial({ termino: 'Padron', chatIds: [] });
    assert(r5.length === 0, 'chatIds=[] devuelve [] sin consultar la DB');

    console.log('\n[6] lineaDeTiempoCliente cruza fuentes (disputa + promesa + historial)');
    await cobranzasExecute(
      `INSERT INTO cobranza_disputas (empresa_id, codigo_cliente, ij_inum, motivo, estado, registrado_por)
       VALUES (1, ?, 999999, 'PRUEBA test-memoria-episodica', 'ABIERTA', 'test-suite')`,
      [CODIGO_CLIENTE_TEST]
    );
    await cobranzasExecute(
      `INSERT INTO cobranza_acuerdos (empresa_id, codigo_cliente, ij_inum, monto_prometido, fecha_prometida, estado)
       VALUES (1, ?, 999999, 1000, CURDATE(), 'PENDIENTE')`,
      [CODIGO_CLIENTE_TEST]
    );

    const eventos = await lineaDeTiempoCliente(CODIGO_CLIENTE_TEST);
    const tipos = new Set(eventos.map((e) => e.tipo));
    assert(tipos.has('DISPUTA'), 'incluye el evento DISPUTA', [...tipos].join(','));
    assert(tipos.has('PROMESA'), 'incluye el evento PROMESA', [...tipos].join(','));
    assert(tipos.has('MENSAJE'), 'incluye los MENSAJE del historial', [...tipos].join(','));
    assert(
      eventos.every((e, i) => i === 0 || new Date(e.fecha).getTime() <= new Date(eventos[i - 1].fecha).getTime()),
      'los eventos vienen ordenados por fecha DESC'
    );

    console.log('\n[7] lineaDeTiempoCliente respeta el filtro de fechas (hasta ayer no debe traer nada de hoy)');
    const eventosFiltrados = await lineaDeTiempoCliente(CODIGO_CLIENTE_TEST, { hasta: '2020-01-01' });
    assert(eventosFiltrados.length === 0, 'con hasta=2020-01-01 no trae los eventos de hoy', `trajo ${eventosFiltrados.length}`);
  } finally {
    await limpiar();
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
