/**
 * Cliente Email — Envío via SMTP/Nodemailer.
 */

import nodemailer from 'nodemailer';

interface EnvioEmailResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Envía un email via SMTP.
 * - `body`: texto plano (fallback y conversión automática a HTML básico).
 * - `htmlBody`: HTML completo (si se provee, se usa en lugar del body convertido).
 * - `attachments`: adjuntos opcionales.
 */
export async function enviarEmail(
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[],
  htmlBody?: string
): Promise<EnvioEmailResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'cobros@guipak.com';

  if (!host || !user || !pass) {
    const faltante = [!host && 'SMTP_HOST', !user && 'SMTP_USER', !pass && 'SMTP_PASS'].filter(Boolean).join(', ');
    console.error(`[EMAIL] Sin credenciales SMTP (${faltante}) — correo NO enviado a ${to}`);
    return {
      messageId: '',
      status: 'failed',
      error: `Configuración SMTP incompleta: falta ${faltante}. Configura las variables de entorno en el servidor.`,
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
      html: htmlBody || body.replace(/\n/g, '<br>'),
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
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
