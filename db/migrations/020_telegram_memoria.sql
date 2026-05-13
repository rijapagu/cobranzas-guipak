-- Migración 020: Memoria permanente del asistente Telegram
-- Historial completo de conversaciones (nunca se borra)
-- Memoria del equipo (preferencias, patrones, contexto del negocio)

CREATE TABLE IF NOT EXISTS cobranza_telegram_historial (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chat_id       BIGINT          NOT NULL,
  telegram_user_id BIGINT       NOT NULL,
  rol           ENUM('usuario','asistente') NOT NULL,
  contenido     TEXT            NOT NULL,
  created_at    DATETIME        DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_ts   (chat_id, created_at),
  INDEX idx_user_ts   (telegram_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cobranza_telegram_memoria_equipo (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  telegram_user_id BIGINT       NOT NULL,
  clave            VARCHAR(200) NOT NULL,
  valor            TEXT         NOT NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_clave (telegram_user_id, clave(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
