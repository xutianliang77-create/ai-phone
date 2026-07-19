# ENT-CS-012 客服质检分析实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 `quality:read` 与 `quality:manage`。owner/admin 拥有两者；support_manager 可读写；auditor 只读；
  support_agent 和其他业务角色均不取得质检数据。Analytics 导航不再因 `support:read` 向坐席暴露。
- 新增 `0036_enterprise_support_quality`：`support_quality_rule_versions`、`support_quality_reviews`、
  `support_quality_findings` 均使用 tenant-first 复合 FK、forced RLS 和不可变 trigger；规则/复核 insert guard
  复核 active manager，deferred constraint trigger 校验 finding 行数与 review severity 计数精确一致。
- 租户规则版本支持精确 locale 或 `*`，身份告知短语1..16、禁用承诺0..32；服务端固定
  `support-quality-v1` 和请求 SHA-256。同幂等键同 hash 返回原版本，同键异 hash 冲突。
- 分析只接受 ended/failed support session 和 completed/failed/cancelled 最新 Agent run。source hash 绑定
  session/run 状态、version、时间和全部 turn 输出证据；相同 session/rule/source 精确重放，变化则追加新复核。
- 确定性引擎生成五类结构发现：未完成身份告知、answer/qualify 无知识引用、风险未转人工、命中禁用承诺、
  回答未送达。每个 finding 保存 turn 绑定、固定 severity 和 evidence hash。
- Dashboard 对每个 session 只聚合最新复核，详情返回规则/发现、Agent 回答、最终字幕和安全工具执行字段；
  不返回 tenant/customer 电话、请求/幂等键、dispatch secret、Outbox 密文或 Provider 凭据。
- Enterprise Web 在既有数据分析页复用 Material Icons、浅/深色 token、圆角、`StatusPanel` 和响应式表格，
  增加指标卡、规则发布、明确 session ID 分析、最新复核表和证据分组。只读角色看不到写入口。
- 当前未配置语义质检 Adapter、模型或人工金标。review 由数据库固定为 `partial/not_configured`，reason 为
  `support_quality_semantic_model_not_configured`，错误回答率为 `null`；无引用率不冒充语义错误回答率。

## 2. 安全、规则和降级边界

| 场景 | 代码候选行为 |
| --- | --- |
| owner/admin/support_manager | 可发布规则、触发终态会话分析并读取证据 |
| auditor | 仅 `quality:read`；可看规则、Dashboard 和详情，写 API 由服务端拒绝 |
| support_agent/其他角色 | Analytics 不因 support scope 暴露质检；直接 API 仍由 RBAC 拒绝 |
| 跨 tenant 或 body 伪造身份 | TenantContext、route document、tenant query、forced RLS 和复合 FK 失败闭合 |
| 同规则幂等键同/异请求 | 同 hash 精确重放；异 hash 409，不改写原版本 |
| 非终态会话/run | 返回 not_finalized/no_agent_data，不生成 review/finding/audit |
| 无 locale 规则或无 Agent 输出 | 返回 rule_not_configured/no_agent_data，不补造示例结果 |
| 相同规则与 source hash | 返回原 review，不增加 Dashboard 会话数 |
| 规则或源证据变化 | 追加不可变 review；Dashboard 仅统计该 session 最新一份 |
| 结构规则零命中 | 只表示这五类规则未命中，不表示语义回答正确 |
| 语义模型未配置 | `partial/not_configured`、错误回答率 `null`，不返回0或虚构百分比 |
| SQLite/JSON runtime | 返回 `enterprise_postgres_required`，不回退演示存储 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 463152 B，JS 932413 B，CSS 65160 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；36段，末段 `0036_enterprise_support_quality` |
| `0036` loader checksum | `26da3fe4f483d436b8e1751b0abdafc2eed2f39fc8934c02ff1f81f447b8ea95` |
| schema 静态清单 | 当前公共31段 + enterprise 36段；预期112张业务表 |
| tenant/subject 静态清单 | 78张 forced-RLS tenant table、38个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 要求已提交且 clean 的 release commit，并校验正式 version/commit 元数据；
feature diff 阶段未运行该发布身份门禁。无 release metadata 的 bundle 内容、大小、source map、敏感串和 fixture
静态扫描已通过，不能据此宣称正式 Web 发布包放行。

## 4. 已定义但未运行的验收

`AC-ENT-0033` 已定义权限、schema/forced-RLS、规则版本、分析/source hash、五类发现和 Dashboard/UI 六组矩阵。
语义准确性另需去标识人工金标、模型 fingerprint、多语言分层 precision/recall、误报/漏报与复核一致性证据。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、
Flutter 或任何真实 PostgreSQL/Provider/LiveKit/设备测试；未连接语义模型、CRM/PSTN、生产 App、Beelink 或
生产服务，也未实现自动批处理/实时流式质检。

因此本批不证明 `AC-ENT-0033`、A0/A2/H2/H3、语义错误回答定位、企业试点或生产门禁通过。
`ENT-CS-012` 保持 `in_progress`。
