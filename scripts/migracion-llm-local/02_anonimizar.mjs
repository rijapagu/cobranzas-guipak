#!/usr/bin/env node
/**
 * Anonimiza el TSV exportado de cobranza_telegram_historial antes de cualquier eval.
 *
 * USO:
 *   node 02_anonimizar.mjs queries.tsv > queries_anon.tsv 2> anonimizar.log
 *
 * QUÉ ANONIMIZA (en orden de aplicación):
 *   - Emails → email_<hash6>@example.com
 *   - Teléfonos DR (809/829/849 + 7 dígitos, varios formatos) → (809) 555-NNNN
 *   - RNC / cédula (9-11 dígitos con o sin guiones) → 000-00000-0
 *   - Códigos cliente Softec (CG0029, RV0003, 7 dígitos) → CLI0001, CLI0002... estable por hash
 *   - Nombres en ALL CAPS de >= 2 palabras (típico de razón social: "PADRON OFFICE")
 *     → CLIENTE_NN estable
 *
 * QUÉ NO ANONIMIZA (decisión consciente):
 *   - Montos: el modelo debe procesarlos. Sensibilidad media, riesgo bajo.
 *   - Nombres de personas en mayúscula/minúscula tipo "Ricardo Padron":
 *     demasiados falsos positivos. Quien lea reportes debe ser consciente.
 *
 * REPORTE en stderr:
 *   - # de transformaciones por tipo
 *   - Top 10 reemplazos hechos (para auditar)
 *
 * IMPORTANTE: usa hashing estable, así el mismo email aparece igual en todas las filas.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  process.stderr.write('uso: node 02_anonimizar.mjs <archivo.tsv>\n');
  process.exit(1);
}

const raw = readFileSync(inputPath, 'utf8');
const lines = raw.split('\n');
const header = lines.shift();
process.stdout.write(header + '\n');

const stats = { emails: 0, phones: 0, rnc: 0, codigos: 0, allcaps: 0 };
const replacements = new Map(); // original → reemplazo
const counters = { cliente: 0, codigo: 0 };

function hashShort(s, len = 6) {
  return createHash('sha256').update(s).digest('hex').slice(0, len);
}

function memo(original, generator) {
  if (replacements.has(original)) return replacements.get(original);
  const v = generator();
  replacements.set(original, v);
  return v;
}

// --- Reglas en orden ---

function anonEmail(s) {
  return s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
    stats.emails++;
    return memo(m.toLowerCase(), () => `email_${hashShort(m.toLowerCase())}@example.com`);
  });
}

function anonPhone(s) {
  // 809-555-1234, (829) 5551234, 8495551234, +1 809 555-1234, etc.
  return s.replace(
    /(\+?1[\s.-]?)?(\(?(?:809|829|849)\)?[\s.-]?\d{3}[\s.-]?\d{4})/g,
    (m) => {
      stats.phones++;
      const digits = m.replace(/\D/g, '').slice(-10);
      const tail = hashShort(digits, 4).replace(/[a-f]/gi, '0');
      return memo(m, () => `(809) 555-${tail}`);
    }
  );
}

function anonRnc(s) {
  // RNC: 9 dígitos. Cédula: 11 dígitos. Con o sin guiones.
  // Ej: 130-12345-6, 13012345 6, 00112345678
  return s.replace(/\b\d{3}[-\s]?\d{5,7}[-\s]?\d?\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 11) return m;
    stats.rnc++;
    return memo(m, () => (digits.length === 11 ? '000-0000000-0' : '000-00000-0'));
  });
}

function anonCodigoCliente(s) {
  // Códigos Softec: 2 letras + 4 dígitos (CG0029, RV0003), o 7 dígitos puros (0000274)
  return s
    .replace(/\b([A-Z]{2})(\d{4})\b/g, (m) => {
      stats.codigos++;
      return memo(m, () => {
        counters.codigo++;
        return `CLI${String(counters.codigo).padStart(4, '0')}`;
      });
    })
    .replace(/\b0\d{6}\b/g, (m) => {
      stats.codigos++;
      return memo(m, () => {
        counters.codigo++;
        return `0${String(counters.codigo).padStart(6, '0')}`;
      });
    });
}

function anonAllCapsNames(s) {
  // 2+ palabras consecutivas en ALL CAPS de >= 3 letras cada una.
  // Ignora siglas comunes (SRL, SA, RNC, etc.) tomadas solas.
  return s.replace(/\b[A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{3,})+\b/g, (m) => {
    // Si todas las palabras son siglas conocidas, skip
    const stopwords = new Set(['SRL', 'SA', 'CXC', 'CXP', 'NCF', 'FP', 'IN', 'OC']);
    const words = m.split(/\s+/);
    if (words.every((w) => stopwords.has(w))) return m;
    stats.allcaps++;
    return memo(m, () => {
      counters.cliente++;
      return `CLIENTE_${String(counters.cliente).padStart(2, '0')}`;
    });
  });
}

// --- Loop ---

let rowsProcessed = 0;
for (const line of lines) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  // El contenido_oneline es la última columna (índice 6)
  if (cols.length >= 7) {
    let txt = cols[6];
    txt = anonEmail(txt);
    txt = anonPhone(txt);
    txt = anonRnc(txt);
    txt = anonCodigoCliente(txt);
    txt = anonAllCapsNames(txt);
    cols[6] = txt;
  }
  process.stdout.write(cols.join('\t') + '\n');
  rowsProcessed++;
}

// --- Reporte ---

process.stderr.write(`\n[OK] ${rowsProcessed} filas procesadas\n`);
process.stderr.write('[Transformaciones]\n');
for (const [k, v] of Object.entries(stats)) {
  process.stderr.write(`  ${k.padEnd(10)} ${v}\n`);
}
process.stderr.write(`[Reemplazos únicos] ${replacements.size}\n`);
process.stderr.write('[Muestra top-10 reemplazos]\n');
let n = 0;
for (const [orig, repl] of replacements) {
  if (n++ >= 10) break;
  process.stderr.write(`  ${orig.slice(0, 40).padEnd(42)} → ${repl}\n`);
}
process.stderr.write(
  '\n⚠️  Revisión humana recomendada antes de pegar el TSV en chats con LLM externos.\n' +
  '    Esta herramienta NO atrapa nombres propios en case mixto (ej. "Ricardo Padron").\n'
);
