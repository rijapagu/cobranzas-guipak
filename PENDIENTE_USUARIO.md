# PENDIENTE_USUARIO.md — Acciones manuales pendientes

> Acciones que requieren validación humana, credenciales, acceso a
> producción o decisiones de negocio que no pueden automatizarse.
> Mantener este archivo corto y actual — borrar items cuando se cumplan.

---

## Validación visual post-fix CP-15 (sesión 11-may-2026)

Los 8 commits del fix CP-15 están en la rama `claude/goofy-gates-dc20da`
sin push. La verificación visual del UI quedó fuera del alcance de la
sesión por falta de credenciales en el entorno. Items a validar antes
de mergear y desplegar:

### 1. Las 4 pantallas con sesión real

Arrancar `npm run dev` local con sesión válida y verificar cada una.

- [ ] **Dashboard `/`** — fila superior con 3 cards (Cartera Bruta /
  Saldo a Favor / Cartera Neta). Los números deben cuadrar: bruto cerca
  de $31.45M, a favor cerca de $3.94M, neto cerca de $27.51M (con
  variaciones intradía menores). Top 10 ordenado por neto, no por
  bruto. Confirmar que el título dice "Top 10 Clientes con Mayor Saldo
  Neto".

- [ ] **Cartera `/cartera`** — al cargar, debe aparecer una fila
  adicional al inicio con 3 cards globales (bruta / a favor / neta).
  En la tabla, dos columnas nuevas a la derecha del saldo: "A favor
  (cliente)" y "Neto (cliente)". Filas de clientes cubiertos muestran
  un Tag azul "Cubierta por anticipo" bajo el nombre. Verificar
  ordenando por "Neto (cliente)" descendente.

- [ ] **Clientes `/clientes`** — "Saldo Pendiente" pasa a secundario
  (texto gris pequeño). "Saldo Neto" es la columna primaria, con
  sorter descendente por defecto. Columna "A favor" en medio. Clientes
  cubiertos deben mostrar el monto en verde y un tag "Cubierto por
  anticipo" debajo.

- [ ] **Portal cliente** — generar un token para un cliente cubierto
  (ej. `CG0029` SENADO) y abrir el link. Debe aparecer un Alert verde
  "Saldo cubierto por anticipo" arriba; el resumen debe tener 4 cards
  (Facturas / Saldo Total / Saldo a Favor / Saldo a Pagar). La card
  "Saldo a Pagar" debe estar en verde con texto "Cubierto por tus
  anticipos". También probar con un cliente con anticipo parcial
  (ej. `0000997` Universidad Católica) — debe ver Alert azul info y
  los 4 cards con neto > 0.

### 2. Cola de cobranza (`/generar-cola`)

- [ ] Ejecutar el job de generación de cola (manualmente o esperando
  al cron). Revisar el log: debe aparecer una línea tipo
  `[generar-cola] X clientes excluidos por saldo a favor (CP-15)`
  con X cerca de 58 (tolerancia ±3 por variaciones intradía).
- [ ] Confirmar que ninguno de los 58 clientes cubiertos genera
  gestiones en `cobranza_gestiones` para esa ejecución.

### 3. Empuje matutino (Telegram)

- [ ] Esperar al primer empuje matutino post-deploy (cron Dokploy,
  diario 8:00 AM AST). El mensaje en el grupo "Cobros Guipak" debe
  mostrar 3 líneas en el bloque de cartera:
  - "Cartera vencida (bruta): RD$..."
  - "Saldo a favor (anticipos): RD$..."
  - "Cartera neta (cobrable): RD$..."
- [ ] Si hay clientes cubiertos, aparece "(X cubiertos por anticipo)"
  junto al conteo de clientes.

### 4. Portal cliente con CG0029 (SENADO)

- [ ] Generar token específico para `CG0029` y abrir.
- [ ] Confirmar mensaje claro "No tienes pagos pendientes. Tienes
  RD$263,598.95 a favor con nosotros. Tu equipo de cobranzas aplicará
  el anticipo a las próximas facturas..." (texto exacto del backend).
- [ ] Card "Saldo a Pagar" en RD$0.00, color verde.

### 5. Bot Telegram

- [ ] Probar el bot con: "saldo de SENADO". Debe responder con
  `cubierto_por_anticipo: true`, saldo neto en cero, saldo a favor
  $263,598.95.
- [ ] Probar: "préparame un correo para SENADO". El bot debe
  responder con motivo `CLIENTE_CUBIERTO_POR_ANTICIPO` y explicar
  que contabilidad debe aplicar el anticipo. NO debe crear gestión
  en `cobranza_gestiones`.

---

## Si surgen quejas o discrepancias post-deploy

- **Cliente se siente excluido injustamente:** revisar primero el
  helper `obtenerSaldoAFavorPorCliente(['CODIGO'])` — si reporta
  saldo a favor > 0, es real (vino de Softec). Si el saldo a favor
  está mal en Softec, escalar a contabilidad para que aplique o
  reverse el recibo. **No revertir CP-15** para parchar un cliente.
- **Cliente cubierto cuando no debería:** mismo procedimiento.
  Verificar `v_cobr_ijnl_pay` y `v_cobr_irjnl` directamente — el bug
  suele estar en aplicaciones manuales no completadas en Softec.
- **Cartera neta no cuadra con el bruto - a favor reportado:** revisar
  CP-13 y CP-14. El JOIN debe ser por `IR_PLOCAL/IR_PTYPDOC/IR_RECNUM`,
  no por `IR_F*`.

---

## Acciones operativas

- [ ] Push de los 8 commits de la rama `claude/goofy-gates-dc20da` a
  origin tras validar.
- [ ] Decidir estrategia de merge: PR contra `master` o merge directo
  según convención del repo.
- [ ] Tras deploy, confirmar el primer empuje matutino y la primera
  ejecución de `/generar-cola`.

---

## Notas técnicas menores

- **`.claude/settings.local.json` modificado, sin commitear:** durante
  la sesión 10-11 may se aprobaron permisos locales para `unset
  ANTHROPIC_API_KEY` y `npx tsx *` que quedaron persistidos en el
  archivo. Es local del entorno — decisión consciente de no incluirlo
  en los commits del fix. Si limpias el worktree o cambias de máquina,
  los permisos se vuelven a pedir y se vuelven a aprobar.
- **Issue #7 (FS lento en E:\) sigue vigente:** `next dev` arranca pero
  compilar páginas tarda mucho. No bloqueante para validar la lógica
  (tsc + tests dirigidos cubren la lógica), pero sí ralentiza la
  validación visual.
