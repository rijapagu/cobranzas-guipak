-- Migración 013: Tareas y Calendario
--
-- Tabla para recordatorios y agenda operativa de cobranzas:
--   - Manuales: "llamar a Master Clean", "depositar cheque jueves"
--   - Auto-generadas: seguimientos a acuerdos de pago (origen=ACUERDO_PAGO)
--   - Cadencias: pasos de cadencia agendados (origen=CADENCIA, futuro)
--
-- Idempotente: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS cobranza_tareas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT NULL,
  tipo ENUM('LLAMAR','DEPOSITAR_CHEQUE','SEGUIMIENTO','DOCUMENTO','REUNION','OTRO')
    NOT NULL DEFAULT 'OTRO',
  fecha_vencimiento DATE NOT NULL,
  hora TIME NULL,
  -- Relación opcional con cliente o factura Softec
  codigo_cliente VARCHAR(20) NULL,
  ij_inum INT NULL,
  -- Estado
  estado ENUM('PENDIENTE','EN_PROGRESO','HECHA','CANCELADA')
    NOT NULL DEFAULT 'PENDIENTE',
  prioridad ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
  -- Asignación
  asignada_a VARCHAR(100) NULL,
  creado_por VARCHAR(100) NOT NULL,
  -- Origen
  origen ENUM('MANUAL','ACUERDO_PAGO','CADENCIA') NOT NULL DEFAULT 'MANUAL',
  origen_ref VARCHAR(50) NULL,
  -- Auditoría de cierre
  completada_at DATETIME NULL,
  completada_por VARCHAR(100) NULL,
  notas_completado TEXT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fecha_estado (fecha_vencimiento, estado),
  INDEX idx_cliente (codigo_cliente),
  INDEX idx_asignada (asignada_a, estado),
  INDEX idx_origen (origen, origen_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
