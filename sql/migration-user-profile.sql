-- 用户昵称与头像（个人资料）
ALTER TABLE users
  ADD COLUMN nickname VARCHAR(64) NOT NULL DEFAULT '' COMMENT '昵称' AFTER openid,
  ADD COLUMN avatar_url VARCHAR(512) NOT NULL DEFAULT '' COMMENT '头像 URL' AFTER nickname;
