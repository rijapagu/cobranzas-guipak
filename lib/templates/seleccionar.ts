/**
 * Selector de plantillas de correo según segmento, días vencidos y categoría.
 *
 * Categorías:
 *   - SECUENCIA      → flujo normal por días vencidos (default)
 *   - BUEN_CLIENTE   → cliente con buen historial pero atraso puntual
 *   - PROMESA_ROTA   → cliente prometió fecha y no cumplió
 *   - ESTADO_CUENTA  → envío rutinario de estado de cuenta
 *
 * Regla de selección (categoría SECUENCIA):
 *   Escoge la plantilla activa con `dia_desde_vencimiento` MÁS CERCANO
 *   sin pasarse de `diasVencido`. Empate → menor `orden_secuencia`.
 *
 * Para otras categorías: la primera plantilla activa de la categoría que
 *   coincida con el segmento (o cualquiera si no hay match exacto).
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import type { SegmentoRiesgo } from '@/lib/types/cartera';

export type CategoriaPlantilla =
  | 'SECUENCIA'
  | 'BUEN_CLIENTE'
  | 'PROMESA_ROTA'
  | 'ESTADO_CUENTA';

export type TonoPlantilla =
  | 'AMIGABLE'
  | 'MODERADO'
  | 'FORMAL'
  | 'FIRME'
  | 'LEGAL';

export interface PlantillaDB {
  id: number;
  nombre: string;
  segmento: SegmentoRiesgo;
  dia_desde_vencimiento: number;
  orden_secuencia: number;
  categoria: CategoriaPlantilla;
  asunto: string;
  cuerpo: string;
  tono: TonoPlantilla;
  requiere_aprobacion: 0 | 1;
  activa: 0 | 1;
}

export interface CriterioSeleccion {
  segmento: SegmentoRiesgo;
  diasVencido: number;
  categoria?: CategoriaPlantilla;
}

/**
 * Selecciona la plantilla más apropiada según el criterio.
 * Devuelve null si no hay ninguna plantilla activa que aplique.
 */
export async function seleccionarPlantilla(
  criterio: CriterioSeleccion
): Promise<PlantillaDB | null> {
  const categoria = criterio.categoria || 'SECUENCIA';

  if (categoria !== 'SECUENCIA') {
    // Categorías especiales: match por categoría + segmento; fallback a categoría sola.
    const exact = await cobranzasQuery<PlantillaDB>(
      `SELECT * FROM cobranza_plantillas_email
       WHERE activa = 1 AND categoria = ? AND segmento = ?
       ORDER BY orden_secuencia ASC LIMIT 1`,
      [categoria, criterio.segmento]
    );
    if (exact[0]) return exact[0];

    const anySeg = await cobranzasQuery<PlantillaDB>(
      `SELECT * FROM cobranza_plantillas_email
       WHERE activa = 1 AND categoria = ?
       ORDER BY orden_secuencia ASC LIMIT 1`,
      [categoria]
    );
    return anySeg[0] || null;
  }

  // SECUENCIA: plantilla activa con dia_desde_vencimiento más cercano sin pasarse.
  const plantillas = await cobranzasQuery<PlantillaDB>(
    `SELECT * FROM cobranza_plantillas_email
     WHERE activa = 1
       AND categoria = 'SECUENCIA'
       AND segmento = ?
       AND dia_desde_vencimiento <= ?
     ORDER BY dia_desde_vencimiento DESC, orden_secuencia ASC
     LIMIT 1`,
    [criterio.segmento, criterio.diasVencido]
  );

  if (plantillas[0]) return plantillas[0];

  // Fallback: si no hay plantilla en este segmento que aplique, busca la más
  // cercana en cualquier segmento (útil cuando un cliente acaba de saltar de
  // segmento y aún no tenemos plantillas para los días bajos del nuevo segmento).
  const fallback = await cobranzasQuery<PlantillaDB>(
    `SELECT * FROM cobranza_plantillas_email
     WHERE activa = 1
       AND categoria = 'SECUENCIA'
       AND dia_desde_vencimiento <= ?
     ORDER BY dia_desde_vencimiento DESC, orden_secuencia ASC
     LIMIT 1`,
    [criterio.diasVencido]
  );

  return fallback[0] || null;
}

/**
 * Busca una plantilla activa por ID exacto.
 * Devuelve null si no existe o está inactiva.
 */
export async function seleccionarPlantillaById(id: number): Promise<PlantillaDB | null> {
  const rows = await cobranzasQuery<PlantillaDB>(
    'SELECT * FROM cobranza_plantillas_email WHERE id = ? AND activa = 1 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

/**
 * Devuelve la lista de plantillas activas (sin cuerpo) para mostrar al usuario.
 */
export async function listarPlantillasActivas(): Promise<Omit<PlantillaDB, 'cuerpo'>[]> {
  return cobranzasQuery<Omit<PlantillaDB, 'cuerpo'>>(
    `SELECT id, nombre, descripcion, segmento, dia_desde_vencimiento,
            orden_secuencia, categoria, asunto, tono, requiere_aprobacion, activa
     FROM cobranza_plantillas_email
     WHERE activa = 1
     ORDER BY categoria ASC, segmento ASC, dia_desde_vencimiento ASC, orden_secuencia ASC`,
    []
  );
}

/**
 * Helper: calcula el segmento a partir de los días vencidos.
 */
export function calcularSegmento(diasVencido: number): SegmentoRiesgo {
  if (diasVencido < 1) return 'VERDE';
  if (diasVencido <= 15) return 'AMARILLO';
  if (diasVencido <= 30) return 'NARANJA';
  return 'ROJO';
}
