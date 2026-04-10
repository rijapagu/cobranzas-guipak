/**
 * Datos mock para la cola de aprobación.
 * Se usa cuando no hay gestiones en la DB aún.
 */

import type { CobranzaGestion } from '@/lib/types/cobranzas';

export function getMockColaVacia(): CobranzaGestion[] {
  return [];
}

export function getResumenColaVacio() {
  return {
    pendientes: 0,
    aprobadas_hoy: 0,
    descartadas_hoy: 0,
    escaladas_hoy: 0,
  };
}
