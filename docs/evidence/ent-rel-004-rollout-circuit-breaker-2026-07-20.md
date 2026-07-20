# ENT-REL-004 灰度和熔断实现与静态门禁证据

日期：2026-07-20
任务状态：`in_progress`
验收映射：`AC-ENT-0053`
证据性质：代码候选与静态门禁；不是 PostgreSQL/Provider/生产演练证据

## 1. 交付范围

- 新增共享契约：四个受控 capability、control DTO、circuit state 与 fail-closed decision reason。
- 新增 enterprise migration `0052_enterprise_release_controls`：tenant-first control/event、两表 forced RLS、
  control identity/version/half-open trigger、append-only event 和有证据时拒绝 down。
- 新增 PostgreSQL Repository/runtime：tenant session、advisory lock + row lock、CAS version、稳定 operation ID
  去重、threshold open、operator begin probe、probe close/reopen；健康且失败计数为0的成功返回 unchanged。
- 新增租户只读 API 和平台内部 status/change/decision/outcome API；内部 key 至少32字节，probe 另需第二 key，
  exact body/capability/UUID/阈值/到期/version 任一无效即拒绝。
- Support Agent、Meeting Screen OCR 和 Marketing PSTN 在副作用前读取服务端 release decision，并以稳定
  run/dispatch UUID 回写服务端 dispatch/Provider outcome。缺 PostgreSQL runtime 或缺 control 不回退 env/legacy。
- 新增值班手册 `docs/runbooks/enterprise-release-control.md`，覆盖灰度、紧急 kill、对照租户、已受理动作收敛、
  half-open 专用探针、证据与退出条件。

## 2. 已定义但未执行的矩阵

| 矩阵 | 定义 |
| --- | --- |
| 状态 × 请求 | missing、disabled、expired、kill、open、普通 half-open 均 deny；closed allow；half-open 仅 probe allow |
| 角色 | 九个 tenant role 均只依赖 `tenant:read` 读取状态；没有 tenant `release:write` scope；平台写只走内部 key |
| 租户 | Repository 每条 SQL 显式 `tenant_id=$1`，row mapper 二次拒绝 tenant mismatch；migration 两表 forced RLS |
| 并发/重放 | capability advisory lock + row lock + expected version；同 tenant/capability/operation ID 唯一，不重复计数 |
| 故障状态机 | closed 连续失败到阈值 open；open 普通 outcome 拒绝；begin probe 只允许 open；probe success closed、failure open |
| 凭据 | 无/错误 release key 拒绝；probe outcome/decision 没有第二 probe key 拒绝；客户端和 tenant RBAC 不能变更 |
| 真实副作用 | Agent/OCR/PSTN guard 在 dispatch/Provider 前；服务端结果改变计数；已接受 Provider 动作继续对账/结算 |

测试定义文件：

- `enterprise-release-control.test.ts`
- `enterprise-release-control.routes.test.ts`
- `enterprise-postgres-release-control.repository.test.ts`
- `enterprise-postgres-release-control-migration.test.ts`
- 既有 migration/admin/DR manifest 测试已同步为 enterprise 52 段

## 3. 本轮实际执行的静态门禁

| 门禁 | 结果 | 证据边界 |
| --- | --- | --- |
| 全 npm workspace TypeScript typecheck | pass | enterprise-web、contracts、llm、speech-quality、api-server、pstn-bridge、realtime-gateway、srt-ingress、translation-worker、voice-agent-runtime 全部退出0 |
| 全 npm workspace build | pass | Node workspace 与 enterprise-web production build 退出0；Vite 仍报告既有 >500kB chunk warning，不视为失败或本任务修复 |
| contracts + api-server 定向 build | pass | API build 同步复制 migration；无类型错误 |
| migration manifest 静态读取 | pass | count=52，last=`0052_enterprise_release_controls`，up/down 均非空 |
| workspace lint scripts | pass | 命令退出0；无额外 lint 输出 |
| 企业静态安全扫描 | pass | 2635 files、21 rules，P0/P1/P2/P3 均0；报告 commit 字段仍是提交前基线 `193cb77`，只证明 working tree scanner 结果，不是最终 release evidence |
| 文件规模 | pass | 所有受检文件不超过350行 |
| `git diff --check` | pass | 无空白错误 |

依赖缺失说明：enterprise worktree 的 workspace `tsc` shim 不完整，首次直接 pnpm typecheck 返回
`tsc: command not found`。只读复用个人工作区已安装的 TypeScript executable 进入 PATH 后，企业 worktree 的
同一 tsconfig、源码和依赖解析完成上述 typecheck/build；未安装、修改、暂存或清理个人工作区文件。

## 4. 明确未执行

- 未执行任何 Vitest、API test、Repository test、migration test 或全 Node 回归。
- 未连接真实 PostgreSQL，未执行 `0052` up/down/forward、forced-RLS 双租户、跨实例竞态或重启恢复。
- 未配置或调用真实 PSTN、LiveKit、OCR、LLM/TTS/ASR Provider；未制造真实故障、外呼或客户副作用。
- 未运行浏览器、Flutter、iOS/Android、真机、Beelink 或生产 App。
- 未测 kill 生效延迟、告警、on-call 时间线、独立 reviewer 或完整 runbook 演练。
- 未通过 A0/A1/H1/H2/H3、`AC-ENT-0053` 或企业生产门禁；SQLite/JSON 仍只用于本地演示。

## 5. 下一验收步骤

1. 在隔离 PostgreSQL 以普通非 owner、非 `BYPASSRLS` tenant role 执行 0052 up/down/forward 和双租户读写攻击。
2. 恢复并执行本任务定向测试、API 全量与全 Node 回归，冻结同一 candidate commit。
3. 用两个 API 实例验证同 operation 重放、阈值竞争、CAS 冲突、kill 隔离及另一租户不受影响。
4. 在 test/staging Provider 演练 Agent/OCR/PSTN failure → open → dedicated half-open probe → close/reopen。
5. 采集 kill 生效延迟、trace/事件/告警、已受理动作对账和独立 reviewer 证据后再评估 `ready_for_acceptance`。
