# zuqiu-api · VibeCoding 鉴赏后端开发文档

> **给 zuqiu 项目维护者**：RuleHub（前端）与 zuqiu-api（后端）是**两个独立仓库**。  
> 本文档描述 RuleHub「VibeCoding 鉴赏」功能对 zuqiu-api 的全部后端需求，可直接按此实现或对照合并。

---

## 1. 项目关系

| 项目 | 仓库/路径 | 部署 | 职责 |
|------|-----------|------|------|
| **RuleHub** | `d:\Desktop\ruleHub` | `www.yimingyinglou.top` :3001 | Next.js 网站，只消费 API |
| **zuqiu-api** | `d:\Desktop\zuqiu\server` | `api.yimingyinglou.top` :3000 | Express + MySQL，提供数据与同步 |

```
Hacker News API
      ↓ 定时任务（zuqiu-api 内）
MySQL vibecoding_items
      ↓ HTTP
RuleHub  /api/vibecoding/items  →  代理  →  zuqiu-api /api/vibecoding/items
      ↓
用户浏览器  /vibecoding 页面
```

**RuleHub 不会写数据库**，所有持久化与抓取逻辑都在 zuqiu-api。

---

## 2. 技术栈（与现有 zuqiu-api 一致）

- **运行时**：Node.js + Express 4
- **数据库**：MySQL（阿里云 RDS，`USE_DATABASE=true`）
- **响应格式**：与现有足球 API 相同 `{ code, data, message }`
- **定时任务**：挂在现有 `src/sync/scheduler.js`
- **无需新 npm 依赖**（HN 用原生 `fetch`）

---

## 3. 数据库

### 3.1 迁移文件

新建 `sql/migration-vibecoding.sql`（或合并进 `schema.sql`）：

```sql
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
```

### 3.2 执行迁移

```bash
cd server
npm run db:migrate:vibecoding   # 见下方 package.json 脚本
```

`package.json` 增加：

```json
"db:migrate:vibecoding": "node src/scripts/migrate-vibecoding.js"
```

`src/scripts/migrate-vibecoding.js` 复用现有 `init-db-helpers.js` 的 `runSqlFile('migration-vibecoding.sql')` 即可。

---

## 4. REST API 规范

**Base URL**：`https://api.yimingyinglou.top`（或本地 `http://127.0.0.1:3000`）

**统一响应**：

```json
{ "code": 0, "data": { ... }, "message": "ok" }
{ "code": 1, "data": null, "message": "错误说明" }
```

`code === 0` 表示成功（与现有 `/api/schedule` 等一致）。

---

### 4.1 列表

```
GET /api/vibecoding/items
```

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `type` | string | 无 | `project` / `news` / `tool` |
| `source` | string | 无 | `hn` / `github` / `manual` |
| `page` | number | 1 | 页码 |
| `limit` | number | 20 | 每页条数，最大 50 |
| `sort` | string | `score` | `score` 按热度 / `recent` 按时间 |

**成功响应 `data`：**

```json
{
  "items": [
    {
      "id": 1,
      "type": "project",
      "source": "hn",
      "externalId": "39200123",
      "title": "Show HN: My AI coding tool",
      "summary": "…",
      "url": "https://example.com",
      "imageUrl": "",
      "author": "someuser",
      "score": 128,
      "commentCount": 45,
      "tags": ["show-hn", "vibecoding"],
      "publishedAt": "2026-07-06T10:00:00.000Z",
      "syncedAt": "2026-07-06T12:00:00.000Z",
      "isFeatured": false
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "hasNext": true
}
```

**字段命名**：JSON 使用 **camelCase**（与 RuleHub 前端一致）。

---

### 4.2 详情

```
GET /api/vibecoding/items/:id
```

返回单条 `VibecodingItem`（结构同上 `items[0]`）。

- `404`：`{ "code": 1, "message": "条目不存在" }`

---

### 4.3 手动同步（运维 / 首次灌数据）

```
POST /api/vibecoding/sync
```

**成功 `data`：**

```json
{ "ok": true, "count": 15 }
```

**失败**：HTTP 500，`message` 含原因。

> 生产环境建议后续加简单鉴权（如 `Authorization: Bearer <SYNC_SECRET>`），当前 MVP 可内网调用。

---

### 4.4 错误码

| HTTP | code | 场景 |
|------|------|------|
| 200 | 0 | 成功 |
| 400 | 1 | 参数无效 |
| 404 | 1 | 条目不存在 |
| 503 | 503 | `USE_DATABASE=false` 或未配 MySQL |
| 500 | 1 | 服务器错误 |

---

## 5. 数据同步（Hacker News Show HN）

### 5.1 数据源

- **官方 API**：https://github.com/HackerNews/API  
- **免费、无需 Key、无硬性 rate limit**（请合理缓存）

### 5.2 同步流程

1. `GET https://hacker-news.firebaseio.com/v0/showstories.json` → 得到 id 数组  
2. 取前 **40** 条 id  
3. 对每个 id：`GET https://hacker-news.firebaseio.com/v0/item/{id}.json`  
4. 过滤：
   - 跳过 `deleted` / `dead` / 无 `title`  
   - 标题或正文含关键词（见下）才入库  
5. `UPSERT` 到 `vibecoding_items`（`source='hn'`, `external_id=item.id`）

### 5.3 关键词过滤（Vibe / AI 向）

标题 + summary 匹配任一即可（不区分大小写）：

```
ai, agent, llm, gpt, claude, codex, cursor, vibe, coding,
skill, automation, devtools, open source, startup, saas, app, tool
```

### 5.4 字段映射

