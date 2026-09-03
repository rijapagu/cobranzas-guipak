/**
 * Verificación de procedencia de los eventos del webhook de Evolution.
 *
 * El servidor de Evolution hospeda varias instancias y el número de WhatsApp
 * está compartido con otros sistemas, así que el token del webhook no basta:
 * prueba que quien llama conoce el secreto, no de qué instancia sale el mensaje.
 * Sin esta verificación, un cliente de la cartera que escriba por CUALQUIER otro
 * motivo entra al procesador de respuestas y puede acabar con una promesa de
 * pago o una disputa inventadas, a su nombre y en la cola de aprobación.
 *
 * Función pura a propósito: la decisión se prueba sin DB ni red (grupo offline).
 */

export type MotivoDescarte = 'sin-instancia-configurada' | 'otra-instancia';

export type VeredictoInstancia =
  | { aceptar: true }
  | { aceptar: false; motivo: MotivoDescarte; recibida: string };

/**
 * `instanceDelBody` es `body.instance` tal cual llega (Evolution v2 lo manda en
 * la raíz del webhook); `unknown` porque el cuerpo no está tipado ni validado.
 *
 * Fail-closed: sin instancia esperada configurada NO se acepta nada. Es la misma
 * postura que `enviarWhatsApp`, que se niega a enviar sin credenciales en vez de
 * simular un éxito — una env var perdida en un deploy no debe convertirse en
 * "procesa todo lo que llegue".
 */
export function verificarInstancia(
  instanceDelBody: unknown,
  instanciaEsperada: string | null | undefined
): VeredictoInstancia {
  const esperada = (instanciaEsperada ?? '').trim();
  const recibida = (typeof instanceDelBody === 'string' ? instanceDelBody : '').trim();

  if (!esperada) return { aceptar: false, motivo: 'sin-instancia-configurada', recibida };
  if (recibida !== esperada) return { aceptar: false, motivo: 'otra-instancia', recibida };

  return { aceptar: true };
}
