-- Fase 10: Reemplazar plantillas con los 22 modelos del doc oficial
-- modelos_correos_cobranzas_suministros_guipak_v2.md
--
-- Cambios:
--   1. Agrega columna `categoria` para clasificar (SECUENCIA, BUEN_CLIENTE, PROMESA_ROTA, ESTADO_CUENTA)
--   2. Reemplaza las 6 plantillas iniciales con las 22 del doc
--   3. Variables canónicas: {{cliente}}, {{empresa_cliente}}, {{numero_factura}},
--      {{monto}}, {{fecha_vencimiento}}, {{dias_vencida}}, {{fecha_prometida_pago}},
--      {{telefono_cobros}}
--   4. Todas con requiere_aprobacion=1 (regla de oro)
--   5. Sin {{vendedor}} ni {{link_pago}} en este lote inicial

-- 1. Agregar columna categoria si no existe (MySQL no soporta IF NOT EXISTS para columnas)
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cobranza_plantillas_email'
    AND COLUMN_NAME = 'categoria'
);
SET @sql_col = IF(@col_exists = 0,
  'ALTER TABLE cobranza_plantillas_email ADD COLUMN categoria ENUM(''SECUENCIA'',''BUEN_CLIENTE'',''PROMESA_ROTA'',''ESTADO_CUENTA'') NOT NULL DEFAULT ''SECUENCIA'' AFTER orden_secuencia',
  'SELECT 1'
);
PREPARE stmt_col FROM @sql_col;
EXECUTE stmt_col;
DEALLOCATE PREPARE stmt_col;

SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cobranza_plantillas_email'
    AND INDEX_NAME = 'idx_categoria'
);
SET @sql_idx = IF(@idx_exists = 0,
  'ALTER TABLE cobranza_plantillas_email ADD INDEX idx_categoria (categoria, activa)',
  'SELECT 1'
);
PREPARE stmt_idx FROM @sql_idx;
EXECUTE stmt_idx;
DEALLOCATE PREPARE stmt_idx;

-- 2. Limpiar plantillas existentes
TRUNCATE TABLE cobranza_plantillas_email;

-- 3. Insertar las 22 plantillas del doc
INSERT INTO cobranza_plantillas_email
  (id, nombre, descripcion, segmento, dia_desde_vencimiento, orden_secuencia, categoria, asunto, cuerpo, tono, requiere_aprobacion, activa)
VALUES