| DB 字段 | HN 字段 |
|---------|---------|
| `external_id` | `id` |
| `title` | `title` |
| `summary` | `text`（去 HTML，截 500 字） |
| `url` | `url` 或 `https://news.ycombinator.com/item?id={id}` |
| `author` | `by` |
| `score` | `score` |
| `comment_count` | `descendants` |
| `published_at` | `time`（Unix 秒 → DATETIME） |
| `type` | 固定 `project` |
| `source` | 固定 `hn` |
| `tags` | `["show-hn","vibecoding"]` |

### 5.5 定时任务

在 `src/sync/scheduler.js` 中（`USE_DATABASE=true` 且 `SYNC_ENABLED` 时）：

- 启动时执行一次 `syncVibecodingOnce()`  
- `setInterval` 默认 **30 分钟**（环境变量 `VIBECODING_SYNC_MS=1800000`）

`.env.example` 增加：

```env
VIBECODING_SYNC_MS=1800000
```

---

## 6. 建议文件结构（zuqiu/server）

```
server/
├── sql/
│   └── migration-vibecoding.sql          # 新建
├── src/
│   ├── index.js                          # 增加 app.use('/api', vibecodingRoutes)
│   ├── repositories/
│   │   └── vibecodingRepo.js             # 新建：list / getById / upsert / syncLog
│   ├── routes/
│   │   └── vibecodingRoutes.js           # 新建：3 个路由
│   ├── sync/
│   │   ├── scheduler.js                  # 修改：注册定时同步
│   │   └── vibecodingSync.js             # 新建：HN 抓取逻辑
│   └── scripts/
│       └── migrate-vibecoding.js         # 新建
└── package.json                          # 增加 db:migrate:vibecoding
```

### 6.1 index.js 注册

```javascript
const vibecodingRoutes = require('./routes/vibecodingRoutes');
// ...
app.use('/api', userRoutes);
app.use('/api', vibecodingRoutes);
```

### 6.2 参考实现

本地已有一份完整参考实现（可直接复制到 zuqiu 仓库）：

| 文件 | 路径 |
|------|------|
| 迁移 SQL | `zuqiu/server/sql/migration-vibecoding.sql` |
| Repository | `zuqiu/server/src/repositories/vibecodingRepo.js` |
| 同步 | `zuqiu/server/src/sync/vibecodingSync.js` |
| 路由 | `zuqiu/server/src/routes/vibecodingRoutes.js` |
| 迁移脚本 | `zuqiu/server/src/scripts/migrate-vibecoding.js` |

---

## 7. RuleHub 前端对接说明（给后端同学了解即可）

RuleHub **已实现**，只需 zuqiu-api 按上文提供接口。

| RuleHub 位置 | 行为 |
|--------------|------|
| `src/lib/vibecoding-api.ts` | 服务端 fetch `ZUQIU_API_BASE/api/vibecoding/items` |
| `src/app/api/vibecoding/items/route.ts` | BFF 代理，避免浏览器 CORS |
| `src/app/vibecoding/page.tsx` | 展示页 |
| Header 导航 | 「VibeCoding」→ `/vibecoding` |

**RuleHub 环境变量**（可选）：

```env
ZUQIU_API_BASE=https://api.yimingyinglou.top
```

默认即是 `https://api.yimingyinglou.top`，不配也能用。

**RuleHub 实际请求示例**：

```
GET /api/vibecoding/items?page=1&limit=20&sort=score&type=project&source=hn
```

---

## 8. 部署清单（zuqiu-api 服务器）

```bash
cd /path/to/zuqiu/server

# 1. 拉代码 / 合并 VibeCoding 相关文件
git pull

# 2. 数据库迁移
npm run db:migrate:vibecoding

# 3. 重启 PM2
pm2 restart zuqiu-api

# 4. 首次灌数据
curl -X POST https://api.yimingyinglou.top/api/vibecoding/sync

# 5. 验证
curl "https://api.yimingyinglou.top/api/vibecoding/items?page=1&limit=5"
```

期望：返回 `code: 0`，`data.items` 为非空数组（同步成功后）。

---

## 9. 与现有足球 API 的关系

- **共用**：Express 实例、MySQL 连接池、PM2 进程（`zuqiu-api` :3000）  
- **独立**：新表 `vibecoding_*`，新路由前缀 `/api/vibecoding/*`  
- **不冲突**：足球路由仍是 `/api/schedule`、`/api/matches/*` 等  

Nginx：`api.yimingyinglou.top` 继续反代 **3000** 即可，无需新 location。

---

## 10. 后续扩展（可选）

| 阶段 | 内容 | 说明 |
|------|------|------|
| v1（当前） | HN Show HN | 已实现 |
| v2 | GitHub Trending | 无官方 API，需社区代理或自爬；`source=github` |
| v3 | 手动精选 | `POST /api/vibecoding/items` 管理端，`source=manual` |
| v4 | Dev.to / Reddit | 需 API Key 或 RSS |

扩展时保持 **`source + external_id` 唯一** 即可。

---

## 11. 验收标准

- [ ] `npm run db:migrate:vibecoding` 成功  
- [ ] `POST /api/vibecoding/sync` 返回 `count > 0`  
- [ ] `GET /api/vibecoding/items` 返回分页数据，字段为 camelCase  
- [ ] 重启后定时任务日志出现 `[vibecoding] HN Show 同步完成`  
- [ ] RuleHub `https://www.yimingyinglou.top/vibecoding` 能展示卡片列表  

---

## 12. 联系方式 / 问题

- RuleHub 前端问题：查 `ruleHub` 仓库 `docs/` 与本文件第 7 节  
- 接口字段变更：**必须先改 zuqiu-api，再改 RuleHub `vibecoding-api.ts`**，保持契约一致  

---

*文档版本：2026-07-06 · 对应 RuleHub VibeCoding 鉴赏 MVP*
