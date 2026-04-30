/**
 * Render de plantillas de correo: sustituye {{variable}} por valores del contexto.
 * Variables canónicas (doc oficial v2):
 *   {{cliente}}              - nombre del contacto o razón social
 *   {{empresa_cliente}}      - nombre de la empresa
 *   {{numero_factura}}       - número de factura
 *   {{monto}}                - monto formateado RD$X,XXX.XX
 *   {{fecha_vencimiento}}    - DD/MM/YYYY
 *   {{dias_vencida}}         - número de días
 *   {{fecha_prometida_pago}} - DD/MM/YYYY (solo PROMESA_ROTA)
 *   {{telefono_cobros}}      - tomado de env COBRANZAS_TELEFONO
 *
 * Aliases retrocompat (plantillas viejas migración 011):
 *   {{factura}}      → {{numero_factura}}
 *   {{dias_vencido}} → {{dias_vencida}}
 *   {{contacto}}     → {{cliente}}
 *   {{ncf}}          → {{ncf_fiscal}}
 */

export interface ContextoPlantilla {
  cliente: string;
  empresa_cliente: string;
  numero_factura: string | number;
  ncf_fiscal?: string;
  monto: number;
  moneda?: string;
  fecha_vencimiento: string | Date;
  dias_vencida: number;
  fecha_prometida_pago?: string | Date | null;
  telefono_cobros?: string;
}

export interface PlantillaRender {
  asunto: string;
  cuerpo: string;
}

function formatMonto(monto: number, moneda = 'DOP'): string {
  const prefix = moneda === 'DOP' ? 'RD$' : `${moneda} `;
  return prefix + monto.toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatFecha(fecha: string | Date): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Construye el mapa de variables resueltas desde el contexto.
 * Las variables ausentes quedan como string vacío (no rompen el render).
 */
function resolverVariables(ctx: ContextoPlantilla): Record<string, string> {
  const moneda = ctx.moneda || 'DOP';
  const telefonoCobros = ctx.telefono_cobros || process.env.COBRANZAS_TELEFONO || '';

  const fechaProm = ctx.fecha_prometida_pago
    ? formatFecha(ctx.fecha_prometida_pago)
    : '';

  const vars: Record<string, string> = {
    cliente: ctx.cliente || ctx.empresa_cliente || '',
    empresa_cliente: ctx.empresa_cliente || ctx.cliente || '',
    numero_factura: String(ctx.numero_factura ?? ''),
    ncf_fiscal: ctx.ncf_fiscal || '',
    monto: formatMonto(Number(ctx.monto) || 0, moneda),
    fecha_vencimiento: formatFecha(ctx.fecha_vencimiento),
    dias_vencida: String(ctx.dias_vencida ?? 0),
    fecha_prometida_pago: fechaProm,
    telefono_cobros: telefonoCobros,
  };

  // Aliases retrocompat
  vars.factura = vars.numero_factura;
  vars.dias_vencido = vars.dias_vencida;
  vars.contacto = vars.cliente;
  vars.ncf = vars.ncf_fiscal;

  return vars;
}

/**
 * Reemplaza {{var}} en un texto con los valores del contexto.
 * Variables no definidas se reemplazan por '' (no se dejan crudas en el correo).
 */
export function renderTexto(texto: string, ctx: ContextoPlantilla): string {
  const vars = resolverVariables(ctx);
  return texto.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_match, name) => {
    return vars[name] ?? '';
  });
}

/**
 * Renderiza una plantilla completa (asunto + cuerpo).
 */
export function renderPlantilla(
  plantilla: { asunto: string; cuerpo: string },
  ctx: ContextoPlantilla
): PlantillaRender {
  return {
    asunto: renderTexto(plantilla.asunto, ctx),
    cuerpo: renderTexto(plantilla.cuerpo, ctx),
  };
}

/**
 * Devuelve la lista de variables presentes en un texto sin resolver.
 * Útil para validar plantillas antes de guardarlas en DB.
 */
export function extraerVariables(texto: string): string[] {
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(texto)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}
