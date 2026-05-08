// Test del guard endurecido — replica la lógica de lib/db/softec.ts
// para validar que rechaza ataques conocidos sin tocar la BD real.

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
}

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
  'REPLACE', 'GRANT', 'REVOKE', 'RENAME', 'CALL', 'HANDLER', 'LOAD',
  'LOCK', 'UNLOCK', 'SET', 'DO', 'EXECUTE',
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_KEYWORDS.join('|')})\\b`, 'i');

function guard(sql) {
  const cleaned = stripSqlComments(sql).trim();
  if (!/^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC)\b/i.test(cleaned)) {
    throw new Error('Solo SELECT/WITH/SHOW/EXPLAIN');
  }
  if (FORBIDDEN_RE.test(cleaned)) {
    throw new Error('Keyword de escritura detectada');
  }
}

const cases = [
  ['SELECT simple', 'SELECT 1', false],
  ['SELECT con JOIN', 'SELECT * FROM v_cobr_ijnl f JOIN v_cobr_icust c ON c.IC_CODE = f.IJ_CCODE', false],
  ['WITH (CTE)', 'WITH t AS (SELECT 1) SELECT * FROM t', false],
  ['SHOW TABLES', 'SHOW TABLES', false],
  ['EXPLAIN', 'EXPLAIN SELECT * FROM v_cobr_ijnl', false],

  ['INSERT plano', 'INSERT INTO foo VALUES (1)', true],
  ['UPDATE plano', 'UPDATE foo SET a = 1', true],
  ['DELETE plano', 'DELETE FROM foo', true],
  ['DROP', 'DROP VIEW v_cobr_ijnl', true],
  ['CALL', 'CALL my_proc()', true],
  ['LOAD DATA', "LOAD DATA INFILE '/etc/passwd' INTO TABLE foo", true],
  ['SET', 'SET @x = 1', true],

  // Comentarios SOLOS no son ataques — strip los elimina y la query queda
  // segura. El test confirma que el guard NO rompe queries con comentarios.
  ['Comentario /* */ antes de SELECT', '/* nota: cartera vencida */ SELECT 1', false],
  ['Comentario -- al final', 'SELECT 1 -- comentario inocuo', false],
  ['Comentario # al final', 'SELECT 1 # comentario MySQL', false],
  ['Comentario inline /* */', 'SELECT /* hint */ 1', false],

  // Ataques REALES — keyword maliciosa fuera de comentario
  ['Ataque: SELECT seguido de UNION INSERT (multi-statement)', 'SELECT 1; INSERT INTO foo VALUES(1)', true],
  ['Ataque: comentario que cierra antes de tiempo + INSERT', 'SELECT 1 /* */ INSERT INTO foo VALUES (1)', true],
  ['Ataque: keyword camuflada con espacios', 'SELECT 1\nUPDATE foo SET a = 1', true],
  ['Ataque: -- termina y empieza nueva línea con INSERT', 'SELECT 1 --\nINSERT INTO foo VALUES (1)', true],
];

let pass = 0;
let fail = 0;

for (const [name, sql, shouldThrow] of cases) {
  try {
    guard(sql);
    if (shouldThrow) {
      console.log(`  ❌ ${name}  — debió rechazar pero pasó`);
      fail++;
    } else {
      console.log(`  ✅ ${name}  — aceptada`);
      pass++;
    }
  } catch (err) {
    if (shouldThrow) {
      console.log(`  ✅ ${name}  — rechazada (${err.message})`);
      pass++;
    } else {
      console.log(`  ❌ ${name}  — debió aceptar: ${err.message}`);
      fail++;
    }
  }
}

console.log(`\n${pass}/${pass + fail} guard tests passed.`);
process.exit(fail > 0 ? 1 : 0);
