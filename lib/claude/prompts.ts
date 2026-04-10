/**
 * Prompts para Claude AI — Generación de mensajes de cobranza
 * CP-10: Este módulo solo genera texto, nunca envía mensajes.
 */

import type { SegmentoRiesgo } from '@/lib/types/cartera';
import type { ContextoCobranza } from '@/lib/types/cobranzas';
import { formatMonto } from '@/lib/utils/formato';

const TONOS: Record<SegmentoRiesgo, string> = {
  VERDE: `Tono: Amigable y preventivo. Es un recordatorio cordial antes del vencimiento.
Objetivo: Informar que la factura está por vencer para facilitar el pago a tiempo.
No presionar. Ser cortés y breve.`,

  AMARILLO: `Tono: Cordial pero con urgencia moderada. La factura ya venció hace pocos días.
Objetivo: Recordar amablemente que hay un saldo pendiente y solicitar fecha de pago.
Mantener la buena relación comercial.`,

  NARANJA: `Tono: Formal y directo. La factura lleva 16-30 días vencida.
Objetivo: Solicitar pago inmediato o un acuerdo de pago con fecha específica.
Mencionar que la cuenta está en gestión de cobranza.`,

  ROJO: `Tono: Firme y urgente. La factura lleva más de 30 días vencida.
Objetivo: Exigir pago inmediato. Mencionar que se han enviado recordatorios previos.
Advertir que la cuenta puede pasar a gestión legal si no se resuelve.
Mantener profesionalismo, sin amenazas, pero con firmeza.`,
};

export function buildPromptCobranza(ctx: ContextoCobranza): string {
  const montoFormateado = formatMonto(ctx.saldo_pendiente, ctx.moneda);
  const contacto = ctx.contacto_cobros || ctx.nombre_cliente;

  let historialTexto = '';
  if (ctx.historial_gestiones && ctx.historial_gestiones.length > 0) {
    historialTexto = `\n\nHistorial de gestiones anteriores con este cliente:\n${ctx.historial_gestiones.join('\n')}`;
  }

  return `Eres un asistente de cobranzas para Suministros Guipak, S.R.L., una empresa distribuidora en República Dominicana.

Genera DOS mensajes de cobranza para el siguiente caso:

DATOS DE LA FACTURA:
- Cliente: ${ctx.nombre_cliente}
- Contacto de cobros: ${contacto}
- Código cliente: ${ctx.codigo_cliente}
- Factura #${ctx.numero_factura}
- NCF: ${ctx.ncf_fiscal}
- Saldo pendiente: ${montoFormateado}
- Moneda: ${ctx.moneda}
- Días vencido: ${ctx.dias_vencido}
- Fecha vencimiento: ${ctx.fecha_vencimiento}
- Segmento: ${ctx.segmento_riesgo}
${ctx.tiene_pdf ? '- La factura tiene PDF adjunto disponible' : ''}
${historialTexto}

INSTRUCCIONES DE TONO:
${TONOS[ctx.segmento_riesgo]}

GENERA:

1. **MENSAJE WHATSAPP**: Máximo 300 caracteres. Directo, sin saludo formal largo. Incluir monto y número de factura. Si hay PDF, mencionar que puede solicitar copia.

2. **MENSAJE EMAIL**: Formato profesional con saludo y despedida. Incluir todos los datos de la factura. Firmar como "Departamento de Cuentas por Cobrar - Suministros Guipak, S.R.L."

3. **ASUNTO EMAIL**: Máximo 60 caracteres. Incluir número de factura y acción requerida.

Responde EXACTAMENTE en este formato JSON:
{
  "mensaje_wa": "texto del mensaje WhatsApp",
  "mensaje_email": "texto del mensaje email",
  "asunto_email": "texto del asunto"
}

Solo responde el JSON, sin texto adicional.`;
}

/**
 * Genera mensajes mock cuando no hay API key de Claude.
 */
