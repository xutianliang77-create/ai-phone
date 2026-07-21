# ENT-REL-004 灰度和熔断实现与真实本机验证证据

日期：2026-07-20，补充验证：2026-07-21
任务状态：`in_progress`
验收映射：`AC-ENT-0053`
证据性质：代码候选、静态门禁和本机单节点真实 PostgreSQL 机制证据；不是 Provider/staging/H3/生产演练证据

## 1. 交付范围

- 新增共享契约：四个受控 capability、control DTO、circuit state 与 fail-closed decision reason。
- 新增 enterprise migration `0052_enterprise_release_controls`：tenant-first control/event、两表 forced RLS、
  control identity/version/half-open trigger、append-only event 和有证据时拒绝 down。
- 新增前向 migration `0053_enterprise_tenant_root_rls`：补齐 `enterprise.tenants` 的精确自租户 policy，
  使普通应用角色可读取/锁定当前 tenant root，并继续对其他 tenant 失败闭合。
- 新增 PostgreSQL Repository/runtime：tenant session、advisory lock + row lock、CAS version、稳定 operation ID
  去重、threshold open、operator begin probe、probe close/reopen；健康且失败计数为0的成功返回 unchanged。
- 新增租户只读 API 和平台内部 status/change/decision/outcome API；内部 key 至少32字节，probe 另需第二 key，
  exact body/capability/UUID/阈值/到期/version 任一无效即拒绝。
- Support Agent、Meeting Screen OCR 和 Marketing PSTN 在副作用前读取服务端 release decision，并以稳定
  run/dispatch UUID 回写服务端 dispatch/Provider outcome。缺 PostgreSQL runtime 或缺 control 不回退 env/legacy。
- 新增值班手册 `docs/runbooks/enterprise-release-control.md`，覆盖灰度、紧急 kill、对照租户、已受理动作收敛、
  half-open 专用探针、证据与退出条件。

## 2. 验证矩阵

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
- 既有 migration/admin/DR manifest 测试已同步为 enterprise 53 段

## 3. 本轮实际执行的静态门禁

| 门禁 | 结果 | 证据边界 |
| --- | --- | --- |
| 全 npm workspace TypeScript typecheck | pass | enterprise-web、contracts、llm、speech-quality、api-server、pstn-bridge、realtime-gateway、srt-ingress、translation-worker、voice-agent-runtime 全部退出0 |
| 全 npm workspace build | pass | Node workspace 与 enterprise-web production build 退出0；Vite 仍报告既有 >500kB chunk warning，不视为失败或本任务修复 |
| contracts + api-server 定向 build | pass | API build 同步复制 migration；无类型错误 |
| migration manifest 静态读取 | pass | 当前 count=53，last=`0053_enterprise_tenant_root_rls`，up/down 均非空 |
| workspace lint scripts | pass | 命令退出0；无额外 lint 输出 |
| 企业静态安全扫描 | pass | 2639 files、21 rules，P0/P1/P2/P3 均0；报告 commit 字段仍是提交前基线 `58bcb1e`，只证明 working tree scanner 结果，不是最终 release evidence |
| 文件规模 | pass | 所有受检文件不超过350行 |
| `git diff --check` | pass | 无空白错误 |

依赖缺失说明：enterprise worktree 的 workspace `tsc` shim 不完整，首次直接 pnpm typecheck 返回
`tsc: command not found`。只读复用个人工作区已安装的 TypeScript executable 进入 PATH 后，企业 worktree 的
同一 tsconfig、源码和依赖解析完成上述 typecheck/build；未安装、修改、暂存或清理个人工作区文件。

## 4. 2026-07-20 静态轮次当时未执行

- 当时未执行任何 Vitest、API test、Repository test、migration test 或全 Node 回归。
- 当时未连接真实 PostgreSQL，未执行 `0052` up/down/forward、forced-RLS 双租户、跨实例竞态或重启恢复。
- 未配置或调用真实 PSTN、LiveKit、OCR、LLM/TTS/ASR Provider；未制造真实故障、外呼或客户副作用。
- 未运行浏览器、Flutter、iOS/Android、真机、Beelink 或生产 App。
- 未测 kill 生效延迟、告警、on-call 时间线、独立 reviewer 或完整 runbook 演练。
- 未通过 A0/A1/H1/H2/H3、`AC-ENT-0053` 或企业生产门禁；SQLite/JSON 仍只用于本地演示。

