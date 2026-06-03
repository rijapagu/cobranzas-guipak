-- Migración 027: añade el tipo 'LOTE_COBRANZA_DIRIGIDO' al ENUM de alertas.
--
-- Es la primera DELEGACIÓN Supervisor→Asistente: el Supervisor selecciona una
-- cohorte estratégica (clientes top por exposición, ROJO/CRÍTICO y empeorando),
-- el Asistente redacta los borradores (proponerCorreoCliente), caen en la Cola
-- de Aprobación, y el Supervisor notifica al CEO lo que encoló. El equipo de
-- cobros aprueba cada envío (compuerta única). Patrón acordado 2026-06-03.

ALTER TABLE cobranza_supervisor_alertas
  MODIFY COLUMN tipo ENUM(
    'TOP10_CRUZA_UMBRAL',
    'PROMESA_GRANDE_INCUMPLIDA',
    'CAMBIO_HABITO_CLIENTE',
    'CASHFLOW_ROJO_7D',
    'LOTE_COBRANZA_DIRIGIDO'
  ) NOT NULL DEFAULT 'TOP10_CRUZA_UMBRAL';