export function generarMensajeMock(ctx: ContextoCobranza): {
  mensaje_wa: string;
  mensaje_email: string;
  asunto_email: string;
} {
  const monto = formatMonto(ctx.saldo_pendiente, ctx.moneda);
  const contacto = ctx.contacto_cobros || ctx.nombre_cliente;

  const mensajesPorSegmento: Record<SegmentoRiesgo, { wa: string; email: string; asunto: string }> = {
    VERDE: {
      wa: `Hola ${contacto}. Le recordamos que la factura #${ctx.numero_factura} por ${monto} vence el ${ctx.fecha_vencimiento}. Quedamos atentos. - Guipak`,
      email: `Estimado/a ${contacto},\n\nLe recordamos cordialmente que la factura #${ctx.numero_factura} por un monto de ${monto} tiene fecha de vencimiento el ${ctx.fecha_vencimiento}.\n\nLe agradecemos gestionar el pago oportunamente para mantener su cuenta al día.\n\nQuedamos a su disposición para cualquier consulta.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.`,
      asunto: `Recordatorio: Factura #${ctx.numero_factura} próxima a vencer`,
    },
    AMARILLO: {
      wa: `Buenos días ${contacto}. La factura #${ctx.numero_factura} por ${monto} venció hace ${ctx.dias_vencido} días. ¿Podría indicarnos cuándo realizará el pago? Gracias. - Guipak`,
      email: `Estimado/a ${contacto},\n\nLe informamos que la factura #${ctx.numero_factura} (NCF: ${ctx.ncf_fiscal}) por un monto de ${monto} se encuentra vencida desde hace ${ctx.dias_vencido} días.\n\nLe solicitamos amablemente gestionar el pago a la brevedad posible o indicarnos una fecha tentativa de pago.\n\nQuedamos atentos a su respuesta.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.`,
      asunto: `Aviso: Factura #${ctx.numero_factura} vencida - Pago pendiente`,
    },
    NARANJA: {
      wa: `${contacto}, la factura #${ctx.numero_factura} por ${monto} tiene ${ctx.dias_vencido} días vencida. Necesitamos coordinar el pago de forma urgente. Favor contactarnos. - Guipak Cobros`,
      email: `Estimado/a ${contacto},\n\nNos dirigimos a usted en referencia a la factura #${ctx.numero_factura} (NCF: ${ctx.ncf_fiscal}) por ${monto}, la cual se encuentra vencida desde hace ${ctx.dias_vencido} días.\n\nEsta cuenta se encuentra en gestión activa de cobranza. Le solicitamos realizar el pago inmediato o comunicarse con nuestro departamento para establecer un acuerdo de pago.\n\nDe no recibir respuesta, nos veremos en la necesidad de escalar esta gestión.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.`,
      asunto: `URGENTE: Factura #${ctx.numero_factura} - ${ctx.dias_vencido} días vencida`,
    },
    ROJO: {
      wa: `AVISO IMPORTANTE - ${contacto}: La factura #${ctx.numero_factura} por ${monto} tiene ${ctx.dias_vencido} días de mora. Se requiere pago inmediato. Contacte a Cobros Guipak.`,
      email: `Estimado/a ${contacto},\n\nPor medio de la presente le notificamos que la factura #${ctx.numero_factura} (NCF: ${ctx.ncf_fiscal}) por ${monto} se encuentra con ${ctx.dias_vencido} días de mora.\n\nA pesar de nuestras comunicaciones anteriores, no hemos recibido el pago correspondiente ni una respuesta formal de su parte.\n\nLe instamos a realizar el pago inmediato o a comunicarse con nuestro departamento en las próximas 48 horas para evitar que esta cuenta sea referida a gestión legal.\n\nQuedamos en espera de su pronta respuesta.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.`,
      asunto: `ACCIÓN REQUERIDA: Factura #${ctx.numero_factura} en mora - ${ctx.dias_vencido} días`,
    },
  };

  const msg = mensajesPorSegmento[ctx.segmento_riesgo];
  return {
    mensaje_wa: msg.wa,
    mensaje_email: msg.email,
    asunto_email: msg.asunto,
  };
}
