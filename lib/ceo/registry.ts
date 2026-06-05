/**
 * Registro de áreas del CEO orquestador (meta-supervisor).
 *
 * El bot CEO es la línea conversacional ÚNICA del CEO (arquitectura híbrida
 * acordada 2026-06-05: bots por área para ALERTAS push + un bot CEO para
 * CONVERSACIÓN que consulta a todas las áreas). Aquí se registran las áreas
 * disponibles; añadir una nueva = agregar una entrada con su `conversar`.
 *
 * v1: solo Cobros tiene cerebro de supervisor (datos + scoring + deepseek).
 * Ventas/Inventario/Despacho/Contabilidad se irán enchufando aquí cuando se
 * construyan, sin tocar el webhook del CEO.
 */

import { conversarSupervisor } from '@/lib/supervisor/conversacion';

export interface SupervisorAreaResult {
  text: string;
  model: string;
  latencyMs: number;
}

export interface SupervisorArea {
  key: string;
  label: string;
  /** Palabras que sugieren que la pregunta es de esta área (routing). */
  keywords: string[];
  /** Responde una pregunta estratégica del área con su modelo + contexto. */
  conversar: (pregunta: string) => Promise<SupervisorAreaResult>;
}

export const AREAS: SupervisorArea[] = [
  {
    key: 'cobros',
    label: 'Cobros',
    keywords: [
      'cobro', 'cobros', 'cobranza', 'cartera', 'deud', 'deuda', 'deudor',
      'factura', 'facturas', 'pago', 'pagos', 'promesa', 'promesas', 'mora',
      'vencid', 'cliente', 'clientes', 'saldo', 'dso', 'riesgo',
    ],
    conversar: conversarSupervisor,
  },
];

export interface RouteResult {
  area: SupervisorArea;
  /** true si el routing fue por coincidencia de keywords; false si fue default. */
  matched: boolean;
  /** Cuántas áreas distintas hicieron match (para avisar de ambigüedad). */
  matchCount: number;
}

/**
 * Decide a qué área enrutar una pregunta por coincidencia de keywords.
 * v1 (una sola área) siempre cae en Cobros. Estructura lista para N áreas:
 * gana la de más coincidencias; si nadie coincide, default a la primera área.
 */
export function resolverArea(pregunta: string): RouteResult {
  const texto = pregunta
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  let mejor: SupervisorArea | null = null;
  let mejorScore = 0;
  let conMatch = 0;

  for (const area of AREAS) {
    const score = area.keywords.reduce(
      (n, kw) => (texto.includes(kw) ? n + 1 : n),
      0
    );
    if (score > 0) conMatch++;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = area;
    }
  }

  if (mejor) {
    return { area: mejor, matched: true, matchCount: conMatch };
  }
  // Nadie coincidió: default a la primera área registrada.
  return { area: AREAS[0], matched: false, matchCount: 0 };
}
