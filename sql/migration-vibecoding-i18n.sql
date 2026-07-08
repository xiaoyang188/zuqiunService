-- VibeCoding 中文翻译 + 图标 URL
-- 执行: npm run db:migrate:vibecoding-i18n

ALTER TABLE vibecoding_items
  ADD COLUMN title_zh VARCHAR(500) NOT NULL DEFAULT '' COMMENT '中文标题' AFTER title,
  ADD COLUMN summary_zh TEXT NULL COMMENT '中文摘要' AFTER summary;
