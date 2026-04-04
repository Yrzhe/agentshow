# AgentShow 功能测试实施文档

> 日期: 2026-04-04
> 目标: 逐项验证所有后端功能，重点测试 Docker 部署 + 本地 Daemon 联动

---

## 测试环境准备

### 前置条件

```bash
# 1. 确认 daemon 在运行
curl -s http://127.0.0.1:45677/health

# 2. 确认 daemon 数据库有数据
ls -la ~/.agentshow/agentshow.db

# 3. 确认 daemon sync 配置
cat ~/.agentshow/config.json
```

### 启动 Server (两种方式任选)

**方式 A: 直接运行 (推荐先测这个)**

```bash
cd packages/server
npm run build
JWT_SECRET=test-secret-123 DATABASE_PATH=./data/test.db PORT=3001 node dist/main.js
```

**方式 B: Docker Compose**

```bash
# 创建 .env
cat > .env << 'EOF'
JWT_SECRET=test-secret-123
DATABASE_PATH=/data/agentshow.db
PORT=3000
AI_PROVIDER=disabled
EOF

docker compose up --build -d
```

### 创建测试用户和 API Token

```bash
# 用 sqlite3 手动创建（或通过 email login）
SERVER=http://localhost:3001  # 改成你的端口

sqlite3 packages/server/data/test.db "
INSERT OR IGNORE INTO users (user_id, email, created_at)
VALUES ('test-user-1', 'test@example.com', datetime('now'));

INSERT INTO api_tokens (id, user_id, name, token_hash, prefix, created_at)
VALUES (
  'tok_test1', 'test-user-1', 'Test Token',
  -- hash of 'test-token-abc123'
  '$(echo -n test-token-abc123 | shasum -a 256 | cut -d' ' -f1)',
  'test-',
  datetime('now')
);
"

# 验证 token 工作
TOKEN="test-token-abc123"
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/health
```

---

## Phase 1: 基础连通性

### T1.1 Server 健康检查
```bash
curl -s $SERVER/api/health
# 期望: {"status":"ok"}
```
- [ ] 通过

### T1.2 认证拦截
```bash
# 无 token 应该 401
curl -s $SERVER/api/sessions
# 期望: {"error":"Unauthorized"}

# 有 token 应该正常
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/sessions
# 期望: {"sessions":[]}
```
- [ ] 无 token → 401
- [ ] 有 token → 200

### T1.3 Dashboard 可访问
```bash
curl -s -o /dev/null -w "%{http_code}" $SERVER/
# 期望: 200
```
- [ ] 通过

---

## Phase 2: Daemon → Server 同步 (核心链路)

这是最关键的测试。验证本地 daemon 的数据能同步到 server。

### T2.1 修改 Daemon 配置指向本地 Server

```bash
# 备份原配置
cp ~/.agentshow/config.json ~/.agentshow/config.json.bak

# 修改配置指向本地 server
cat > ~/.agentshow/config.json << EOF
{
  "device_id": "dev_macbook01",
  "cloud": {
    "url": "http://localhost:3001",
    "token": "$TOKEN"
  },
  "privacy": {
    "level": 2
  }
}
EOF
```
- [ ] 配置已修改

### T2.2 手动触发一次 Sync

等待 30 秒（daemon 的 sync interval），或者重启 daemon：
```bash
# 重启 daemon 让配置生效
launchctl unload ~/Library/LaunchAgents/com.agentshow.daemon.plist
launchctl load ~/Library/LaunchAgents/com.agentshow.daemon.plist

# 等待 30-60 秒，检查 daemon 日志
tail -20 ~/.agentshow/daemon.log
```
- [ ] daemon 日志无错误
- [ ] 日志显示 sync 成功

### T2.3 验证 Sessions 同步
```bash
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/sessions | python3 -m json.tool
# 期望: sessions 数组非空，包含本地的 Claude Code session 数据
```
- [ ] sessions 非空
- [ ] session 有 project_slug, status, token 数据
- [ ] session 有 task 字段（来自 MCP bridge）

### T2.4 验证 Events 同步
```bash
# 取第一个 session_id
SESSION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/sessions | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['sessions'][0]['session_id'] if d['sessions'] else '')")

curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/sessions/$SESSION_ID" | python3 -m json.tool | head -30
# 期望: 包含 events 数组
```
- [ ] events 非空
- [ ] events 有 role, content_preview, tool_name

### T2.5 验证 Notes 同步
```bash
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/notes | python3 -m json.tool
# 期望: 如果 MCP 有 shared notes，这里应该有数据
```
- [ ] API 正常返回（即使为空也算通过）

### T2.6 恢复原始配置
```bash
cp ~/.agentshow/config.json.bak ~/.agentshow/config.json
```
- [ ] 已恢复

---

