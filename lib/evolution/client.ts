/**
 * Cliente Evolution API — Envío de WhatsApp.
 * CP-10: Este módulo NO es importado por lib/claude/.
 */

interface EnvioResult {
  messageId: string;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * Envía un mensaje de WhatsApp via Evolution API.
 * Si no hay credenciales, retorna mock exitoso.
 */
export async function enviarWhatsApp(
  telefono: string,
  mensaje: string
): Promise<EnvioResult> {
  const apiUrl = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;

  if (!apiUrl || !apiKey || !instance) {
    console.log('[EVOLUTION] Mock: Sin credenciales, simulando envío a', telefono);
    return {
      messageId: `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      status: 'sent',
    };
  }

  try {
    // Limpiar número: solo dígitos, agregar código país si falta
    const numero = limpiarTelefono(telefono);

    const response = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
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
