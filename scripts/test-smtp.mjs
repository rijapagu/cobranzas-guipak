/**
 * Test SMTP — envía un correo real para verificar entrega.
 *
 * Uso:
 *   node scripts/test-smtp.mjs [destinatario]
 *
 * Si no se pasa destinatario, usa SMTP_USER (cobros@guipak.com).
 *
 * Variables de entorno requeridas:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *
 * Ejemplo con .env.local:
 *   node -r dotenv/config scripts/test-smtp.mjs tu@correo.com dotenv_config_path=.env.local
 */

import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT) || 465;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || user;
const to = process.argv[2] || user;

if (!host || !user || !pass) {
  console.error('❌ Faltan variables de entorno: SMTP_HOST, SMTP_USER, SMTP_PASS');
  console.error('   Ejemplo: node -r dotenv/config scripts/test-smtp.mjs dotenv_config_path=.env.local');
  process.exit(1);
}

console.log(`\n📧 Probando SMTP...`);
console.log(`   Host:  ${host}:${port} (SSL: ${port === 465})`);
console.log(`   Usuario: ${user}`);
console.log(`   Destino: ${to}`);

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: { user, pass },
  connectionTimeout: 10000,
});

// Paso 1: verificar conexión/auth
process.stdout.write('\n1. Verificando conexión y credenciales... ');
try {
  await transporter.verify();
  console.log('✅ OK');
} catch (err) {
  console.log('❌ FALLÓ');
  console.error('   Error:', err.message);
  console.error('\n💡 Posibles causas:');
  console.error('   - Contraseña incorrecta');
  console.error('   - Puerto/SSL mal configurado (prueba con 587 + secure:false si 465 falla)');
  console.error('   - El servidor bloquea la IP del VPS');
  process.exit(1);
}

// Paso 2: enviar correo de prueba
process.stdout.write('2. Enviando correo de prueba... ');
try {
  const info = await transporter.sendMail({
    from: `"Cobros Guipak (test)" <${from}>`,
    to,
    subject: `✅ SMTP funciona — ${new Date().toLocaleString('es-DO', { timeZone: 'America/Santo_Domingo' })}`,
    text: `Este es un correo de prueba del sistema de cobranzas Guipak.\n\nFecha: ${new Date().toISOString()}\nServidor: ${host}:${port}\nUsuario: ${user}\n\nSi recibes este correo, el SMTP está funcionando correctamente.`,
    html: `<p>Este es un correo de prueba del <b>Sistema de Cobranzas Guipak</b>.</p>
<ul>
  <li>Fecha: ${new Date().toISOString()}</li>
  <li>Servidor: ${host}:${port}</li>
  <li>Usuario: ${user}</li>
</ul>
<p>Si recibes este correo, el SMTP está funcionando correctamente. ✅</p>`,
  });

  console.log('✅ ENVIADO');
  console.log(`   Message-ID: ${info.messageId}`);
  console.log(`\n✅ Todo OK. Revisa el buzón de ${to}`);
  console.log('   (Si no llega en 2 min, revisa carpeta de spam)');
} catch (err) {
  console.log('❌ FALLÓ al enviar');
  console.error('   Error:', err.message);
  process.exit(1);
}
