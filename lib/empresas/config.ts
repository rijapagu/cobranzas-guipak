/**
 * Configuración e integraciones por empresa (Fase 3 Etapa 3).
 *
 * Vive en `empresas.config` (JSON). Guipak (empresa 1) NO usa esta tabla:
 * sus credenciales siguen viniendo de las variables de entorno del servidor
 * — cero cambio de comportamiento para el sistema actual.
 *
 * Los secretos (password SMTP, apikey Evolution) se cifran con AES-256-GCM
 * antes de persistir. Clave: CONFIG_CIPHER_KEY (fallback JWT_SECRET, que es
 * el secreto que la app ya exige en producción).
 */

import crypto from 'crypto';
import { cobranzasQuery, cobranzasExecute } from '@/lib/db/cobranzas';
import { EMPRESA_GUIPAK } from '@/lib/tenant';

export interface IdentidadEmpresa {
  /** Nombre legal/comercial que firma los mensajes. */
  nombre: string;
  /** Alias corto para WhatsApp ("- Guipak"). */
  alias: string;
  /** Firma de los correos (multi-línea). */
  firma: string;
}

export interface SmtpEmpresa {
  host: string;
  port: number;
  user: string;
  /** En reposo va cifrada; configDeEmpresa() la devuelve descifrada. */
  pass: string;
  from: string;
  nombreRemitente: string;
}

export interface EvolutionEmpresa {
  url: string;
  /** En reposo va cifrada; configDeEmpresa() la devuelve descifrada. */
  apikey: string;
  instance: string;
}

export interface EmpresaConfig {
  identidad: IdentidadEmpresa;
  smtp: SmtpEmpresa | null;
  evolution: EvolutionEmpresa | null;
}

// ---------------------------------------------------------------------------
// Cifrado de secretos
// ---------------------------------------------------------------------------

const PREFIJO_CIFRADO = 'enc:v1:';

function claveCifrado(): Buffer {
  const secreto = process.env.CONFIG_CIPHER_KEY || process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta CONFIG_CIPHER_KEY / JWT_SECRET para cifrar config');
  return crypto.createHash('sha256').update(secreto).digest();
}

export function cifrarSecreto(plano: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const cifrado = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIJO_CIFRADO + Buffer.concat([iv, tag, cifrado]).toString('base64');
}

