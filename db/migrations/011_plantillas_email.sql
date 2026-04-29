-- Fase 10: Plantillas de Correo configurables
-- 1er, 2do, 3er, 4to (amenaza legal), 5to (pre-legal), 6to (demanda)

CREATE TABLE IF NOT EXISTS cobranza_plantillas_email (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  descripcion VARCHAR(255) NULL,
  -- Cuándo se aplica
  segmento ENUM('VERDE','AMARILLO','NARANJA','ROJO') NOT NULL,
  dia_desde_vencimiento INT NOT NULL DEFAULT 0,
  -- Orden secuencial dentro del segmento (1, 2, 3, 4...)
  orden_secuencia INT NOT NULL DEFAULT 1,
  -- Contenido
  asunto VARCHAR(200) NOT NULL,
  cuerpo TEXT NOT NULL,
  tono ENUM('AMIGABLE','MODERADO','FORMAL','FIRME','LEGAL') NOT NULL DEFAULT 'MODERADO',
  -- Aprobación
  requiere_aprobacion TINYINT(1) NOT NULL DEFAULT 1,
  -- Estado
  activa TINYINT(1) NOT NULL DEFAULT 1,
  -- Metadata
  creado_por VARCHAR(50) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_segmento (segmento, activa),
  INDEX idx_dia (dia_desde_vencimiento)
);

-- Plantillas iniciales — disponibles en variables {{cliente}}, {{contacto}}, {{factura}}, {{ncf}}, {{monto}}, {{dias_vencido}}, {{fecha_vencimiento}}
INSERT IGNORE INTO cobranza_plantillas_email
  (id, nombre, descripcion, segmento, dia_desde_vencimiento, orden_secuencia, asunto, cuerpo, tono, requiere_aprobacion, activa)
VALUES
(1, '1er aviso — Recordatorio amigable', 'Cliente verde, recordatorio antes del vencimiento', 'VERDE', -3, 1,
 'Recordatorio: Factura {{factura}} próxima a vencer',
 'Estimado/a {{contacto}},\n\nLe escribimos para recordarle cordialmente que la factura #{{factura}} (NCF: {{ncf}}) por un monto de RD${{monto}} tiene fecha de vencimiento el {{fecha_vencimiento}}.\n\nLe agradecemos gestionar el pago oportunamente para mantener su cuenta al día.\n\nQuedamos a su disposición para cualquier consulta.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
 'AMIGABLE', 0, 1),

(2, '2do aviso — Vencimiento moderado', 'Factura vencida 1-15 días, urgencia moderada', 'AMARILLO', 7, 1,
 'Aviso: Factura {{factura}} vencida — Pago pendiente',
 'Estimado/a {{contacto}},\n\nLe informamos que la factura #{{factura}} (NCF: {{ncf}}) por un monto de RD${{monto}} se encuentra vencida desde hace {{dias_vencido}} días.\n\nLe solicitamos amablemente gestionar el pago a la brevedad posible o indicarnos una fecha tentativa de pago.\n\nQuedamos atentos a su respuesta.\n\nSaludos cordiales,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
 'MODERADO', 1, 1),

(3, '3er aviso — Cobranza formal', 'Factura vencida 16-30 días, gestión activa', 'NARANJA', 20, 1,
 'URGENTE: Factura {{factura}} - {{dias_vencido}} días vencida',
 'Estimado/a {{contacto}},\n\nNos dirigimos a usted en referencia a la factura #{{factura}} (NCF: {{ncf}}) por RD${{monto}}, la cual se encuentra vencida desde hace {{dias_vencido}} días.\n\nEsta cuenta se encuentra en gestión activa de cobranza. Le solicitamos realizar el pago inmediato o comunicarse con nuestro departamento para establecer un acuerdo de pago.\n\nDe no recibir respuesta, nos veremos en la necesidad de escalar esta gestión.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
 'FORMAL', 1, 1),

(4, '4to aviso — Cobranza intensa', 'Factura vencida 30+ días, última oportunidad antes de pre-legal', 'ROJO', 35, 1,
 'ÚLTIMA OPORTUNIDAD: Factura {{factura}} con {{dias_vencido}} días de mora',
 'Estimado/a {{contacto}},\n\nA pesar de nuestras comunicaciones anteriores sobre la factura #{{factura}} (NCF: {{ncf}}) por RD${{monto}}, no hemos recibido el pago correspondiente. La cuenta presenta {{dias_vencido}} días de mora.\n\nLe instamos a realizar el pago inmediato o a comunicarse con nuestro departamento en las próximas 48 horas. Esta es la última comunicación amistosa antes de proceder con acciones más severas.\n\nQuedamos en espera de su pronta respuesta.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
 'FIRME', 1, 1),

(5, '5to aviso — Pre-legal', 'Aviso previo a gestión legal — 60+ días', 'ROJO', 60, 2,
 'AVISO PRE-LEGAL: Factura {{factura}} en mora grave',
 'Estimado/a {{contacto}},\n\nLe notificamos formalmente que la factura #{{factura}} (NCF: {{ncf}}) por la suma de RD${{monto}} presenta {{dias_vencido}} días de mora sin que se haya recibido pago alguno ni respuesta a nuestras comunicaciones.\n\nEn vista de lo anterior, le informamos que de no recibir el pago total o un acuerdo formal en un plazo máximo de 5 días hábiles a partir de la fecha de este aviso, su cuenta será remitida a nuestros asesores legales para iniciar las acciones de cobro correspondientes.\n\nLe instamos a evitar este escenario contactándonos de inmediato.\n\nAtentamente,\nDepartamento de Cuentas por Cobrar\nSuministros Guipak, S.R.L.',
 'LEGAL', 1, 1),

(6, '6to aviso — Notificación legal', 'Cuenta referida a abogados — 90+ días', 'ROJO', 90, 3,
 'NOTIFICACIÓN: Cuenta {{factura}} remitida a gestión legal',
 'Estimado/a {{contacto}},\n\nPor medio de la presente le notificamos que, ante la falta de pago y respuesta sobre la factura #{{factura}} (NCF: {{ncf}}) por RD${{monto}}, con {{dias_vencido}} días de mora, su cuenta ha sido formalmente remitida al departamento legal de Suministros Guipak, S.R.L.\n\nA partir de este momento, todas las gestiones de cobro serán manejadas por nuestros asesores legales y los costos legales correspondientes serán cargados a su cuenta conforme a la legislación vigente de la República Dominicana.\n\nSi desea evitar las acciones legales, debe comunicarse de inmediato al departamento de cobros para liquidar el saldo total adeudado o establecer un acuerdo de pago formal.\n\nAtentamente,\nDepartamento Legal\nSuministros Guipak, S.R.L.',
 'LEGAL', 1, 1);
