/**
 * Importación de cartera por archivo CSV (Fase 3 Etapa 2).
 *
 * Parsea los CSV de facturas y clientes, valida fila por fila y REEMPLAZA el
 * snapshot de staging de la empresa (erp_cartera_facturas / erp_cartera_clientes).
 *
 * Formato facturas (cabecera obligatoria, orden libre):
 *   numero, codigo_cliente, total, saldo_pendiente, fecha_vencimiento
 *   opcionales: nombre_cliente, ncf, moneda, fecha_emision
 * Formato clientes:
 *   codigo, nombre
 *   opcionales: rnc, email, telefono, telefono2, contacto_cobros, vendedor
 * Fechas: YYYY-MM-DD o DD/MM/YYYY. Montos: punto decimal, sin separador de miles.
 */

import { cobranzasExecute } from '@/lib/db/cobranzas';

export interface ResultadoImportacion {
  facturas_importadas: number;
  clientes_importados: number;
  errores: string[];
}

/** Parser CSV mínimo con soporte de comillas dobles (RFC 4180 básico). */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;

  const limpio = texto.replace(/^﻿/, ''); // BOM de Excel
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (enComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      enComillas = true;
    } else if (ch === ',' || ch === ';') {
      fila.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo);
      campo = '';
      if (fila.some((c) => c.trim() !== '')) filas.push(fila);
      fila = [];
    } else {
      campo += ch;
    }
  }
  fila.push(campo);
  if (fila.some((c) => c.trim() !== '')) filas.push(fila);
  return filas;
}