## 5. 2026-07-21 真实本机运行结果

运行环境：本机 Colima 隔离容器、官方 `postgres:16`，实际服务端版本 PostgreSQL 16.14；数据库仅绑定
`127.0.0.1:55432`，数据位于容器 tmpfs。使用普通登录角色 `NOSUPERUSER NOBYPASSRLS` 运行租户链路，
未使用 SQLite/JSON 作为 release control 真值。

从空库首次执行公共31段+enterprise migration 时，真实 PostgreSQL 发现并修复四类阻塞：`0042/0047`
函数参数与列名歧义、`0044` 保留字 alias 和尾逗号语法、migration runner 缺少失败 migration ID、以及
tenant root forced-RLS 无 policy 导致普通角色看不到 tenant 行、advisory lock 未实际取得。最后一项通过
前向 `0053` 修复，并纳入 schema verifier。

| 动态证据 | 结果 |
| --- | --- |
| 空库 migration | pass；公共31段、enterprise 53段、tenant tables=93、composite FK=147、subject columns=51、forced RLS verified |
| down/forward drill | pass；在第二数据库执行 `53 -> 52 -> 51 -> 53`，回退时当前 schema verifier 对缺失 tenant root policy 失败闭合，前进后恢复 verified |
| 普通角色双租户 | pass；另一租户读取0行，伪造 tenant 写入 SQLSTATE `42501`，应用角色 `rolsuper=false`、`rolbypassrls=false` |
| 并发与状态机 | pass；两个独立连接池同 operation 得到 `updated + already_recorded`，连续失败精确 open，普通 half-open 拒绝、专用 probe 成功恢复、kill 后拒绝 |
| 追加证据 | pass；6条事件，UPDATE 被 append-only trigger 以 SQLSTATE `55000` 拒绝，最终 control version=6 |
| 双 API 进程 | pass；两个独立 Node API 进程读取同一 PostgreSQL control version=6，Tenant B default deny；缺 probe key 返回401，专用 probe key请求由 kill switch 拒绝 |
| 命令安全边界 | pass；缺显式 mutation 确认时在连接数据库前失败；确认后仅对新增空测试租户 E/F 重跑通过 |
| 定向自动化 | pass；migration/admin/release Repository/domain/routes 6文件32项 |
| API 全量回归 | pass；233个测试文件、829项 |
| Enterprise Web 全量回归 | pass；13个测试文件、74项；Vitest 仅纳入 unit/component，Playwright e2e 未冒充 unit test |
| 全 Node 回归 | pass；根命令退出0，433个测试文件、1609项 |
| Provider readiness | degraded/not_ready；`/health` 存储为 PostgreSQL ready，`/health/ready` 因支付等 Provider 未配置返回503，没有伪造 ready |

同一健康检查也证明剩余发布任务尚未就绪：release materials 缺 `RELEASE_MATERIALS_FILE`；platform scale
为 disabled、topology 为 candidate_unverified、telemetry disabled；REL-004 不包含租户 quota/共享 Cell 公平调度；
必需 Apple IAP 配置缺失使 readiness 返回503。因此 `ENT-REL-005/006/007/008` 继续为 `todo`。

真实运行可在两个空测试租户的隔离数据库上，以显式
`ENTERPRISE_RELEASE_ACCEPTANCE_MUTATION=true` 执行 `npm run enterprise:release-control-acceptance`，重放核心普通角色、
双租户、并发、状态机和追加证据检查。所用数据库、两个 API 进程和容器均为临时本机环境，不是客户生产 App
或 Beelink 服务。

## 6. 剩余验收步骤

1. 在 test/staging Provider 分别演练 Agent/OCR/PSTN failure → open → dedicated half-open probe → close/reopen。
2. 采集批准的 kill 生效延迟 SLO、trace/事件/告警、已受理动作对账和独立 reviewer/on-call 时间线。
3. 在跨故障域、TLS `verify-full`、正式密钥和可观测配置下重放，而不是复用本机单节点证据。
4. 在最终 candidate commit 上复核本轮已通过的 API 全量、全 Node 回归和发布门禁，并补齐真实 Provider/staging/H3 证据后，再评估 `ready_for_acceptance`。

因此 `AC-ENT-0053` 仍未通过，`ENT-REL-004` 保持 `in_progress`；本机真实运行只能证明 PostgreSQL
单节点机制和 API 接线，不代表企业生产可用。
