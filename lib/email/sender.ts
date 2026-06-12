/**
 * Cliente Email — Envío via SMTP/Nodemailer.
 *
 * Fase 3 Etapa 3: el SMTP se resuelve POR EMPRESA (lib/empresas/config).
 * Guipak (empresa 1, default) sigue usando las variables de entorno.
 */

import nodemailer from 'nodemailer';
import { configDeEmpresa } from '@/lib/empresas/config';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

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
  htmlBody?: string,
  empresaId: number = EMPRESA_GUIPAK
): Promise<EnvioEmailResult> {
  const config = await configDeEmpresa(empresaId);
  const smtp = config.smtp;

  if (!smtp) {
    const origen = empresaId === EMPRESA_GUIPAK
      ? 'Configura las variables de entorno SMTP_* en el servidor.'
      : 'Configura el SMTP de la empresa en Configuración → Mi empresa.';
    console.error(`[EMAIL] Empresa ${empresaId} sin SMTP configurado — correo NO enviado a ${to}`);
    return {
      messageId: '',
      status: 'failed',
      error: `Configuración SMTP incompleta. ${origen}`,
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    });

    const info = await transporter.sendMail({
      from: `"${smtp.nombreRemitente}" <${smtp.from}>`,
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
