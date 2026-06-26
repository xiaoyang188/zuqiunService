-- 赛程日：与 ESPN scoreboard dates 对齐，解决开球 UTC 转上海后落在「次日」导致今日为空
ALTER TABLE matches
  ADD COLUMN schedule_day DATE NULL COMMENT 'ESPN 赛程日（上海 YYYY-MM-DD）' AFTER match_time,
  ADD KEY idx_schedule_day (schedule_day);