export function descifrarSecreto(guardado: string): string {
  if (!guardado.startsWith(PREFIJO_CIFRADO)) return guardado; // legado/plano
  const raw = Buffer.from(guardado.slice(PREFIJO_CIFRADO.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const datos = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', claveCifrado(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Lectura (con cache) y escritura
// ---------------------------------------------------------------------------

const IDENTIDAD_GUIPAK: IdentidadEmpresa = {
  nombre: 'Suministros Guipak, S.R.L.',
  alias: 'Guipak',
  firma: 'Departamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
};

const TTL_MS = 60_000;
const cache = new Map<number, { config: EmpresaConfig; expira: number }>();

function configGuipakDesdeEnv(): EmpresaConfig {
  return {
    identidad: IDENTIDAD_GUIPAK,
    smtp: process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
      ? {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
          from: process.env.SMTP_FROM || 'cobros@guipak.com',
          nombreRemitente: 'Cobros Guipak',
        }
      : null,
    evolution: process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE
      ? {
          url: process.env.EVOLUTION_API_URL,
          apikey: process.env.EVOLUTION_API_KEY,
          instance: process.env.EVOLUTION_INSTANCE,
        }
      : null,
  };
}

interface ConfigGuardada {
  identidad?: Partial<IdentidadEmpresa>;
  smtp?: (Omit<SmtpEmpresa, 'pass'> & { pass?: string }) | null;
  evolution?: (Omit<EvolutionEmpresa, 'apikey'> & { apikey?: string }) | null;
}

export async function configDeEmpresa(empresaId: number): Promise<EmpresaConfig> {
  if (empresaId === EMPRESA_GUIPAK) return configGuipakDesdeEnv();

  const hit = cache.get(empresaId);
  if (hit && hit.expira > Date.now()) return hit.config;

  const rows = await cobranzasQuery<{ nombre: string; config: string | null }>(
    'SELECT nombre, config FROM empresas WHERE id = ? AND activa = 1 LIMIT 1',
    [empresaId]
  );
  const nombreEmpresa = rows[0]?.nombre ?? `Empresa ${empresaId}`;

  let guardada: ConfigGuardada = {};
  try {
    guardada = rows[0]?.config ? JSON.parse(rows[0].config) : {};
  } catch {
    // config corrupta → tratar como vacía (los envíos fallarán con mensaje claro)
  }

  const config: EmpresaConfig = {
    identidad: {
      nombre: guardada.identidad?.nombre || nombreEmpresa,
      alias: guardada.identidad?.alias || nombreEmpresa,
      firma: guardada.identidad?.firma || `Departamento de Cobranzas\n${nombreEmpresa}`,
    },
    smtp: guardada.smtp?.host && guardada.smtp?.user && guardada.smtp?.pass
      ? {
          host: guardada.smtp.host,
          port: Number(guardada.smtp.port) || 587,
          user: guardada.smtp.user,
          pass: descifrarSecreto(guardada.smtp.pass),
          from: guardada.smtp.from || guardada.smtp.user,
          nombreRemitente: guardada.smtp.nombreRemitente || nombreEmpresa,
        }
      : null,
    evolution: guardada.evolution?.url && guardada.evolution?.apikey && guardada.evolution?.instance
      ? {
          url: guardada.evolution.url,
          apikey: descifrarSecreto(guardada.evolution.apikey),
          instance: guardada.evolution.instance,
        }
      : null,
  };

  cache.set(empresaId, { config, expira: Date.now() + TTL_MS });
  return config;
}

/**
 * Persiste (merge superficial por sección) la config de una empresa.
 * Secciones omitidas no se tocan; pasar `null` borra la sección.
 * Secretos vacíos en el parche conservan el secreto ya guardado.
 */
export async function guardarConfigEmpresa(
  empresaId: number,
  parche: {
    identidad?: Partial<IdentidadEmpresa>;
    smtp?: { host: string; port: number; user: string; pass?: string; from?: string; nombreRemitente?: string } | null;
    evolution?: { url: string; apikey?: string; instance: string } | null;
  }
): Promise<void> {
  if (empresaId === EMPRESA_GUIPAK) {
    throw new Error('La configuración de Guipak se gestiona por variables de entorno del servidor');
  }

  const rows = await cobranzasQuery<{ config: string | null }>(
    'SELECT config FROM empresas WHERE id = ? LIMIT 1',
    [empresaId]
  );
  let actual: ConfigGuardada = {};
  try {
    actual = rows[0]?.config ? JSON.parse(rows[0].config) : {};
  } catch { /* sobrescribir config corrupta */ }

  if (parche.identidad !== undefined) {
    actual.identidad = { ...actual.identidad, ...parche.identidad };
  }
  if (parche.smtp !== undefined) {
    if (parche.smtp === null) {
      actual.smtp = null;
    } else {
      const passNueva = parche.smtp.pass?.trim();
      actual.smtp = {
        host: parche.smtp.host,
        port: Number(parche.smtp.port) || 587,
        user: parche.smtp.user,
        // pass vacía → conservar la cifrada existente
        pass: passNueva ? cifrarSecreto(passNueva) : actual.smtp?.pass,
        from: parche.smtp.from || parche.smtp.user,
        nombreRemitente: parche.smtp.nombreRemitente || '',
      };
    }
  }
  if (parche.evolution !== undefined) {
    if (parche.evolution === null) {
      actual.evolution = null;
    } else {
      const keyNueva = parche.evolution.apikey?.trim();
      actual.evolution = {
        url: parche.evolution.url,
        apikey: keyNueva ? cifrarSecreto(keyNueva) : actual.evolution?.apikey,
        instance: parche.evolution.instance,
      };
    }
  }

  await cobranzasExecute('UPDATE empresas SET config = ? WHERE id = ?', [
    JSON.stringify(actual),
    empresaId,
  ]);
  cache.delete(empresaId);
}

/** Vista segura para la UI: indica qué hay configurado SIN exponer secretos. */
export async function configEmpresaParaUi(empresaId: number): Promise<{
  identidad: IdentidadEmpresa;
  smtp: { host: string; port: number; user: string; from: string; nombreRemitente: string; hasPassword: boolean } | null;
  evolution: { url: string; instance: string; hasApikey: boolean } | null;
  gestionadaPorServidor: boolean;
}> {
  const config = await configDeEmpresa(empresaId);
  return {
    identidad: config.identidad,
    smtp: config.smtp
      ? {
          host: config.smtp.host,
          port: config.smtp.port,
          user: config.smtp.user,
          from: config.smtp.from,
          nombreRemitente: config.smtp.nombreRemitente,
          hasPassword: !!config.smtp.pass,
        }
      : null,
    evolution: config.evolution
      ? { url: config.evolution.url, instance: config.evolution.instance, hasApikey: !!config.evolution.apikey }
      : null,
    gestionadaPorServidor: empresaId === EMPRESA_GUIPAK,
  };
}
