# ENT-REL-003 备份和灾备实现与静态门禁证据

日期：2026-07-20
分支：`codex/enterprise-edition`
状态：`in_progress`；静态代码候选完成，`AC-ENT-0052` 与 H3 未执行

## 1. 范围和既有缺口

本项复用既有 PostgreSQL resilience runner、平台 topology/capacity gate 和 `ENT-DATA-009` cutover evidence，
不建立第二套数据库主从或恢复真值。原 schema-v1 演练只绑定 topology/capacity，可由可编辑结果声明 passed，且
没有绑定当前企业 cutover、候选 commit/image、目标数据库 identity 或31+51 migration，也没有强制旧 route/
Worker fence、备份锁模式/独立故障域和 PITR 前后 marker。该边界不足以作为企业 H3 证据。

本轮将结果升级为 schema v2，并增加 `scripts/lib/enterprise_postgres_dr_evidence.mjs`。演练开始前验签真实
staging cutover，演练完成后对整个结果和 evidence hash 进行独立 HMAC 签名；production checker 重新计算当前
binding 并验签，不信任可手改的 `status=passed`。

## 2. 企业证据绑定

- cutover evidence 只接受仓库内相对路径；绝对路径、`..` 和符号链接逃逸失败闭合。
- cutover 必须为 `staging + cutover + matched`，源/目标 manifest hash 相等，并具有 baseline 引用、WAL LSN、
  源只读/写拒绝、旧 writer 会话为0、目标可写和 writer role 清单。
- binding 固定 candidate Git commit、image digest、topology SHA-256、cutover/run ID、目标 logical ID、database
  name/system identifier/OID/full manifest SHA-256，以及当前公共31段和 enterprise 51段 migration manifest hash。
- cutover 与 DR evidence 使用两把不同的至少32字符 HMAC key；缺失、过短、相同或篡改均失败。
- RPO/RTO objective 必须同时绑定批准 SLA 的 evidence ID/SHA-256；schema-v2 signed result 只有
  `status=passed` 时允许提升为 `outputs/postgres-resilience/latest.json`。

## 3. 自动切换和旧写入者矩阵

| 证据 | 必须满足 |
| --- | --- |
| Step identity | 每个 shell-free Adapter 只返回一个 JSON，精确回显 run/group/step、staging、verify-full |
| 自动选主 | 由 health controller 触发，新旧 primary ID 不同，timeline 严格递增，promotion generation 为正整数 |
| 数据库 fencing | 旧主写探针拒绝且 SQLSTATE 为 `25006` |
| 路由/Worker fencing | 旧 route epoch 写入和旧 Worker generation 副作用均拒绝 |
| 新 endpoint | 写探针成功，database system identifier 与 cutover 目标一致 |
| 旧主重入 | 只能为 `standby`，timeline 一致，`acceptsWrites=false` |
| 目标 | observed RPO/RTO 不超过批准配置；未实测时不得承诺数值 |

## 4. 不可变备份与 PITR

- base backup 和 WAL 必须在不同于全部数据库 HA 节点的第三故障域，传输/静态加密，并具有对象 version、
  至少30天 retention 及 `compliance_lock` 或 `provider_retention_lock`。
- WAL unresolved archive failure 必须为0，最大归档延迟不得超过 RPO 目标。
- PITR 只能恢复到独立 `ai_phone_restore_*` 数据库，固定恢复时间和 target marker。
- restore verification 必须证明 target 前 marker 存在、target 后 marker 不存在、写隔离有效，并分别比较
  target/restored 全量数据 SHA-256 与关键 tenant/session/ledger/audit/suppression/consent/object manifest SHA-256。
- 每个 step 使用精确字段白名单；额外 Provider 字段在持久化前拒绝，灾备 runner 不保存原始 stderr。evidence
  只记录脱敏 ID、hash、时间和指标，不记录凭据、endpoint、bucket、object key 或敏感命令正文。

## 5. 测试定义

- 固定九步顺序、精确 staging acknowledgement、缺 enterprise binding 命令执行次数为0、额外字段拒绝。
- fencing 失败、错误 step identity、旧 timeline/generation、endpoint identity 和可写旧主均返回 failed。
- 同主机、同故障域、本机 WAL、无对象锁、备份故障域与数据库重合、PITR marker/hash 不一致均 not ready。
- cutover/DR 使用同一 key、evidence 文件后改、签名 result 后改和已签名但 PITR hash 不一致均拒绝。
- 31+51 migration、cutover commit/image/topology/database identity 漂移均在演练命令前拒绝。

上述测试代码已定义，但按当前持续静态边界未运行 Vitest、API 全量或真实环境演练。

## 6. 本轮静态验证

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| JavaScript syntax / JSON / config | pass | runner、verifier、测试定义语法通过；example JSON 与 drill config 可解析 |
| HMAC sign/verify/tamper 自检 | pass | schema-v2 可验签，签名后篡改被拒绝；不替代 Provider 演练 |
| 无真实证据 fail-closed | pass | release checker 返回 `not_ready`，明确缺 topology、capacity 与 resilience result |
| 全 Node workspace typecheck | pass | 10个 Node workspace；不代表运行时验收 |
| API Server build | pass | TypeScript 构建通过；未连接真实 PostgreSQL |
| lint/350行/diff check | pass | 静态格式、文件规模和空白门禁通过 |
| 企业静态安全扫描 | pass | 21条规则扫描2619个文件，P0/P1/P2/P3 均为0；不替代外部扫描或真实渗透 |

## 7. 未通过边界

- 未运行 Vitest、API 全量、真实 PostgreSQL、forced-RLS、网络分区、主机掉电、自动 leader election 或 DCS quorum。
- 未配置或执行任何真实 Provider Adapter、第二数据库故障域、第三备份故障域、异地主机对象存储、KMS/对象锁。
- 未生成当前候选的真实 capacity、cutover 或 schema-v2 resilience evidence，示例 JSON 不是通过证据。
- 未执行隔离 PITR、数据/关键 manifest 对账、旧主重建重入、RPO/RTO 测量或独立 reviewer 复核。
- SQLite/local 仍只用于本地开发和封闭演示；不能宣称 PostgreSQL 企业试点、`AC-ENT-0052`、H3 或生产门禁通过。
- 未构建/安装生产 App，未操作 Beelink、服务、浏览器或真机。
