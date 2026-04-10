/**
 * Cliente Email — Envío via SMTP/Nodemailer.
 */

import nodemailer from 'nodemailer';

interface EnvioEmailResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Envía un email via SMTP.
 * Si no hay credenciales SMTP, retorna mock exitoso.
 */
export async function enviarEmail(
  to: string,
  subject: string,
  body: string
): Promise<EnvioEmailResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'cobros@guipak.com';

  if (!host || !user || !pass) {
    console.log('[EMAIL] Mock: Sin credenciales SMTP, simulando envío a', to);
    return {
      messageId: `mock_email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const info = await transporter.sendMail({
      from: `"Cobros Guipak" <${from}>`,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });

    return {
      messageId: info.messageId || `smtp_${Date.now()}`,
      status: 'sent',
    };
  } catch (error) {
    console.error('[EMAIL] Error enviando:', error);
    return {
      messageId: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}
