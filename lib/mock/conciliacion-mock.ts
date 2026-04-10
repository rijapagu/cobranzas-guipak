/**
 * Clientes mock para selector de conciliación.
 */

import type { ClienteOption } from '@/lib/types/conciliacion';

export function getMockClientes(): ClienteOption[] {
  return [
    { codigo: '0000274', nombre: 'COMERCIAL MARTE SRL' },
    { codigo: '0000312', nombre: 'DISTRIBUIDORA DEL CARIBE' },
    { codigo: '0000458', nombre: 'FERRETERIA LA UNION' },
    { codigo: '0000521', nombre: 'SUPERMERCADO NACIONAL' },
    { codigo: '0000642', nombre: 'GRUPO INDUSTRIAL MARTINEZ' },
    { codigo: '0000189', nombre: 'IMPORTADORA ORIENTAL SRL' },
    { codigo: '0000733', nombre: 'PLASTICOS DEL NORTE' },
    { codigo: '0000856', nombre: 'ALIMENTOS CIBAO SAS' },
    { codigo: '0000395', nombre: 'CONSTRUCCIONES OMEGA' },
    { codigo: '0000967', nombre: 'TEXTILES DOMINICANOS' },
  ];
}
