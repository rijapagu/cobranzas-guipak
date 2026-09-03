-- 035: Memoria episodica (Fase 4) -- el historial de chat se vuelve buscable
-- por cliente y por texto libre, para la tool recordar_conversaciones y para
-- linea_de_tiempo_cliente.
--
-- codigo_cliente etiqueta cada mensaje con la sesion vigente en ese momento
-- (agent.ts la pasa a guardarMensaje) -- no es un JOIN calculado despues, es
-- lo que el bot sabia que estaba activo cuando se guardo el mensaje. Queda
-- NULL en mensajes sin sesion (preguntas de cartera completa, saludos, etc).
--
-- FULLTEXT en InnoDB con utf8mb4: soportado desde MySQL 5.6+, la tabla solo
-- crece (nunca se actualiza el contenido de una fila ya escrita) asi que no
-- hay costo de reindexado por UPDATE.

ALTER TABLE cobranza_telegram_historial
  ADD COLUMN codigo_cliente VARCHAR(20) NULL AFTER contenido,
  ADD INDEX idx_cliente_ts (codigo_cliente, created_at),
  ADD FULLTEXT INDEX ft_contenido (contenido);
