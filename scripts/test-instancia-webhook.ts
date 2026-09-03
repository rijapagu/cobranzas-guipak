/* Filtro por instancia del webhook de WhatsApp (npx tsx scripts/test-instancia-webhook.ts) */
import { verificarInstancia } from '../lib/evolution/instancia';

const INSTANCIA = 'AsistenteGuipak';

function chequear(nombre: string, condicion: boolean) {
  if (!condicion) throw new Error(nombre);
  console.log('  ok —', nombre);
}

function main() {
  // 1. Camino feliz: el evento viene de nuestra instancia.
  const propio = verificarInstancia(INSTANCIA, INSTANCIA);
  chequear('acepta un evento de nuestra propia instancia', propio.aceptar === true);

  // 2. El bug que se arregla: otra instancia del MISMO servidor de Evolution.
  //    Antes entraba y podia generar una promesa de pago a nombre de un cliente real.
  const ajeno = verificarInstancia('AsistenteCompras', INSTANCIA);
  chequear('descarta un evento de otra instancia', ajeno.aceptar === false);
  chequear(
    'el descarte por instancia ajena dice por que',
    ajeno.aceptar === false && ajeno.motivo === 'otra-instancia'
  );
  chequear(
    'el descarte conserva la instancia recibida para el log',
    ajeno.aceptar === false && ajeno.recibida === 'AsistenteCompras'
  );

  // 3. Payload sin `instance` (version vieja de Evolution, o cuerpo manipulado):
  //    no se puede verificar el origen -> no se procesa.
  for (const raro of [undefined, null, '', '   ', 42, {}, ['AsistenteGuipak']]) {
    const v = verificarInstancia(raro, INSTANCIA);
    chequear(
      `descarta payload con instance = ${JSON.stringify(raro) ?? 'undefined'}`,
      v.aceptar === false && v.motivo === 'otra-instancia'
    );
  }

  // 4. Fail-closed: sin instancia esperada configurada NO se acepta nada,
  //    ni siquiera un evento que traiga una instancia con pinta valida.
  for (const sinConfig of [undefined, null, '', '   ']) {
    const v = verificarInstancia(INSTANCIA, sinConfig);
    chequear(
      `sin EVOLUTION_INSTANCE configurada descarta (${JSON.stringify(sinConfig) ?? 'undefined'})`,
      v.aceptar === false && v.motivo === 'sin-instancia-configurada'
    );
  }

  // 5. Espacios sobrantes en la env var no deben romper el filtro.
  chequear(
    'tolera espacios alrededor de la instancia esperada',
    verificarInstancia(INSTANCIA, `  ${INSTANCIA}  `).aceptar === true
  );
  chequear(
    'tolera espacios alrededor de la instancia recibida',
    verificarInstancia(`  ${INSTANCIA}  `, INSTANCIA).aceptar === true
  );

  // 6. La comparacion distingue mayusculas: son identificadores, no texto libre.
  chequear(
    'no acepta la instancia con otra capitalizacion',
    verificarInstancia('asistenteguipak', INSTANCIA).aceptar === false
  );

  console.log('TODOS LOS TESTS PASAN');
}

try {
  main();
} catch (e) {
  console.error('FALLO:', e instanceof Error ? e.message : e);
  process.exit(1);
}
