# Agent Call Worker 联调手册

日期：2026-07-03

## 1. 目标

验证 AI Calling Agent 从 App 授权、API 入队、Worker 拉取、PSTN Bridge 提交、状态回写到服务商完成回调的闭环。

## 2. 必需服务

- API Server：当前 workspace 版本。
- Agent Call Worker：`npm run dev:agent-calls`。
- PSTN Bridge：提供 `POST /agent-calls`，负责真实服务商拨号或沙盒拨号；本仓库提供 `@translation/pstn-bridge` 骨架服务。

## 3. 本地自动冒烟

在不接真实服务商前，先运行隔离 smoke：

```bash
npm run check:agent-call-worker -- --json
```

该命令会临时启动：

- API Server：独立端口和 `.cache/agent-call-worker-readiness/api-store.json`。
- mock PSTN Bridge：接收 `POST /agent-calls` 并返回 `mock-pstn-call-1`。
- 真实 Agent Call Worker：使用 `PSTN_BRIDGE_BASE_URL` 指向 mock Bridge。

通过标准：

- 内部队列接口未带 `INTERNAL_API_SECRET` 时返回 401。
- AI Calling Agent 草稿可以创建、授权并进入 `queued`。
- mock Bridge 收到 `draftId`、`callId` 和 Bearer API key。
- API 草稿详情回写 `status=in_progress` 和 `providerCallId=mock-pstn-call-1`。
- mock Bridge 通过 `POST /webhooks/pstn/agent-calls` 发送签名完成回调，API 回写 `status=completed`。

译音回灌另跑：

```bash
npm run check:pstn-bridge-audio -- --json
```

该命令验证 PSTN Bridge 的 `POST /translated-audio` 鉴权、payload 校验和 HTTP 上游转发。

## 4. 真实联调环境变量

```bash
export API_BASE_URL=http://127.0.0.1:3100
export INTERNAL_API_SECRET=replace-with-strong-secret
export AGENT_CALL_WORKER_ENABLED=true
export CALL_PROVIDER_POLICY=domestic_pstn_bridge
export PSTN_PROVIDER=domestic_bridge
export PSTN_ACCOUNT_ID=replace-with-account
export PSTN_API_KEY=replace-with-provider-key
export PSTN_WEBHOOK_BASE_URL=https://calls.example.cn
export PSTN_WEBHOOK_SECRET=replace-with-32-plus-char-secret
export PSTN_CONSENT_PROMPT_VERSION=cn-agent-v1
export PSTN_RECORDING_DISCLOSURE_ENABLED=true
export PSTN_MAX_CALL_MINUTES=30
export PSTN_BRIDGE_BASE_URL=https://pstn-bridge.example.cn
export PSTN_BRIDGE_API_KEY=replace-with-bridge-secret
```

本地可用以下命令启动 Bridge 骨架服务：

```bash
PSTN_BRIDGE_PORT=3302 \
PSTN_BRIDGE_API_KEY=replace-with-bridge-secret \
PSTN_BRIDGE_PROVIDER=mock \
npm run dev:pstn-bridge
```

真实发布时见 `docs/poc/pstn-bridge-runbook.md`，必须切到 `PSTN_BRIDGE_PROVIDER=http|fonoster` 并接公网 HTTPS 上游或 Fonoster-compatible facade。

发布/签名主体：北京乾坤祥云科技有限公司。

## 5. 验收路径

1. App 创建草稿并确认授权。
2. App 点击“开始执行”，API 返回 `queued` 和 `callId`。
3. Worker 调用 `/internal/ai-calling-agent/drafts/queued` 拉取任务。
4. Worker 向 `PSTN_BRIDGE_BASE_URL/agent-calls` 提交号码、目标、话术和 consent 版本。
5. Bridge 返回 `providerCallId` 后，Worker 回写 `in_progress`。
6. Bridge 或后续执行器完成后，调用 `POST /webhooks/pstn/agent-calls` 回写 `completed` 或 `failed`，并在有真实通话时长时携带 `consumedSeconds`。
7. App 点击“刷新状态”，看到最新状态、结果摘要、失败原因、下一步和已结算秒数。
8. 本地 smoke 在一次 `completed(consumedSeconds=300)` 后再次启动新草稿，必须得到 402 `agent_call_insufficient_balance`，证明余额耗尽不会继续入队。

启动前余额要求：

- 剩余可用秒数必须至少 60 秒。
- 余额不足时 `/ai-calling-agent/drafts/:draftId/start` 返回 402 和 `agent_call_insufficient_balance`。
- 余额不足不会生成 `callId`，草稿保持 `authorized`，Worker 拉不到该任务。

服务商回调要求：

- Header：`x-translation-pstn-signature`。
- 签名：`PSTN_WEBHOOK_SECRET` 对 `callId/consumedSeconds/eventId/failureReason/nextStep/providerCallId/resultSummary/status` 的有序字段做 HMAC-SHA256。
- 幂等：`eventId` 必填，同一个 `eventId` 重放必须返回 duplicate，且不重复改状态、不重复扣减用量。
- 计费：只有 `completed/failed` 终态携带大于 0 的 `consumedSeconds` 时才结算；API 写入 `usageSettledAt`，并在 billing ledger 写 `note=agent_call_usage`。

## 6. 失败处理

| 场景 | 期望 |
| --- | --- |
| `PSTN_BRIDGE_BASE_URL` 缺失 | Worker 只提示未配置，不调度 |
| 用户剩余秒数低于 60 秒 | API 返回 402，不生成 call id |
| Bridge HTTP 非 2xx | Worker 回写 `failed` 和失败原因 |
| `INTERNAL_API_SECRET` 不一致 | 内部队列和状态回写返回 401 |
| PSTN webhook 签名错误 | API 返回 401，不更新通话 |
| PSTN webhook `eventId` 重放 | API 返回 duplicate，不重复更新或扣费 |
| 服务商没有 provider call id | 允许进入 `in_progress`，但发布验收需补齐 |

## 7. 自动化覆盖

- API 内部队列：`npx vitest run src/modules/agent-calls/agent-call-worker.routes.test.ts`
- Worker 调度：`npx vitest run src/agent-calls`
- 本地隔离 smoke：`npm run check:agent-call-worker -- --json`