## Phase 3: 查询 & 搜索

### T3.1 Projects 列表
```bash
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/projects | python3 -m json.tool
# 期望: 按 project_slug 聚合的项目列表
```
- [ ] projects 非空
- [ ] 每个 project 有 active_sessions, total_input_tokens

### T3.2 全文搜索
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/search?q=test&limit=5" | python3 -m json.tool
# 期望: results 数组 + total 计数
```
- [ ] API 返回正确结构
- [ ] 搜索结果有 source_type (event/note)

### T3.3 每日工作总结
```bash
TODAY=$(date +%Y-%m-%d)
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/daily-summary?date=$TODAY" | python3 -m json.tool
# 期望: date, projects 数组, totals
```
- [ ] 返回正确日期
- [ ] projects 按项目分组

---

## Phase 4: 成本管理

### T4.1 Usage Daily
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/usage/daily?days=7" | python3 -m json.tool
# 期望: daily 数组，每项有 date, input_tokens, output_tokens, estimated_cost
```
- [ ] daily 数据正确
- [ ] estimated_cost 计算合理

### T4.2 Usage Cost
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/usage/cost?days=30" | python3 -m json.tool
# 期望: estimated_total_cost, daily 数组, pricing 对象
```
- [ ] total cost 是 daily 之和
- [ ] pricing 包含 Claude 模型价格

### T4.3 Budget CRUD
```bash
# 创建日预算
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"budget_type":"daily","limit_usd":10,"alert_threshold":0.8}' \
  $SERVER/api/budget
# 期望: {"status":"ok"}

# 查看预算
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/budget | python3 -m json.tool
# 期望: budgets 数组含 current_usage_usd, usage_percent, is_over_threshold

# 创建月预算
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"budget_type":"monthly","limit_usd":100,"alert_threshold":0.8}' \
  $SERVER/api/budget

# 查看两个预算
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/budget | python3 -m json.tool

# 删除日预算
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" $SERVER/api/budget/daily
```
- [ ] 创建成功
- [ ] 查询返回 current_usage_usd
- [ ] 删除成功

### T4.4 Cost Attribution
```bash
# 按项目
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/cost/by-project?days=30" | python3 -m json.tool

# 按工具
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/cost/by-tool?days=30" | python3 -m json.tool

# 按 session（指定项目）
PROJECT=$(curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/cost/by-project?days=30" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['projects'][0]['project_slug'] if d['projects'] else '')")
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/cost/by-session?days=30&project=$PROJECT" | python3 -m json.tool
```
- [ ] by-project 有 estimated_cost
- [ ] by-tool 按 tool_name 聚合
- [ ] by-session 可按 project 过滤

---

## Phase 5: Webhook

### T5.1 Webhook CRUD
```bash
# 创建 webhook（用 httpbin 测试）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test Hook","url":"https://httpbin.org/post","secret":"my-secret","events":"session.ended"}' \
  $SERVER/api/webhooks | python3 -m json.tool

# 列出 webhooks
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/webhooks | python3 -m json.tool

# 获取 webhook ID
WH_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/webhooks | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['webhooks'][0]['id'] if d.get('webhooks') else '')")
```
- [ ] 创建成功
- [ ] 列表返回正确

### T5.2 Webhook 测试投递
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$SERVER/api/webhooks/$WH_ID/test" | python3 -m json.tool
# 期望: 返回 success + status_code
```
- [ ] 测试投递成功
- [ ] httpbin 返回 200

### T5.3 Webhook 投递历史
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/webhooks/$WH_ID/deliveries" | python3 -m json.tool
# 期望: deliveries 数组含刚才的测试投递
```
- [ ] 历史记录存在

---

## Phase 6: 团队功能

### T6.1 创建团队
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Test Team"}' \
  $SERVER/api/teams | python3 -m json.tool

TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/teams | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['teams'][0]['id'] if d.get('teams') else '')")
```
- [ ] 创建成功
- [ ] 创建者自动为 admin

### T6.2 团队详情
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/teams/$TEAM_ID" | python3 -m json.tool
# 期望: 团队信息 + 成员列表
```
- [ ] 成员列表包含自己（admin 角色）

### T6.3 团队 Sessions & Usage
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/teams/$TEAM_ID/sessions" | python3 -m json.tool
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/teams/$TEAM_ID/usage" | python3 -m json.tool
```
- [ ] sessions 返回当前用户的 session
- [ ] usage 有 token 汇总

### T6.4 团队周报
```bash
WEEK_START=$(date -v-monday +%Y-%m-%d 2>/dev/null || date -d"last monday" +%Y-%m-%d)
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/teams/$TEAM_ID/report?week=$WEEK_START" | python3 -m json.tool
# 期望: members 数组含 session_count, input_tokens, estimated_cost
```
- [ ] 返回成员级别的统计

