import { cobranzasQuery, cobranzasExecute } from './cobranzas';

export async function getConfig(clave: string, empresaId: number): Promise<string | null> {
  const rows = await cobranzasQuery<{ valor: string }>(
    'SELECT valor FROM cobranza_configuracion WHERE clave = ? AND empresa_id = ? LIMIT 1',
    [clave, empresaId]
  );
  return rows[0]?.valor ?? null;
}

export async function setConfig(clave: string, valor: string, descripcion: string | null, usuario: string, empresaId: number): Promise<void> {
  const existing = await cobranzasQuery<{ clave: string }>(
    'SELECT clave FROM cobranza_configuracion WHERE clave = ? AND empresa_id = ? LIMIT 1',
    [clave, empresaId]
  );
  if (existing.length > 0) {
    await cobranzasExecute(
      'UPDATE cobranza_configuracion SET valor = ?, descripcion = COALESCE(?, descripcion), actualizado_por = ? WHERE clave = ? AND empresa_id = ?',
      [valor, descripcion, usuario, clave, empresaId]
    );
  } else {
    await cobranzasExecute(
      'INSERT INTO cobranza_configuracion (empresa_id, clave, valor, descripcion, actualizado_por) VALUES (?, ?, ?, ?, ?)',
      [empresaId, clave, valor, descripcion, usuario]
    );
  }
}
