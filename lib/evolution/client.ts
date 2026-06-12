/**
 * Cliente Evolution API — Envío de WhatsApp.
 * CP-10: Este módulo NO es importado por lib/claude/.
 *
 * Fase 3 Etapa 3: la instancia Evolution se resuelve POR EMPRESA
 * (lib/empresas/config). Guipak (empresa 1, default) sigue usando envs.
 */

import { configDeEmpresa } from '@/lib/empresas/config';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

interface EnvioResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Envía un mensaje de WhatsApp via Evolution API.
 * Sin credenciales configuradas devuelve 'failed' — NUNCA un éxito simulado:
 * antes devolvía mock 'sent' y si una env var se perdía en un deploy, todas
 * las gestiones se marcaban ENVIADO sin que nadie recibiera nada.
 */
export async function enviarWhatsApp(
  telefono: string,
  mensaje: string,
  empresaId: number = EMPRESA_GUIPAK
): Promise<EnvioResult> {
  const config = await configDeEmpresa(empresaId);
  const evolution = config.evolution;

  if (!evolution) {
    const origen = empresaId === EMPRESA_GUIPAK
      ? 'faltan EVOLUTION_API_URL/KEY/INSTANCE en el servidor'
      : 'configura WhatsApp en Configuración → Mi empresa';
    console.error(`[EVOLUTION] Empresa ${empresaId} sin WhatsApp configurado — envío rechazado a`, telefono);
    return {
      messageId: '',
      status: 'failed',
      error: `Evolution API no configurada (${origen})`,
    };
  }

  try {
    // Limpiar número: solo dígitos, agregar código país si falta
    const numero = limpiarTelefono(telefono);

    const response = await fetch(`${evolution.url}/message/sendText/${evolution.instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolution.apikey,
      },
      body: JSON.stringify({
        number: numero,
        text: mensaje,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[EVOLUTION] Error:', response.status, errorData);
      return {
        messageId: '',
        status: 'failed',
        error: `Evolution API error ${response.status}: ${errorData}`,
      };
    }

    const data = await response.json();
    return {
      messageId: data.key?.id || data.messageId || `evo_${Date.now()}`,
      status: 'sent',
    };
  } catch (error) {
    console.error('[EVOLUTION] Error enviando:', error);
    return {
      messageId: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Error desconocido',
    };
  }
}

/**
 * Limpia y normaliza un número de teléfono para WhatsApp.
 * Agrega código de país RD (1809, 1829, 1849) si no lo tiene.
 */
function limpiarTelefono(telefono: string): string {
  let num = telefono.replace(/[^0-9]/g, '');

  // Si empieza con 809, 829, 849 sin código de país
  if (/^(809|829|849)/.test(num) && num.length === 10) {
    num = '1' + num;
  }

  // Si tiene 10 dígitos y no empieza con 1 (asumimos RD)
  if (num.length === 10 && !num.startsWith('1')) {
    num = '1' + num;
  }

  return num;
}