function normalizarCabecera(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

function parsearFecha(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function parsearMonto(v: string): number | null {
  const s = v.trim().replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

interface FilaFactura {
  numero: number;
  codigo_cliente: string;
  nombre_cliente: string | null;
  ncf: string | null;
  total: number;
  saldo_pendiente: number;
  moneda: string;
  fecha_emision: string | null;
  fecha_vencimiento: string;
}

interface FilaCliente {
  codigo: string;
  nombre: string;
  rnc: string | null;
  email: string | null;
  telefono: string | null;
  telefono2: string | null;
  contacto_cobros: string | null;
  vendedor: string | null;
}

export function validarFacturasCsv(texto: string): { filas: FilaFactura[]; errores: string[] } {
  const errores: string[] = [];
  const raw = parsearCsv(texto);
  if (raw.length < 2) return { filas: [], errores: ['El CSV de facturas no tiene filas de datos'] };

  const cab = raw[0].map(normalizarCabecera);
  const idx = (n: string) => cab.indexOf(n);
  const requeridas = ['numero', 'codigo_cliente', 'total', 'saldo_pendiente', 'fecha_vencimiento'];
  const faltan = requeridas.filter((c) => idx(c) === -1);
  if (faltan.length > 0) {
    return { filas: [], errores: [`Faltan columnas requeridas en facturas: ${faltan.join(', ')}`] };
  }

  const filas: FilaFactura[] = [];
  const numerosVistos = new Set<number>();
  for (let i = 1; i < raw.length; i++) {
    const linea = i + 1;
    const r = raw[i];
    const celda = (n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? '').trim() : '');

    const numero = Number(celda('numero'));
    const codigo = celda('codigo_cliente');
    const total = parsearMonto(celda('total'));
    const saldo = parsearMonto(celda('saldo_pendiente'));
    const fvenc = parsearFecha(celda('fecha_vencimiento'));

    if (!Number.isInteger(numero) || numero <= 0) {
      errores.push(`Línea ${linea}: numero de factura inválido ("${celda('numero')}")`);
      continue;
    }
    if (numerosVistos.has(numero)) {
      errores.push(`Línea ${linea}: numero de factura ${numero} duplicado en el archivo`);
      continue;
    }
    if (!codigo) {
      errores.push(`Línea ${linea}: codigo_cliente vacío`);
      continue;
    }
    if (total === null || saldo === null) {
      errores.push(`Línea ${linea}: total o saldo_pendiente no numérico`);
      continue;
    }
    if (saldo < 0 || total < 0 || saldo > total + 0.01) {
      errores.push(`Línea ${linea}: montos inconsistentes (saldo ${saldo} > total ${total} o negativos)`);
      continue;
    }
    if (!fvenc) {
      errores.push(`Línea ${linea}: fecha_vencimiento inválida ("${celda('fecha_vencimiento')}")`);
      continue;
    }

    numerosVistos.add(numero);
    filas.push({
      numero,
      codigo_cliente: codigo.slice(0, 40),
      nombre_cliente: celda('nombre_cliente') || null,
      ncf: celda('ncf') ? celda('ncf').slice(0, 40) : null,
      total,
      saldo_pendiente: saldo,
      moneda: (celda('moneda') || 'DOP').slice(0, 10).toUpperCase(),
      fecha_emision: parsearFecha(celda('fecha_emision')),
      fecha_vencimiento: fvenc,
    });
  }
  return { filas, errores };
}

export function validarClientesCsv(texto: string): { filas: FilaCliente[]; errores: string[] } {
  const errores: string[] = [];
  const raw = parsearCsv(texto);
  if (raw.length < 2) return { filas: [], errores: ['El CSV de clientes no tiene filas de datos'] };

  const cab = raw[0].map(normalizarCabecera);
  const idx = (n: string) => cab.indexOf(n);
  if (idx('codigo') === -1 || idx('nombre') === -1) {
    return { filas: [], errores: ['Faltan columnas requeridas en clientes: codigo, nombre'] };
  }

  const filas: FilaCliente[] = [];
  const codigosVistos = new Set<string>();
  for (let i = 1; i < raw.length; i++) {
    const linea = i + 1;
    const r = raw[i];
    const celda = (n: string) => (idx(n) >= 0 ? (r[idx(n)] ?? '').trim() : '');
    const codigo = celda('codigo');
    const nombre = celda('nombre');
    if (!codigo || !nombre) {
      errores.push(`Línea ${linea}: codigo o nombre vacío`);
      continue;
    }
    if (codigosVistos.has(codigo)) {
      errores.push(`Línea ${linea}: codigo ${codigo} duplicado en el archivo`);
      continue;
    }
    codigosVistos.add(codigo);
    filas.push({
      codigo: codigo.slice(0, 40),
      nombre: nombre.slice(0, 200),
      rnc: celda('rnc') || null,
      email: celda('email') || null,
      telefono: celda('telefono') || null,
      telefono2: celda('telefono2') || null,
      contacto_cobros: celda('contacto_cobros') || null,
      vendedor: celda('vendedor') || null,
    });
  }
  return { filas, errores };
}

const CHUNK = 200;

/**
 * Reemplaza el snapshot de cartera de la empresa.
 * Si no viene archivo de clientes, los nombres del CSV de facturas alimentan
 * erp_cartera_clientes (solo codigo + nombre).
 */
export async function importarCartera(
  empresaId: number,
  facturas: FilaFactura[],
  clientes: FilaCliente[] | null
): Promise<{ facturas: number; clientes: number }> {
  // Clientes derivados de facturas si no hay archivo dedicado.
  let filasClientes = clientes;
  if (!filasClientes || filasClientes.length === 0) {
    const porCodigo = new Map<string, FilaCliente>();
    for (const f of facturas) {
      if (!porCodigo.has(f.codigo_cliente)) {
        porCodigo.set(f.codigo_cliente, {
          codigo: f.codigo_cliente,
          nombre: f.nombre_cliente || f.codigo_cliente,
          rnc: null, email: null, telefono: null, telefono2: null,
          contacto_cobros: null, vendedor: null,
        });
      }
    }
    filasClientes = [...porCodigo.values()];
  }

  await cobranzasExecute('DELETE FROM erp_cartera_facturas WHERE empresa_id = ?', [empresaId]);
  await cobranzasExecute('DELETE FROM erp_cartera_clientes WHERE empresa_id = ?', [empresaId]);

  for (let i = 0; i < facturas.length; i += CHUNK) {
    const lote = facturas.slice(i, i + CHUNK);
    const values = lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = lote.flatMap((f) => [
      empresaId, f.numero, f.ncf, f.codigo_cliente, f.total,
      f.saldo_pendiente, f.moneda, f.fecha_emision, f.fecha_vencimiento,
    ]);
    await cobranzasExecute(
      `INSERT INTO erp_cartera_facturas
         (empresa_id, numero, ncf, codigo_cliente, total, saldo_pendiente, moneda, fecha_emision, fecha_vencimiento)
       VALUES ${values}`,
      params
    );
  }

  for (let i = 0; i < filasClientes.length; i += CHUNK) {
    const lote = filasClientes.slice(i, i + CHUNK);
    const values = lote.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = lote.flatMap((c) => [
      empresaId, c.codigo, c.nombre, c.rnc, c.email,
      c.telefono, c.telefono2, c.contacto_cobros, c.vendedor,
    ]);
    await cobranzasExecute(
      `INSERT INTO erp_cartera_clientes
         (empresa_id, codigo, nombre, rnc, email, telefono, telefono2, contacto_cobros, vendedor)
       VALUES ${values}`,
      params
    );
  }

  return { facturas: facturas.length, clientes: filasClientes.length };
}
