-- VibeCoding 鉴赏 · 表结构
-- 执行: npm run db:migrate:vibecoding

CREATE TABLE IF NOT EXISTS vibecoding_items (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  type           VARCHAR(20)  NOT NULL DEFAULT 'project' COMMENT 'project | news | tool',
  source         VARCHAR(20)  NOT NULL COMMENT 'hn | github | manual',
  external_id    VARCHAR(100) NOT NULL COMMENT '来源侧唯一 ID',
  title          VARCHAR(500) NOT NULL,
  summary        TEXT,
  url            VARCHAR(1000) NOT NULL DEFAULT '',
  image_url      VARCHAR(1000) NOT NULL DEFAULT '',
  author         VARCHAR(200) NOT NULL DEFAULT '',
  score          INT          NOT NULL DEFAULT 0,
  comment_count  INT          NOT NULL DEFAULT 0,
  tags           JSON         NULL,
  published_at   DATETIME     NULL,
  synced_at      DATETIME     NOT NULL,
  is_featured    TINYINT(1)   NOT NULL DEFAULT 0,
  status         VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_vibe_source_external (source, external_id),
  KEY idx_vibe_published (published_at),
  KEY idx_vibe_score (score),
  KEY idx_vibe_type_status (type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vibecoding_sync_logs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  source       VARCHAR(20)  NOT NULL,
  status       VARCHAR(16)  NOT NULL COMMENT 'ok | error',
  item_count   INT          NOT NULL DEFAULT 0,
  error_msg    VARCHAR(512) NOT NULL DEFAULT '',
  started_at   DATETIME     NOT NULL,
  finished_at  DATETIME     NOT NULL,
  KEY idx_vibe_sync_time (source, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
