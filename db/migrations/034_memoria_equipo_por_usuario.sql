-- 034: Memoria de equipo por usuario_id, no solo por telegram_user_id.
-- El widget web (app/api/cobranzas/asistente/chat/route.ts) usa telegram_user_id=0
-- para TODOS los usuarios web, asi que guardar_preferencia_equipo desde la web
-- escribia y leia del MISMO balde para cualquier persona que usara el chat web --
-- las preferencias de una persona se filtraban a las demas. usuario_id (el id
-- real de la tabla `usuarios`, que SI distingue personas en el widget web)
-- resuelve eso. `ambito` separa "solo esta persona" de "todo el equipo" para
-- cuando haga falta guardar una regla compartida (Fase 4).
--
-- telegram_user_id se conserva tal cual (sigue NOT NULL, sigue siendo 0 desde
-- la web) -- solo deja de ser la clave de identidad para lectura/escritura.

ALTER TABLE cobranza_telegram_memoria_equipo
  ADD COLUMN usuario_id INT NULL AFTER telegram_user_id,
  ADD COLUMN ambito ENUM('USUARIO','EQUIPO') NOT NULL DEFAULT 'USUARIO' AFTER clave;

-- Backfill desde el vinculo Telegram->usuario ya existente. Solo cubre filas
-- con un telegram_user_id real y vinculado (>0).
UPDATE cobranza_telegram_memoria_equipo m
  JOIN cobranza_telegram_usuarios t ON t.telegram_user_id = m.telegram_user_id
  SET m.usuario_id = t.usuario_id
  WHERE m.telegram_user_id > 0;

-- Filas con telegram_user_id=0 (guardadas desde el widget web antes de este
-- fix, sin distincion de persona) quedan como EQUIPO: ya eran visibles para
-- cualquiera que abriera el chat web, asi que tratarlas como compartidas es
-- lo mas fiel a como se comportaban hasta ahora.
UPDATE cobranza_telegram_memoria_equipo
  SET ambito = 'EQUIPO'
  WHERE telegram_user_id = 0;

ALTER TABLE cobranza_telegram_memoria_equipo
  DROP INDEX uq_user_clave,
  ADD UNIQUE KEY uq_usuario_clave (usuario_id, clave(100));