-- ============================================================
-- 1. FACTURA PRÓXIMA A VENCER (3 días antes)
-- ============================================================
(1, '01 - Recordatorio amable (preventivo)',
 'Recordatorio cordial 3 días antes del vencimiento',
 'VERDE', -3, 1, 'SECUENCIA',
 'Recordatorio de factura próxima a vencer',
 'Estimado/a {{cliente}},\n\nEsperamos que se encuentre bien.\n\nLe escribimos para recordarle que la factura No. {{numero_factura}}, correspondiente a un monto de {{monto}}, tiene fecha de vencimiento el {{fecha_vencimiento}}.\n\nAgradecemos tomar las previsiones correspondientes para que el pago pueda ser realizado dentro del plazo acordado.\n\nQuedamos atentos a cualquier inquietud.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'AMIGABLE', 1, 1),

(2, '02 - Preventivo más directo',
 'Preventivo 3 días antes, tono más firme',
 'VERDE', -3, 2, 'SECUENCIA',
 'Factura próxima a vencer - {{numero_factura}}',
 'Estimado/a {{cliente}},\n\nLe recordamos que la factura No. {{numero_factura}} por valor de {{monto}} estará venciendo el próximo {{fecha_vencimiento}}.\n\nPara evitar retrasos, suspensión de crédito o inconvenientes en futuros despachos, le agradecemos gestionar el pago antes de la fecha indicada.\n\nEn caso de que el pago ya haya sido realizado, favor remitirnos el comprobante para actualizar su cuenta.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'MODERADO', 1, 1),

-- ============================================================
-- 2. DÍA DE VENCIMIENTO
-- ============================================================
(3, '03 - Vence hoy',
 'Aviso el día exacto del vencimiento',
 'VERDE', 0, 1, 'SECUENCIA',
 'Factura vence hoy - {{numero_factura}}',
 'Estimado/a {{cliente}},\n\nLe informamos que la factura No. {{numero_factura}}, por valor de {{monto}}, vence en el día de hoy, {{fecha_vencimiento}}.\n\nAgradecemos realizar el pago durante el día para mantener su cuenta al día y evitar que se refleje como vencida en nuestro sistema.\n\nSi ya realizó el pago, puede enviarnos el comprobante respondiendo a este correo.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'MODERADO', 1, 1),

-- ============================================================
-- 3. 1 A 3 DÍAS VENCIDA (AMARILLO)
-- ============================================================
(4, '04 - Primer vencimiento suave',
 '1-3 días vencida, tono comprensivo',
 'AMARILLO', 2, 1, 'SECUENCIA',
 'Factura vencida pendiente de pago - {{numero_factura}}',
 'Estimado/a {{cliente}},\n\nNuestro sistema refleja que la factura No. {{numero_factura}}, por valor de {{monto}}, vencida el {{fecha_vencimiento}}, aún se encuentra pendiente de pago.\n\nEntendemos que puede tratarse de un descuido o retraso administrativo, por lo que agradecemos nos confirme la fecha estimada de pago.\n\nEn caso de haber realizado el pago, favor enviarnos el comprobante para actualizar su balance.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'AMIGABLE', 1, 1),

(5, '05 - Cortés con seguimiento',
 '1-3 días vencida, alternativa con tono comercial',
 'AMARILLO', 2, 2, 'SECUENCIA',
 'Seguimiento a balance pendiente',
 'Estimado/a {{cliente}},\n\nLe damos seguimiento a la factura No. {{numero_factura}}, actualmente vencida, por un monto de {{monto}}.\n\nFavor indicarnos si el pago será realizado en el transcurso del día o si existe algún inconveniente que debamos conocer.\n\nNuestro interés es mantener la cuenta en orden y evitar bloqueos o retrasos en futuros pedidos.\n\nQuedamos atentos.\n\nSaludos cordiales,\nCuentas por Cobrar\nSuministros Guipak',
 'MODERADO', 1, 1),

-- ============================================================
-- 4. 4 A 7 DÍAS VENCIDA (AMARILLO)
-- ============================================================
(6, '06 - Más firme',
 '4-7 días vencida, tono firme',
 'AMARILLO', 5, 1, 'SECUENCIA',
 'Balance vencido requiere atención - {{empresa_cliente}}',
 'Estimado/a {{cliente}},\n\nA la fecha, la factura No. {{numero_factura}}, por valor de {{monto}}, continúa pendiente de pago, con vencimiento desde el {{fecha_vencimiento}}.\n\nLe solicitamos regularizar este balance a la mayor brevedad posible o confirmarnos una fecha concreta de pago.\n\nEs importante mantener la cuenta al día para evitar restricciones en el crédito o en la entrega de nuevos pedidos.\n\nQuedamos atentos a su pronta respuesta.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

(7, '07 - Solicitud de compromiso',
 '4-7 días vencida, pide fecha exacta',
 'AMARILLO', 5, 2, 'SECUENCIA',
 'Solicitud de fecha de pago - Factura {{numero_factura}}',
 'Estimado/a {{cliente}},\n\nLe contactamos nuevamente en relación con la factura No. {{numero_factura}}, vencida desde el {{fecha_vencimiento}}, por valor de {{monto}}.\n\nNecesitamos que nos confirme una fecha exacta de pago para poder registrar el compromiso en nuestro sistema de cobranzas.\n\nDe no recibir respuesta, la cuenta podría ser colocada en revisión para futuros despachos o condiciones de crédito.\n\nAgradecemos su pronta atención.\n\nSaludos cordiales,\nCuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

-- ============================================================
-- 5. 8 A 15 DÍAS VENCIDA (AMARILLO)
-- ============================================================
(8, '08 - Advertencia bloqueo de crédito',
 '8-15 días vencida, advierte restricción',
 'AMARILLO', 10, 1, 'SECUENCIA',
 'Cuenta en atraso - Posible restricción de crédito',
 'Estimado/a {{cliente}},\n\nSu cuenta presenta un balance vencido correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}, con {{dias_vencida}} días de atraso.\n\nLe solicitamos realizar el pago o comunicarse con nuestro departamento de cobros para coordinar una solución.\n\nDe mantenerse el atraso sin respuesta, la cuenta podrá ser colocada en estado de crédito restringido, lo que podría afectar nuevos pedidos, despachos o condiciones comerciales.\n\nFavor atender este requerimiento a la mayor brevedad posible.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

(9, '09 - Regularización urgente',
 '8-15 días vencida, tono serio comercial',
 'AMARILLO', 10, 2, 'SECUENCIA',
 'Regularización urgente de balance vencido',
 'Estimado/a {{cliente}},\n\nHemos intentado dar seguimiento al balance pendiente de su cuenta, correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}.\n\nA la fecha, no hemos recibido confirmación de pago ni una fecha formal de regularización.\n\nLe recordamos que nuestros acuerdos comerciales dependen del cumplimiento oportuno de los pagos. Por este motivo, solicitamos gestionar este balance de manera urgente.\n\nFavor responder este correo indicando la fecha en que será realizado el pago.\n\nSaludos cordiales,\nCuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

-- ============================================================
-- 6. 16 A 30 DÍAS VENCIDA (NARANJA)
-- ============================================================
(10, '10 - Cuenta en revisión',
 '16-30 días vencida, cuenta marcada para revisión',
 'NARANJA', 20, 1, 'SECUENCIA',
 'Cuenta en revisión por balance vencido',
 'Estimado/a {{cliente}},\n\nLe informamos que su cuenta ha sido marcada para revisión debido al atraso presentado en la factura No. {{numero_factura}}, por valor de {{monto}}, vencida desde el {{fecha_vencimiento}}.\n\nAgradecemos realizar el pago pendiente o comunicarse con nosotros en un plazo máximo de 24 horas para coordinar una solución.\n\nDe no recibir respuesta, nos veremos en la obligación de limitar nuevas ventas a crédito y evaluar medidas adicionales de gestión de cobro.\n\nEsperamos poder resolver esta situación de manera cordial.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'FORMAL', 1, 1),

(11, '11 - Último aviso antes de suspensión',
 '16-30 días vencida, último aviso pre-suspensión',
 'NARANJA', 25, 2, 'SECUENCIA',
 'Último aviso antes de suspensión de crédito',
 'Estimado/a {{cliente}},\n\nSu cuenta mantiene un balance vencido correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}, con {{dias_vencida}} días de atraso.\n\nEste correo constituye un último aviso antes de proceder con la suspensión temporal del crédito comercial.\n\nPara evitar esta medida, favor realizar el pago pendiente o enviar una fecha formal de pago en el día de hoy.\n\nEn caso de que el pago ya haya sido realizado, favor remitirnos el comprobante.\n\nSaludos,\nCuentas por Cobrar\nSuministros Guipak',
 'FORMAL', 1, 1),

-- ============================================================
-- 7. MÁS DE 30 DÍAS VENCIDA (ROJO)
-- ============================================================
(12, '12 - Suspensión de crédito',
 '30+ días vencida, suspensión formal',
 'ROJO', 35, 1, 'SECUENCIA',
 'Suspensión temporal de crédito por balance vencido',
 'Estimado/a {{cliente}},\n\nLe informamos que, debido al atraso presentado en su cuenta, el crédito comercial queda temporalmente suspendido hasta la regularización del balance pendiente.\n\nFactura pendiente: {{numero_factura}}\nMonto vencido: {{monto}}\nFecha de vencimiento: {{fecha_vencimiento}}\nDías de atraso: {{dias_vencida}}\n\nDurante este período, cualquier nuevo pedido deberá ser procesado bajo modalidad de pago contra entrega o pago anticipado, hasta que la cuenta sea normalizada.\n\nAgradecemos comunicarse con nosotros para coordinar el pago correspondiente.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

(13, '13 - Pago inmediato requerido',
 '30+ días vencida, tono más fuerte',
 'ROJO', 35, 2, 'SECUENCIA',
 'Balance vencido requiere pago inmediato',
 'Estimado/a {{cliente}},\n\nA pesar de los recordatorios enviados, su cuenta continúa presentando un balance vencido correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}.\n\nEl atraso ya supera los {{dias_vencida}} días, sin que hayamos recibido pago ni una respuesta formal con fecha de regularización.\n\nLe solicitamos realizar el pago inmediato de este balance o contactarnos en un plazo no mayor de 24 horas.\n\nDe no recibir respuesta, la cuenta será escalada internamente para gestión de cobro avanzada.\n\nSaludos,\nCuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

-- ============================================================
-- 8. PRE-LEGAL (45 días)
-- ============================================================
(14, '14 - Aviso pre-legal',
 '45 días vencida, primer aviso pre-legal',
 'ROJO', 45, 3, 'SECUENCIA',
 'Aviso pre-legal por balance vencido',
 'Estimado/a {{cliente}},\n\nPor este medio le notificamos que su cuenta mantiene un balance vencido correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}, con vencimiento desde el {{fecha_vencimiento}}.\n\nA pesar de los seguimientos realizados, no hemos recibido el pago correspondiente ni una respuesta formal con una fecha de regularización.\n\nLe otorgamos un plazo de 48 horas para realizar el pago pendiente o comunicarse con nuestro departamento de cobros.\n\nDe no recibir respuesta dentro de este plazo, nos reservamos el derecho de remitir el caso a nuestros asesores legales para la evaluación de las acciones correspondientes.\n\nEsperamos poder resolver esta situación sin necesidad de escalar el proceso.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'LEGAL', 1, 1),

(15, '15 - Notificación final pre-legal',
 '45 días vencida, notificación final',
 'ROJO', 50, 4, 'SECUENCIA',
 'Notificación final de cobro antes de acciones legales',
 'Estimado/a {{cliente}},\n\nEste correo constituye una notificación final de cobro relacionada con la factura No. {{numero_factura}}, por valor de {{monto}}, vencida desde el {{fecha_vencimiento}}.\n\nA la fecha, el balance continúa pendiente y no hemos recibido una solución formal por parte de ustedes.\n\nLe solicitamos realizar el pago total del monto adeudado en un plazo máximo de 48 horas a partir de la recepción de este correo.\n\nDe no recibirse el pago o una comunicación formal dentro del plazo indicado, la cuenta podrá ser remitida a gestión legal, incluyendo la reclamación del balance adeudado, gastos asociados y cualquier otra acción permitida por las vías correspondientes.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'LEGAL', 1, 1),

-- ============================================================
-- 9. LEGAL / COBRO EXTERNO (60 días)
-- ============================================================
(16, '16 - Remisión a legal',
 '60+ días vencida, remisión a gestión legal',
 'ROJO', 60, 5, 'SECUENCIA',
 'Remisión de cuenta a gestión legal',
 'Estimado/a {{cliente}},\n\nLe informamos que, debido a la falta de pago de la factura No. {{numero_factura}}, por valor de {{monto}}, vencida desde el {{fecha_vencimiento}}, su cuenta será remitida a gestión legal o cobro externo.\n\nDurante este proceso, cualquier comunicación relacionada con el balance pendiente podrá ser canalizada a través del departamento correspondiente.\n\nAún puede evitar la escalación realizando el pago inmediato o contactándonos en el día de hoy para formalizar una solución.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'LEGAL', 1, 1),

-- ============================================================
-- 10. CLIENTES BUENOS QUE SE ATRASAN (categoría especial)
-- ============================================================
(17, '17 - Cliente habitual seguimiento amable',
 'Cliente bueno con atraso puntual, cuidando relación',
 'AMARILLO', 5, 1, 'BUEN_CLIENTE',
 'Seguimiento amable a balance pendiente',
 'Estimado/a {{cliente}},\n\nEsperamos que se encuentre bien.\n\nLe escribimos para dar seguimiento a la factura No. {{numero_factura}}, por valor de {{monto}}, la cual figura como vencida en nuestro sistema.\n\nValoramos mucho la relación comercial con ustedes, por lo que agradecemos nos ayuden a mantener la cuenta al día.\n\nFavor confirmarnos si el pago está en proceso o indicarnos una fecha estimada.\n\nSaludos cordiales,\nCuentas por Cobrar\nSuministros Guipak',
 'AMIGABLE', 1, 1),

(18, '18 - Cliente bueno cuidando la relación',
 'Cliente bueno, ofrece apoyo para regularizar',
 'AMARILLO', 10, 2, 'BUEN_CLIENTE',
 'Apoyo para regularizar su cuenta',
 'Estimado/a {{cliente}},\n\nHemos notado que la factura No. {{numero_factura}}, por valor de {{monto}}, aún se encuentra pendiente de pago.\n\nQueremos evitar que este balance afecte sus condiciones comerciales o futuros despachos, por lo que agradecemos nos indique cuándo podríamos recibir el pago.\n\nSi existe alguna situación particular con esta factura, favor informarnos para poder revisarla.\n\nQuedamos atentos.\n\nSaludos,\nSuministros Guipak',
 'AMIGABLE', 1, 1),

-- ============================================================
-- 11. PROMESA DE PAGO INCUMPLIDA (categoría especial)
-- ============================================================
(19, '19 - Incumplimiento de promesa',
 'Cliente prometió pagar y no pagó - primer aviso',
 'NARANJA', 0, 1, 'PROMESA_ROTA',
 'Incumplimiento de compromiso de pago',
 'Estimado/a {{cliente}},\n\nSegún la información registrada, el pago de la factura No. {{numero_factura}}, por valor de {{monto}}, estaba previsto para el día {{fecha_prometida_pago}}.\n\nA la fecha, no hemos recibido el pago ni el comprobante correspondiente.\n\nLe solicitamos confirmar si el pago será realizado en el día de hoy o indicarnos una nueva fecha concreta de regularización.\n\nEs importante evitar nuevos incumplimientos para mantener activa la relación de crédito.\n\nSaludos,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

(20, '20 - Promesa rota tono fuerte',
 'Promesa incumplida - escalada',
 'ROJO', 0, 2, 'PROMESA_ROTA',
 'Pago no recibido según compromiso acordado',
 'Estimado/a {{cliente}},\n\nLe damos seguimiento al compromiso de pago correspondiente a la factura No. {{numero_factura}}, por valor de {{monto}}.\n\nEl pago estaba pautado para el {{fecha_prometida_pago}}, pero hasta el momento no hemos recibido confirmación ni comprobante.\n\nEste tipo de incumplimiento afecta la evaluación de crédito de la cuenta y puede limitar futuras ventas a crédito.\n\nFavor realizar el pago de inmediato o contactarnos hoy mismo para evitar restricciones adicionales.\n\nSaludos,\nCuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1),

-- ============================================================
-- 12. ESTADO DE CUENTA (categoría especial)
-- ============================================================
(21, '21 - Estado de cuenta neutral',
 'Envío rutinario de estado de cuenta',
 'VERDE', 0, 1, 'ESTADO_CUENTA',
 'Estado de cuenta actualizado - {{empresa_cliente}}',
 'Estimado/a {{cliente}},\n\nAdjunto le remitimos el estado de cuenta actualizado de {{empresa_cliente}}.\n\nAgradecemos revisar las facturas pendientes y proceder con la regularización de los balances vencidos.\n\nEn caso de tener alguna diferencia, favor responder este correo indicando los documentos que desea revisar.\n\nQuedamos atentos a su confirmación.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak',
 'MODERADO', 1, 1),

(22, '22 - Estado de cuenta con presión',
 'Estado de cuenta con balances vencidos',
 'NARANJA', 0, 2, 'ESTADO_CUENTA',
 'Estado de cuenta con balances vencidos',
 'Estimado/a {{cliente}},\n\nAdjunto encontrará el estado de cuenta actualizado de {{empresa_cliente}}.\n\nEl mismo presenta balances vencidos que requieren atención inmediata.\n\nAgradecemos revisar y proceder con el pago correspondiente o, en su defecto, enviarnos una programación formal de pago.\n\nDe mantenerse el atraso sin respuesta, la cuenta podría ser colocada en revisión de crédito.\n\nSaludos,\nCuentas por Cobrar\nSuministros Guipak',
 'FIRME', 1, 1);
