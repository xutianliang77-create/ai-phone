# ENT-MKT-002 线索导入实现和静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享 Lead Import 契约：CSV/API 输入、批次/逐行报告、脱敏 Campaign Lead、列表与版本化回滚响应。
- 使用 `libphonenumber-js@1.13.9` 做国家感知号码解析和 E.164 规范化；单批最多500行、CSV 最大512KiB，
  严格解析表头、引号/转义、国家、时区、语言和有界扁平属性。任一格式错误返回逐行报告，整批不创建业务记录。
- 原始号码和规范 E.164 分别使用 AES-256-GCM envelope，AAD 绑定 tenant/Lead/字段；tenant + E.164 使用独立
  HMAC-SHA-256 key 生成去重身份。keyring 未配置或部分配置时失败闭合，API/Web/审计只返回号码 hint。
- 新增 `0038_enterprise_marketing_lead_imports`：导入批次、Campaign Lead 关联和 append-only 逐行证据均使用
  tenant-first 复合 FK、forced RLS、不可删除/状态/version trigger；Lead 增加密文原始号码、hint、创建批次和时间，
  tenant 内 phone hash 唯一。
- PostgreSQL Repository 在 tenant 行锁和 Campaign 行锁内预检全部 phone/externalId 身份，再原子创建/关联/
  去重、提交批次和审计。`created + linked + duplicate = total`；同键同规范 hash 精确重放、异 hash 冲突。
- 已提交批次只在 Campaign 仍为 `draft/not_submitted` 且 expectedVersion 匹配时回滚。回滚保留 Lead、批次和
  逐行证据，只滚回该批活动关联；存在其他 active 关联、Consent 或 task 的 Lead 不转 inactive。
- 新增 tenant-scoped 列表/导入/回滚 API 和 Campaign Web 线索面板。页面复用 Material Icons、浅深色 token、
  8px 圆角、状态组件、可聚焦横向表格和响应式单列，不注入示例线索或 Provider 成功。

## 2. 安全、不变量和功能边界

| 场景 | 代码候选行为 |
| --- | --- |
| owner/admin/marketing_manager/marketing_member | `campaign:write` 且未提交草稿时可导入/回滚 |
| auditor | `campaign:read` 只读脱敏 Lead 与批次，不显示写入口 |
| 其他角色/跨 tenant/失效 route | membership、scope、签名 route、tenant SQL 与 forced RLS 失败闭合 |
| body 伪造 tenant 或未知字段 | tenant 不一致冲突；严格请求形状拒绝 |
| 任一 CSV/API 行无效 | 返回行号/字段/错误码；Lead、link、batch 写入均为0 |
| 同号码不同排版 | 规范成同 E.164/HMAC；不会分裂 Lead |
| 同号码不同 externalId 或同 externalId 不同号码 | 整批 identity conflict，不覆盖既有身份 |
| 同活动重复号码 | 返回 duplicate；已有 tenant Lead 首次入活动返回 linked；新 Lead 返回 created |
| 响应丢失重试 | Web 保留原幂等键；同规范 hash 返回原 batch/rows，不重复写审计 |
| 旧 version/异键或异 hash 回滚 | 409；已滚回同键同 hash/actor 精确 replay |
| keyring 缺失或 SQLite/JSON runtime | 503 protection/PostgreSQL required；不回退演示存储 |
| 导入成功 | Consent、Suppression、Country Policy、审批、task、Outbox、usage、Provider/PSTN 均为0 |

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 根级 TypeScript typecheck | 通过；全部 Node workspace |
| Enterprise Web E2E config typecheck | 通过 |
| 根级 build | 通过；全部 Node workspace，Enterprise Web Vite production build 通过 |
| Enterprise Web bundle 静态检查 | 通过；9 files，entry JS 481750 B，JS 951011 B，CSS 73271 B |
| 根级 lint / 350行文件规模 | 通过 |
| migration loader | 通过；38段，末段 `0038_enterprise_marketing_lead_imports` |
| `0038` loader checksum | `c16ac54df55e22831d3d633cef8324a17547db3b2f2eb300926eb1a8af618393` |
| schema 静态清单 | 当前公共31段 + enterprise 38段；预期115张业务表（不含 schema migration 表） |
| tenant/subject 静态清单 | 81张 forced-RLS tenant table、41个 subject column |
| `git diff --check` | 通过 |

带 `--release` 的 Enterprise Web gate 要求 clean、已提交 release commit 和正式 metadata；feature diff 阶段未运行
该发布身份门禁。当前 bundle 内容/大小/fixture 静态扫描通过，不等于正式 Web 发布包放行。

## 4. 已定义但未运行的验收

`AC-ENT-0035` 已定义格式、号码、身份、幂等/原子、schema/forced-RLS、回滚、保护和 Web 八组矩阵；
领域测试文件定义 E.164/CSV/规范 hash 和 AES-GCM/HMAC/AAD 用例，migration 清单测试也已更新到 `0038`。

按持续边界未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、Playwright、浏览器、axe、
Flutter 或任何真实 PostgreSQL/Provider/LiveKit/设备测试；未连接 CRM/PSTN，未创建 Consent/Suppression/task，
未操作生产 App、个人版生产代码/WIP、Beelink 或生产服务；企业提交推送后仅按交接要求追加个人版
`PROGRESS_LOG.md`。

因此本批不证明 `AC-ENT-0035`、A0/A3/H2/H3、真实外呼或企业生产门禁通过。`ENT-MKT-002` 保持
`in_progress`，下一任务为 `ENT-MKT-003 授权证据`。
