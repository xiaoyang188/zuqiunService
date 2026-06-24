-- 足球赛况 · 阿里云 RDS MySQL 表结构
-- 执行: npm run db:init

CREATE TABLE IF NOT EXISTS leagues (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  league_key  VARCHAR(64)  NOT NULL COMMENT '内部联赛 key，如 Premier League',
  slug        VARCHAR(64)  NOT NULL COMMENT 'ESPN slug，如 eng.1',
  label       VARCHAR(64)  NOT NULL,
  country     VARCHAR(64)  DEFAULT '',
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_league_key (league_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS teams (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  external_id VARCHAR(32)  NOT NULL COMMENT 'ESPN team id',
  name        VARCHAR(128) NOT NULL,
  logo        VARCHAR(512) DEFAULT '',
  country     VARCHAR(64)  DEFAULT '',
  league_key  VARCHAR(64)  DEFAULT '',
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_team_external (external_id),
  KEY idx_team_league (league_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matches (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  external_id  VARCHAR(32)  NOT NULL COMMENT 'ESPN event id',
  league_key   VARCHAR(64)  NOT NULL,
  status       VARCHAR(16)  NOT NULL COMMENT 'NS/LIVE/HT/FT/POSTPONED',
  match_time   DATETIME     NOT NULL,
  minute       INT          NULL,
  home_score   INT          NOT NULL DEFAULT 0,
  away_score   INT          NOT NULL DEFAULT 0,
  payload      JSON         NOT NULL COMMENT '小程序 Match 完整 JSON',
  synced_at    DATETIME     NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_match_external (external_id),
  KEY idx_match_time (match_time),
  KEY idx_league_time (league_key, match_time),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS standings (
  id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  league_key        VARCHAR(64)  NOT NULL,
  team_external_id  VARCHAR(32)  NOT NULL,
  rank              INT          NOT NULL DEFAULT 0,
  played            INT          NOT NULL DEFAULT 0,
  win               INT          NOT NULL DEFAULT 0,
  draw              INT          NOT NULL DEFAULT 0,
  lose              INT          NOT NULL DEFAULT 0,
  gf                INT          NOT NULL DEFAULT 0,
  ga                INT          NOT NULL DEFAULT 0,
  gd                INT          NOT NULL DEFAULT 0,
  points            INT          NOT NULL DEFAULT 0,
  payload           JSON         NOT NULL COMMENT '小程序 Standing JSON（含 form/formText）',
  synced_at         DATETIME     NOT NULL,
  UNIQUE KEY uk_standing_league_team (league_key, team_external_id),
  KEY idx_standing_league (league_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS brackets (
  league_key   VARCHAR(64)  NOT NULL PRIMARY KEY COMMENT '联赛 key',
  payload      JSON         NOT NULL COMMENT '淘汰赛轮次数组 BracketRound[]',
  synced_at    DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS player_rankings (
  league_key   VARCHAR(64)  NOT NULL COMMENT '联赛 key',
  kind         VARCHAR(16)  NOT NULL COMMENT 'scorers | assists',
  payload      JSON         NOT NULL COMMENT '射手/助攻榜 JSON 数组',
  synced_at    DATETIME     NOT NULL,
  PRIMARY KEY (league_key, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS players (
  external_id  VARCHAR(32)  NOT NULL COMMENT 'ESPN athlete id',
  league_key   VARCHAR(64)  NOT NULL,
  payload      JSON         NOT NULL COMMENT '球员详情 JSON',
  synced_at    DATETIME     NOT NULL,
  PRIMARY KEY (external_id, league_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_name     VARCHAR(64)  NOT NULL,
  status       VARCHAR(16)  NOT NULL COMMENT 'ok/error',
  message      VARCHAR(512) DEFAULT '',
  rows_affected INT         NOT NULL DEFAULT 0,
  started_at   DATETIME     NOT NULL,
  finished_at  DATETIME     NOT NULL,
  KEY idx_sync_job_time (job_name, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
