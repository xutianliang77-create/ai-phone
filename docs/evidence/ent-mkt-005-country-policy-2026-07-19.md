# ENT-MKT-005 Country Policy 实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 Country Policy 契约：国家、不可变版本、当地星期/分钟窗口、滚动频控、最小重试间隔、品牌/AI 身份/
  营销目的三段告知、语音信箱 union、合规确认依据、生效/失效期、生命周期、Campaign readiness 和阻断 reason。
- 新增 `0041_enterprise_marketing_country_policies`：forced-RLS `marketing_country_policy_versions` 使用 tenant-first
  复合 FK、actor/key 幂等、国家/版本唯一、同国家有效期互斥和 INSERT-only trigger；窗口 JSON 的缺字段、未知字段、
  数值边界、跨午夜与重叠均由数据库拒绝。
- `marketing_call_tasks` 新增具体 `country_policy_version_id` 引用。insert/reschedule 继续复用禁拨的
  `tenant + phone_hash` advisory transaction lock，在同一数据库 guard 中顺序重验 Suppression、Consent、Lead 国家/
  IANA 时区、版本有效期、当地窗口、跨活动最小重试间隔和滚动频控。
- Campaign readiness 按 startAt（草稿缺 startAt 时只作当前时刻预览）逐国家解析 active 版本，区分 missing、future、
  expired；Campaign 进入 scheduled 时数据库再按 startAt 要求全部目标国家被覆盖。
- 新增 tenant-scoped PostgreSQL Repository/runtime/API，发布要求 `campaign:approve`、读取要求 `campaign:read`、active
  membership、签名 route、严格 body 和幂等键；SQLite/JSON/legacy 无方法并返回 PostgreSQL required。
- Enterprise Web 复用现有 Material Icons、浅深色 token、8px 圆角、StatusPanel 和响应式规则，提供只对
  `campaign:approve` 开放的发布表单、不可变版本卡和逐活动服务端 readiness。

## 2. API 与边界

```text
GET  /enterprise/v1/marketing/country-policies
POST /enterprise/v1/marketing/country-policies
GET  /enterprise/v1/campaigns/:campaignId/country-policy-readiness
```

本批发布的数据是企业合规负责人提供的受控配置，不由 LLM 或法规链接生成，也不等于特定国家、州、号码类型和用途
已经取得法律意见。`compliant_message` 才能带版本化留言正文；`disabled` 和 `human_only` 夹带正文会被拒绝。

本批不实现 `ENT-MKT-006` 审批 policy-set/data snapshot，不创建 call task，不执行 Scheduler claim、usage hold、Outbox、
PSTN dispatch/cancel 或已开始媒体的物理停止。没有实际法务、PostgreSQL、时区/DST 和并发证据时不能开放外呼。

## 3. 失败闭合不变量

| 场景 | 代码候选行为 |
| --- | --- |
| `campaign:read` | 只读当前 tenant 的版本和逐活动 readiness |
| `campaign:approve` | 可发布不可变版本；actor、tenant、hash、时间由服务端固定 |
| marketing member/auditor | 无发布 scope，Web 只读，直接 POST 被服务端拒绝 |
| body tenant/跨租户/失效 route | membership、route、tenant SQL 与 forced RLS 失败闭合 |
| 同键同 hash/异 hash | 返回原版本 / 409，不重复审计 |
| 重复版本或重叠有效期 | country advisory lock 下 409，DB trigger 再拒绝直写 |
| 缺失/未来/过期目标国家 | readiness blocked；Campaign 不能进入 scheduled |
| task 缺版本或版本国家/有效期不符 | SQL 拒绝 |
| Lead 时区空或不在 PostgreSQL IANA 列表 | SQL 拒绝，不使用 Campaign/Web 时区代替 |
| 当地窗口外、同一时刻/过密、滚动窗口超频 | SQL 拒绝，不留下可执行任务 |
| legacy/SQLite/JSON | 503，不读取 fixture 或客户端规则 |

## 4. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 510860 B，JS 980121 B，CSS 81508 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；41段，末段 `0041_enterprise_marketing_country_policies` |
| `0041` loader checksum | `b4110db554b34c018e74d4a33b91d1b5c69f3544fef88a991c8bab047c5e520a` |
| tenant/subject 静态清单 | 82张 forced-RLS tenant table、45个 subject column |
| `git diff --check` | 通过 |

Vite 报告入口 chunk 超过 500 kB 的提示，但项目 bundle 硬门禁在当前阈值内通过。带 `--release` 的 Web gate 要求
clean、已提交 release commit 和正式 metadata，feature diff 阶段不运行该发布身份门禁。静态门禁不等于生产放行。

## 5. 已定义但未运行的验收

新增领域测试定义覆盖窗口规范化/hash、重叠拒绝、语音信箱 union 和 missing/future/expired 多国家解析；migration
静态契约同步断言 forced RLS、不可变 trigger、Campaign guard、task 版本引用、当地窗口和频控错误。`AC-ENT-0038`
定义角色/租户、格式、留言/告知、幂等/版本、schema、Campaign、IANA/DST、频控竞态和 Web 九组矩阵。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、Flutter
或任何真实 PostgreSQL/Provider/LiveKit/设备测试；未操作生产 App、个人版 WIP、Beelink、PSTN、CRM 或生产服务。

因此本批不证明 `AC-ENT-0038`、A0/A3/H2/H3、目标法域合规、真实外呼或企业生产门禁通过。`ENT-MKT-005` 保持
`in_progress`，下一任务为 `ENT-MKT-006 活动审批`。
