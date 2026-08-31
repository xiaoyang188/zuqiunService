-- 搜索索引：球员/球队本地检索（避免实时打懂球帝/ESPN）
CREATE TABLE IF NOT EXISTS search_index (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type   ENUM('player','team') NOT NULL,
  external_id   VARCHAR(32)  NOT NULL,
  source        VARCHAR(16)  NOT NULL DEFAULT 'dongqiu',
  name          VARCHAR(128) NOT NULL,
  name_en       VARCHAR(128) NOT NULL DEFAULT '',
  name_norm     VARCHAR(128) NOT NULL DEFAULT '' COMMENT '小写名，LIKE 检索',
  subtitle      VARCHAR(256) NOT NULL DEFAULT '',
  logo          VARCHAR(512) NOT NULL DEFAULT '',
  league_key    VARCHAR(64)  NOT NULL DEFAULT '',
  league_label  VARCHAR(64)  NOT NULL DEFAULT '',
  payload       JSON         NULL,
  synced_at     DATETIME     NOT NULL,
  UNIQUE KEY uk_search_type_src_id (entity_type, source, external_id),
  KEY idx_search_name_norm (name_norm),
  KEY idx_search_name (name),
  KEY idx_search_league (league_key, entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
