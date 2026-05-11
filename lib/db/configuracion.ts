import { cobranzasQuery, cobranzasExecute } from './cobranzas';

export async function getConfig(clave: string): Promise<string | null> {
  const rows = await cobranzasQuery<{ valor: string }>(
    'SELECT valor FROM cobranza_configuracion WHERE clave = ? LIMIT 1',
    [clave]
  );
  return rows[0]?.valor ?? null;
}

export async function setConfig(clave: string, valor: string, descripcion: string | null, usuario: string): Promise<void> {
  const existing = await cobranzasQuery<{ clave: string }>(
    'SELECT clave FROM cobranza_configuracion WHERE clave = ? LIMIT 1',
    [clave]
  );
  if (existing.length > 0) {
    await cobranzasExecute(
      'UPDATE cobranza_configuracion SET valor = ?, descripcion = COALESCE(?, descripcion), actualizado_por = ? WHERE clave = ?',
      [valor, descripcion, usuario, clave]
    );
  } else {
    await cobranzasExecute(
      'INSERT INTO cobranza_configuracion (clave, valor, descripcion, actualizado_por) VALUES (?, ?, ?, ?)',
      [clave, valor, descripcion, usuario]
    );
  }
}
