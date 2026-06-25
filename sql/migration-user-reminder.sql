-- V1.3 用户 / 关注 / 提醒表（可单独在宝塔 MySQL 执行）
-- 若 npm run db:init 报外键错误，执行本文件即可

CREATE TABLE IF NOT EXISTS users (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  openid           VARCHAR(64)  NOT NULL COMMENT '微信 openid',
  token            VARCHAR(64)  NOT NULL COMMENT '登录 token，Bearer 鉴权',
  token_expires_at DATETIME     NOT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_openid (openid),
  UNIQUE KEY uk_user_token (token),
  KEY idx_user_token_exp (token_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS follow_teams (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT       NOT NULL,
  team_external_id VARCHAR(32)  NOT NULL COMMENT 'ESPN team id，不含 espn_team_ 前缀',
  team_name        VARCHAR(128) NOT NULL DEFAULT '',
  team_logo        VARCHAR(512) NOT NULL DEFAULT '',
  team_league      VARCHAR(64)  NOT NULL DEFAULT '',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_follow_user_team (user_id, team_external_id),
  KEY idx_follow_user (user_id),
  CONSTRAINT fk_follow_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS team_reminders (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT       NOT NULL,
  team_external_id VARCHAR(32)  NOT NULL,
  advance_minutes  INT          NOT NULL COMMENT '1440 / 60 / 15',
  enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_reminder_user_team (user_id, team_external_id),
  KEY idx_reminder_enabled (enabled, advance_minutes),
  CONSTRAINT fk_reminder_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reminder_sent_log (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id           BIGINT       NOT NULL,
  match_external_id VARCHAR(32)  NOT NULL COMMENT 'ESPN event id',
  advance_minutes   INT          NOT NULL,
  sent_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sent_user_match_advance (user_id, match_external_id, advance_minutes),
  KEY idx_sent_at (sent_at),
  CONSTRAINT fk_sent_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
