/**
 * Adaptador CSV → modelo canónico (Fase 3 Etapa 2).
 *
 * Sirve la cartera importada por la empresa a las tablas de staging
 * `erp_cartera_facturas` y `erp_cartera_clientes` (migración 033).
 * El snapshot se reemplaza completo en cada importación
 * (POST /api/erp/importar-cartera).
 *
 * CP-06 degradado con gracia: `saldoFactura` devuelve el último saldo
 * importado (no hay tiempo real) — el flujo de envío debe tratarlo como
 * advertencia, no como bloqueo.
 */

import { cobranzasQuery } from '@/lib/db/cobranzas';
import { toYmd } from '@/lib/utils/fechas';
import type {
  ErpAdapter,
  FacturaPendiente,
  ClienteCartera,
  PagoRecibo,
  OpcionesCartera,
} from './tipos';

function mapCliente(r: {
  codigo: string;
  nombre: string;
  rnc: string | null;
  email: string | null;
  telefono: string | null;
  telefono2: string | null;
  contacto_cobros: string | null;
  vendedor: string | null;
}): ClienteCartera {
  return {
    codigo: String(r.codigo).trim(),
    nombre: String(r.nombre).trim(),
    rnc: r.rnc ? String(r.rnc).trim() : null,
    email: r.email ? String(r.email).trim() : null,
    telefono: r.telefono ? String(r.telefono).trim() : null,
    telefono2: r.telefono2 ? String(r.telefono2).trim() : null,
    contactoCobros: r.contacto_cobros ? String(r.contacto_cobros).trim() : null,
    vendedor: r.vendedor ? String(r.vendedor).trim() : null,
  };
}

export function crearCsvAdapter(empresaId: number): ErpAdapter {
  return {
    tipo: 'CSV',

    async disponible(): Promise<boolean> {
      // Disponible si la empresa importó cartera al menos una vez.
      const rows = await cobranzasQuery<{ total: number }>(
        'SELECT COUNT(*) AS total FROM erp_cartera_facturas WHERE empresa_id = ?',
        [empresaId]
      );
      return Number(rows[0]?.total) > 0;
    },

    async carteraPendiente(opciones?: OpcionesCartera): Promise<FacturaPendiente[]> {
      const porVencer = opciones?.incluirPorVencerDias ?? 0;
      const limite = Math.min(opciones?.limite ?? 2000, 5000);

      const rows = await cobranzasQuery<{
        numero: number;
        ncf: string | null;
        codigo_cliente: string;
        nombre_cliente: string | null;
        total: number;
        saldo_pendiente: number;
        moneda: string;
        fecha_emision: string | Date | null;
        fecha_vencimiento: string | Date;
        dias_vencida: number;
      }>(
        `SELECT f.numero, f.ncf, f.codigo_cliente,
                c.nombre AS nombre_cliente,
                f.total, f.saldo_pendiente, f.moneda,
                f.fecha_emision, f.fecha_vencimiento,
                DATEDIFF(CURDATE(), f.fecha_vencimiento) AS dias_vencida
           FROM erp_cartera_facturas f
           LEFT JOIN erp_cartera_clientes c
             ON c.empresa_id = f.empresa_id AND c.codigo = f.codigo_cliente
          WHERE f.empresa_id = ?
            AND f.saldo_pendiente > 0
            AND DATEDIFF(CURDATE(), f.fecha_vencimiento) >= ?
          ORDER BY dias_vencida DESC
          LIMIT ${limite}`,
        [empresaId, -porVencer]
      );

      return rows.map((r) => ({
        numero: Number(r.numero),
        ncf: r.ncf ? String(r.ncf).trim() : null,
        codigoCliente: String(r.codigo_cliente).trim(),
        nombreCliente: r.nombre_cliente ? String(r.nombre_cliente).trim() : String(r.codigo_cliente).trim(),
        total: Number(r.total) || 0,
        saldoPendiente: Number(r.saldo_pendiente) || 0,
        totalPagado: (Number(r.total) || 0) - (Number(r.saldo_pendiente) || 0),
        moneda: r.moneda || 'DOP',
        fechaEmision: r.fecha_emision ? toYmd(r.fecha_emision) : null,
        fechaVencimiento: toYmd(r.fecha_vencimiento),
        diasVencida: Number(r.dias_vencida) || 0,
      }));
    },

    async saldoFactura(numero: number): Promise<number | null> {
      const rows = await cobranzasQuery<{ saldo: number }>(
        'SELECT saldo_pendiente AS saldo FROM erp_cartera_facturas WHERE empresa_id = ? AND numero = ? LIMIT 1',
        [empresaId, numero]
      );
      return rows.length > 0 ? Number(rows[0].saldo) : null;
    },

    async cliente(codigo: string): Promise<ClienteCartera | null> {
      const rows = await cobranzasQuery<Parameters<typeof mapCliente>[0]>(
        `SELECT codigo, nombre, rnc, email, telefono, telefono2, contacto_cobros, vendedor
           FROM erp_cartera_clientes WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
        [empresaId, codigo]
      );
      return rows.length > 0 ? mapCliente(rows[0]) : null;
    },

    async clientes(): Promise<ClienteCartera[]> {
      const rows = await cobranzasQuery<Parameters<typeof mapCliente>[0]>(
        `SELECT codigo, nombre, rnc, email, telefono, telefono2, contacto_cobros, vendedor
           FROM erp_cartera_clientes WHERE empresa_id = ?`,
        [empresaId]
      );
      return rows.map(mapCliente);
    },

    async recibosEnRango(): Promise<PagoRecibo[]> {
      // El snapshot CSV no trae recibos de pago — conciliación no aplica.
      return [];
    },
  };
}
