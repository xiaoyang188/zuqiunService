-- VibeCoding 新闻全文 content 字段
-- 执行: npm run db:migrate:vibecoding-content

ALTER TABLE vibecoding_items
  ADD COLUMN content         MEDIUMTEXT NULL COMMENT '原文全文（Markdown 或 HTML 源码）' AFTER summary_zh,
  ADD COLUMN content_zh      MEDIUMTEXT NULL COMMENT '中文全文' AFTER content,
  ADD COLUMN content_format  VARCHAR(16) NOT NULL DEFAULT '' COMMENT 'markdown | html | plain' AFTER content_zh,
  ADD COLUMN content_status  VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending | ok | failed | skipped' AFTER content_format,
  ADD COLUMN content_fetched_at DATETIME NULL COMMENT '全文抓取时间' AFTER content_status;
