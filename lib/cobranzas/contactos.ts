/**
 * Helper canónico para resolver contactos de cliente.
 *
 * Prioridad:
 *  1. cobranza_contactos_cliente (nuestra BD, es_principal=1 primero)
 *  2. cobranza_clientes_enriquecidos (campo legacy)
 *  3. Softec IC_ARCONTC (email CxP del cliente)
 *  4. Softec IC_EMAIL (email general — último recurso)
 */

import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';

export type TipoContacto = 'EMAIL' | 'WHATSAPP' | 'TELEFONO' | 'OTRO';
export type OrigenContacto = 'MANUAL' | 'TELEGRAM' | 'PORTAL';

export interface ContactoCliente {
  id: number;
  tipo: TipoContacto;
  valor: string;
  nombre_contacto: string | null;
  es_principal: boolean;
  notas: string | null;
  origen: OrigenContacto;
}

export async function obtenerContactos(
  codigoCliente: string,
  tipo?: TipoContacto
): Promise<ContactoCliente[]> {
  const params: (string | number | boolean | Date | null)[] = [codigoCliente];
  const tipoFilter = tipo ? ' AND tipo = ?' : '';
  if (tipo) params.push(tipo);

  return cobranzasQuery<ContactoCliente>(
    `SELECT id, tipo, valor, nombre_contacto, es_principal, notas, origen
     FROM cobranza_contactos_cliente
     WHERE codigo_cliente = ? AND activo = 1${tipoFilter}
     ORDER BY es_principal DESC, created_at ASC`,
    params
  );
}

/** Devuelve el email preferido de nuestra BD (no consulta Softec). */
export async function resolverEmailPropio(codigoCliente: string): Promise<string | null> {
  const contactos = await obtenerContactos(codigoCliente, 'EMAIL');
  if (contactos.length > 0) return contactos[0].valor;

  const enr = await cobranzasQuery<{ email: string | null }>(
    'SELECT email FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  return enr[0]?.email?.trim() || null;
}

/** Devuelve el WhatsApp preferido de nuestra BD (no consulta Softec). */
export async function resolverWhatsAppPropio(codigoCliente: string): Promise<string | null> {
  const contactos = await obtenerContactos(codigoCliente, 'WHATSAPP');
  if (contactos.length > 0) return contactos[0].valor;

  const enr = await cobranzasQuery<{ whatsapp: string | null }>(
    'SELECT whatsapp FROM cobranza_clientes_enriquecidos WHERE codigo_cliente = ?',
    [codigoCliente]
  );
  return enr[0]?.whatsapp?.trim() || null;
}

export interface OpcionesGuardarContacto {
  nombre_contacto?: string;
  es_principal?: boolean;
  origen?: OrigenContacto;
  creado_por?: string;
  notas?: string;
}

/**
 * Guarda un contacto en cobranza_contactos_cliente.
 * Si ya existe el mismo (codigo, tipo, valor), solo lo reactiva y actualiza.
 * Si es_principal=true, quita ese flag de los demás del mismo tipo.
 */
export async function guardarContacto(
  codigoCliente: string,
  tipo: TipoContacto,
  valor: string,
  opciones?: OpcionesGuardarContacto
): Promise<void> {
  const v = valor.trim();
  if (!v) return;

  if (opciones?.es_principal) {
    await cobranzasExecute(
      'UPDATE cobranza_contactos_cliente SET es_principal=0 WHERE codigo_cliente=? AND tipo=?',
      [codigoCliente, tipo]
    );
  }

  // Upsert: si ya existe el mismo valor (aunque inactivo), reactiva; si no, inserta
  const existing = await cobranzasQuery<{ id: number }>(
    'SELECT id FROM cobranza_contactos_cliente WHERE codigo_cliente=? AND tipo=? AND valor=? LIMIT 1',
    [codigoCliente, tipo, v]
  );

  if (existing.length > 0) {
    await cobranzasExecute(
      `UPDATE cobranza_contactos_cliente
       SET activo=1, es_principal=?, nombre_contacto=?, origen=?, creado_por=?, notas=?, updated_at=NOW()
       WHERE id=?`,
      [
        opciones?.es_principal ? 1 : 0,
        opciones?.nombre_contacto || null,
        opciones?.origen || 'MANUAL',
        opciones?.creado_por || null,
        opciones?.notas || null,
        existing[0].id,
      ]
    );
  } else {
    await cobranzasExecute(
      `INSERT INTO cobranza_contactos_cliente
       (codigo_cliente, tipo, valor, nombre_contacto, es_principal, origen, creado_por, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        codigoCliente,
        tipo,
        v,
        opciones?.nombre_contacto || null,
        opciones?.es_principal ? 1 : 0,
        opciones?.origen || 'MANUAL',
        opciones?.creado_por || null,
        opciones?.notas || null,
      ]
    );
  }
}
