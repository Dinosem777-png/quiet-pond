CREATE TABLE IF NOT EXISTS orders (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 telegram_id BIGINT NOT NULL,
 payload VARCHAR(64) NOT NULL UNIQUE,
 kind VARCHAR(40) NOT NULL,
 prompt VARCHAR(700) NOT NULL DEFAULT '',
 sign VARCHAR(30) NOT NULL DEFAULT '',
 stars INT UNSIGNED NOT NULL,
 status ENUM('pending','paid','fulfilled','refunded') NOT NULL DEFAULT 'pending',
 telegram_charge_id VARCHAR(128) NULL UNIQUE,
 result MEDIUMTEXT NULL,
 created_at DATETIME NOT NULL,
 paid_at DATETIME NULL,
 INDEX idx_user_created (telegram_id,created_at),
 INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