---

## Phase 7: 审计日志

### T7.1 审计日志列表
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/audit?limit=10" | python3 -m json.tool
# 期望: 从 sync events 自动提取的审计条目
```
- [ ] 有 action_type (file_edit, command_exec, tool_call 等)
- [ ] 有 session_id, timestamp

### T7.2 按文件追溯
```bash
# 先看有哪些文件路径
FILE=$(curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/audit?limit=5" | python3 -c "import sys,json; d=json.load(sys.stdin); logs=d.get('logs',d.get('audit_logs',[])); fp=[l.get('file_path','') for l in logs if l.get('file_path')]; print(fp[0] if fp else '')")

if [ -n "$FILE" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/audit/file?path=$FILE" | python3 -m json.tool
fi
```
- [ ] 按文件过滤正常

### T7.3 审计统计
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/audit/stats?days=7" | python3 -m json.tool
# 期望: 按 action_type 聚合的计数
```
- [ ] 返回各类型计数

---

## Phase 8: Session 回放

### T8.1 回放数据
```bash
# 取一个有 events 的 session
SESSION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/sessions | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['sessions'][0]['session_id'] if d['sessions'] else '')")

curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/replay/$SESSION_ID" | python3 -m json.tool | head -50
```
- [ ] 返回 session + timeline + stats
- [ ] timeline 按时间排序
- [ ] 每个事件有 elapsed_ms

---

## Phase 9: 工作流

### T9.1 创建工作流
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name":"Notify on end",
    "trigger_type":"session.ended",
    "trigger_filter":"{\"project_slug\":\"agentshow\"}",
    "action_type":"webhook",
    "action_config":"{\"url\":\"https://httpbin.org/post\",\"method\":\"POST\"}"
  }' \
  $SERVER/api/workflows | python3 -m json.tool

WF_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/workflows | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['workflows'][0]['id'] if d.get('workflows') else '')")
```
- [ ] 创建成功

### T9.2 工作流列表
```bash
curl -s -H "Authorization: Bearer $TOKEN" $SERVER/api/workflows | python3 -m json.tool
```
- [ ] 返回工作流列表

### T9.3 测试触发
```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$SERVER/api/workflows/$WF_ID/test" | python3 -m json.tool
```
- [ ] 测试触发成功

### T9.4 执行历史
```bash
curl -s -H "Authorization: Bearer $TOKEN" "$SERVER/api/workflows/$WF_ID/runs" | python3 -m json.tool
```
- [ ] 历史记录存在

---

## Phase 10: Docker Compose 端到端

### T10.1 Docker Build
```bash
docker compose build
# 期望: 构建成功
```
- [ ] 构建成功

### T10.2 Docker Up
```bash
docker compose up -d
docker compose logs -f --tail=20
# 期望: server 启动，监听 3000 端口
```
- [ ] 容器启动成功
- [ ] 健康检查通过: `docker compose ps`

### T10.3 Docker 内 API 测试
```bash
# 从宿主机访问
curl -s http://localhost:3000/api/health
# 期望: {"status":"ok"}
```
- [ ] 通过

### T10.4 Daemon → Docker Server 同步
```bash
# 修改 daemon 配置指向 Docker
cat > ~/.agentshow/config.json << 'EOF'
{
  "device_id": "dev_macbook01",
  "cloud": {
    "url": "http://localhost:3000",
    "token": "YOUR_TOKEN_HERE"
  },
  "privacy": {
    "level": 2
  }
}
EOF

# 需要先在 Docker 的 DB 里创建 user + api_token
# 参见「测试环境准备」中的 sqlite3 命令，改为:
docker compose exec agentshow sqlite3 /data/agentshow.db "..."

# 重启 daemon，等 30 秒，验证同步
```
- [ ] Daemon → Docker Server 同步成功

### T10.5 Docker 数据持久化
```bash
docker compose down
docker compose up -d
# 验证数据还在
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/sessions | python3 -c "import sys,json; print(len(json.load(sys.stdin)['sessions']), 'sessions')"
```
- [ ] 重启后数据保留

### T10.6 清理
```bash
docker compose down
# 恢复 daemon 配置
cp ~/.agentshow/config.json.bak ~/.agentshow/config.json
```

---

## 问题追踪表

| 编号 | Phase | 问题描述 | 严重度 | 状态 |
|------|-------|----------|--------|------|
| | | | | |

---

## 测试顺序建议

1. **先 Phase 1-2** — 基础连通 + daemon 同步（最关键）
2. **Phase 3-4** — 查询和成本（依赖 Phase 2 的数据）
3. **Phase 5-9** — 各独立功能
4. **最后 Phase 10** — Docker 完整端到端

每个 Phase 测完标记 checkbox，发现的问题记到追踪表，我来修。
