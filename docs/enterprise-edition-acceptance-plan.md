# 无界AI企业版验收任务与计划

版本：v1.19
日期：2026-07-19
状态：可执行验收计划，已对齐统一通讯平台和 PostgreSQL Primary 收敛

## 1. 验收目标

证明企业版 SaaS 控制面和三条业务主线在租户隔离、真实媒体、AI 安全、并发、计量、结算和故障恢复条件下形成闭环：

1. 企业会议和屏幕共享。
2. AI 客服和人工接管。
3. 出海 AI 外呼营销受控灰度。

Mock 只能验证协议，不能替代 iPhone/Web、真实 LiveKit、真实模型和真实 PSTN 的验收。

## 2. 放行等级

| 等级 | 含义 |
| --- | --- |
| A0 | 文档、代码和自动化通过，不开放用户 |
| A1 | SaaS 白名单租户内部试用，企业会议可用 |
| A2 | AI 客服受控试点，工具和接管可用 |
| A3 | 外呼白名单、单国家、低并发灰度 |
| A4 | 多租户 SaaS 正式企业发布 |

`H1` 故障与长稳、`H2` 安全与隐私、`H3` PostgreSQL/Cell/灾备是横向硬化门禁，不是额外放行等级；A4 必须全部通过。

任何 P0 安全、串租户、误拨、重复扣费或无法停止共享问题都会阻断当前及更高等级。

### 2.1 缺陷等级与放行规则

| 等级 | 示例 | 放行规则 |
| --- | --- | --- |
| P0 | 串租户、误拨、重复扣费、高风险自动执行、停止共享无效 | 立即停止验收和灰度，修复后重跑受影响及下游全部门禁 |
| P1 | 权限入口可执行、数据丢失、错误成功、会话无法结束、敏感数据泄露 | 当前放行等级阻断，必须清零 |
| P2 | 主要流程退化、无替代路径的兼容/无障碍问题、指标不可追踪 | A0-A3 原则上阻断；例外需产品、技术、安全共同签字 |
| P3 | 不影响任务完成的视觉或文案问题 | 可带明确 owner 和截止时间进入下一轮 |

`blocked` 只用于真实账号、法律确认、硬件或外部环境缺失；测试失败、代码未完成或证据不足不能标为 `blocked`。

## 3. 验收环境

### 3.1 客户端

- iPhone Profile/Release 真机。
- Web 企业控制台和 Web 参会页，Chrome/Safari 当前支持版本。
- Android 代码和模拟器门禁保留，真机按 iOS 产品化后的既定计划执行。
- 耳机、扬声器、Wi-Fi、蜂窝网络和横竖屏场景。

### 3.2 服务器

- 独立服务器发布单元：API、Gateway、Worker、LiveKit、模型、数据库和对象存储。
- 生产相同的 reverse proxy、HTTPS/WSS、短期 token 和内部鉴权。
- ASR、翻译、TTS、LLM、Speaker、OCR health 返回实际 Provider fingerprint。
- SQLite WAL 仅用于本地开发和封闭演示；A1-A4 均必须使用 PostgreSQL。
- 公共与 enterprise migration manifest 在同一隔离企业数据库按固定顺序执行，并分别保留 checksum/schema verify 证据。
- migration、tenant API、user directory、cell discovery、maintenance 使用独立最小权限角色/连接池；生产连接使用 `sslmode=verify-full`。
- PostgreSQL 主备位于不同物理故障域，具备自动 leader election、旧主隔离和异地主机不可变备份；同机副本不满足 A4 环境要求。

### 3.3 数据集

- 两个完全独立的测试租户和至少四种角色。
- 中英双语产品知识、过期知识、冲突知识和无答案问题。
- `draft/review/published/expired` 术语包和话术模板，覆盖中英术语、别名、必说语、禁语和变量。
- 已授权、已撤回、过期、重复、禁拨和错误国家号码。
- 两人、四人、快速轮流、重叠和中英混合会议语料。
- PPT、表格、网页、视频和深色页面屏幕共享样本。

## 4. A0 工程和架构验收

| 编号 | 验收项 | 通过标准 |
| --- | --- | --- |
| AC-ENT-0001 | 源码构建 | Flutter/Web/Node/Python 从干净环境构建通过 |
| AC-ENT-0002 | 文件规模 | 源码文件大小门禁通过，无新增巨型页面/服务 |
| AC-ENT-0003 | 两层部署 | 客户端只配置统一服务器地址，无 Mac/模型端口 |
| AC-ENT-0004 | Provider readiness | 未配置 Provider 显示 not_ready，不伪造可用 |
| AC-ENT-0005 | migration | up/down、重复执行和旧版本兼容通过 |
| AC-ENT-0006 | schema/contract | API、事件、工具和 Provider schema 测试通过 |
| AC-ENT-0007 | SaaS 交付边界 | 构建和文档不包含客户侧服务端安装路径 |
| AC-ENT-0008 | 环境门禁 | SQLite 环境报告 demo_only，不能创建真实 SaaS 租户 |
| AC-ENT-0009 | Repository runtime | `legacy|postgres` 单一 driver；PostgreSQL 未通过 startup verify 时拒绝；无 fallback、双写或路由级混用 |
| AC-ENT-0010 | Cell Worker 启动 | 非 PostgreSQL driver、缺 cell/worker、越界 poll/batch/lease、缺 HTTPS publisher/token 均失败闭合 |
| AC-ENT-0011 | 演示数据导入 | 仅维护窗口和空目标允许；JSON/SQLite 导入后六集合 count/hash 一致，不一致整体回滚 |
| AC-ENT-0012 | 上游基线 | 只集成主产品稳定 commit；未提交 WIP、陈旧 README 或 staging 结果不能成为企业完成状态和验收证据 |
| AC-ENT-0013 | 单一 Primary Runtime | 公共/企业双 manifest 共用一个 startup verdict 和 Storage Driver；允许分权连接池，不允许 fallback、shadow read、dual write 或路由级混用 |
| AC-ENT-0014 | 统一通讯 scope 与业务绑定 | session/participant/leg/dispatch/provider/playback 具有不可省略的 `scope_type + scope_id`、复合约束和 forced RLS；Meeting/Support/Marketing 只能绑定同 tenant session；旧 route/generation、重复 event sequence、非法倒退和终态恢复全部拒绝 |
| AC-ENT-0015 | Worker Dispatch | ticket 含签名 tenant/session/cell/route epoch/generation/capability/expiry；签发、accept、heartbeat、结果提交重读当前 binding/grant/lease；跨租户、跨 cell、过期、取消、旧 route/generation 全部拒绝且不提交迟到副作用 |
| AC-ENT-0016 | 企业通讯运行策略 | 策略按精确 tenant/version 发布；dispatch ticket 绑定不可变 policy snapshot/version；device/cloud readiness 与 fingerprint 缺失或过期时明确降级；声纹、录音和诊断音频分别要求有效 purpose 授权，证据缺失、过期或撤回立即阻断新副作用且不改写历史快照 |
| AC-ENT-0017 | 企业用量预算 | tenant/category/unit/UTC period 唯一预算；并发 reserve 不超卖；相同 hold/settle key 同 hash 精确重放、不同 hash 拒绝；超限不产生副作用；ledger/alert 不可更新删除，跨租户 ID 不可见不可写 |
| AC-ENT-0018 | 租户账务和 Entitlement | tenant billing account 唯一；同时最多一个活动 subscription；plan/snapshot/version 不可改写删除；套餐变更只接受服务端 plan 并由服务端生成账期；跨租户、过期/错订阅、席位超限、旧 entitlement、客户端伪造 limit/maxUnits 全部拒绝且不产生 dispatch 副作用 |
| AC-ENT-0019 | 不可变 Usage Accounting | raw event 与 settle ledger 同事务且逐字段一致；event/ledger/adjustment 不可更新删除；同键精确重放、异载荷拒绝；adjustment 只追加并引用原 settle、累计净额不得为负；UTC period 聚合的 settle/adjustment/net、usage event/settlement/adjustment/ledger count、SHA-256 hash 和 watermark 可重建，历史 ledger-only 缺口可见；跨租户读写与租户自助冲正均拒绝 |
| AC-ENT-0020 | Primary 切换与恢复证据 | 公共31段/企业18段 manifest、全部业务表 count/整行 hash、关键 tenant/session/ledger/audit/consent/suppression/object 清单和增量 WAL 水位一致；源 writer fence 与 SQLSTATE 25006 写拒绝、旧 API/Worker 角色会话为0、目标写探针成功；baseline/cutover/restore evidence 验签并绑定 commit/image/topology/system identifier/OID；任意单行篡改失败闭合 |
| AC-ENT-0021 | 企业知识版本 | source/revision/chunk 只能由 `knowledge:publish` 且持有效 tenant route 的角色写入；revision 服务端串行递增，chunk/block 唯一且 hash 由服务端生成；无 chunk、非 review、旧 expectedVersion、跨租户和 tenantId 伪造全部拒绝；published version/chunk 不可更新删除；检索强制 tenant/locale/country/product/effective-time，只返回每个 source 最新有效 published revision，并产生稳定 `knowledgeVersionId:blockId` citation；draft/review/failed/未来/过期均为0结果 |
| AC-ENT-0022 | 企业术语与话术版本 | term pack/script template 稳定资源与 revision 只能由 `knowledge:publish` 且持有效 tenant route 的角色写入；revision 服务端串行递增，term ID/原词唯一，话术必说语与禁语不冲突，hash 由服务端生成；非 review、旧 expectedVersion、跨租户、tenantId 伪造、评审后改内容/hash 和 published 更新删除全部拒绝；resolver 强制 tenant/source-target locale/country/product/purpose/effective-time，只返回当前有效 published 版本，且顶层、ASR、翻译和 LLM 的 `termPackVersionId` 完全相同，话术版本只进入 LLM；draft/review/未来/过期/用途不符均明确 not ready |

`ENT-CORE-004` 当前自动化和本地 PostgreSQL 16 普通角色证据满足 `AC-ENT-0021` 的代码候选条件；
正式接受仍需在隔离 staging 以两个 tenant、最小权限角色、真实对象存储/恶意文档样本和并发发布执行。
当前没有配置 embedding Provider，确定性文本检索不能表述为向量召回或 embedding readiness 已通过。

`ENT-CORE-005` 当前自动化和本地 PostgreSQL 16 普通角色证据满足 `AC-ENT-0022` 的代码候选条件；
正式接受仍需在隔离 staging 以两个 tenant、最小权限角色和真实 ASR/翻译/LLM Worker 验证运行时引用
消费、并发发布和历史会话引用。未配置外部 Provider 时只能验证确定性内容与版本引用，不能宣称
Provider 链路成功。

### 4.1 企业 UI 与前端工程验收

静态原型只用于设计评审，不能作为以下 production acceptance 的替代证据。

| 编号 | 验收项 | 通过标准 | 主要证据 |
| --- | --- | --- | --- |
| AC-UI-001 | 视觉令牌一致 | Web 与 Flutter 的 Primary/Signal/Surface/Outline、字号和 8px 圆角逐项一致 | token test、主题快照、设计对照 |
| AC-UI-002 | 图标一致 | 使用同一 Material Icons 语义和 outlined/filled 对；构建中无第二套通用图标库 | dependency scan、图标快照 |
| AC-UI-003 | 九角色导航 | owner/admin/营销主管/营销人员/客服主管/坐席/主持人/成员/审计员入口与服务端 scopes 一致 | role×route E2E、`/enterprise/v1/me` 响应 |
| AC-UI-004 | 直接 URL 越权 | 隐藏入口后直接访问 URL/API 仍拒绝，不泄露资源是否存在 | 403/404、服务端 guard 日志、攻击测试 |
| AC-UI-005 | 统一页面状态 | loading、empty、not_ready、degraded、forbidden、conflict、processing、failed 均有可行动页面 | 状态矩阵截图、component/E2E |
| AC-UI-006 | Provider 不伪造成功 | not_configured/not_ready 时操作被阻断；没有 provider reference 不显示完成 | contract test、UI E2E、trace |
| AC-UI-007 | 异步与冲突 | job 可离页继续；刷新后恢复；409/412 不覆盖他人版本；写重试复用 idempotency key | API/E2E、job/trace 记录 |
| AC-UI-008 | 响应式 | 320、600、960、1280、1440px 无横向溢出，客服三栏按规则收敛 | 浏览器矩阵截图、布局断言 |
| AC-UI-009 | 深色与动态字体 | 浅/深主题无缺色；200%缩放、动态字体和横屏不遮挡核心操作 | visual regression、真机/浏览器截图 |
| AC-UI-010 | 键盘与无障碍 | 核心流程全键盘可达；焦点可见；正文/按钮满足 WCAG AA；图标按钮有名称 | axe/等效扫描、人工键盘记录 |
| AC-UI-011 | 生产构建边界 | 无示例租户/指标、内部 Provider 地址、密钥、调试入口或静态原型数据 | bundle scan、Release smoke |
| AC-UI-012 | 前端可观测性 | 页面错误带安全 trace ID；前端错误和性能可按 tenant/route/version 追踪且不含敏感字段 | error event、日志脱敏检查 |

页面验收至少覆盖：工作台、外呼活动、客服坐席台、企业会议、客户与线索、知识与术语、数据分析、合规与审计、企业设置，以及 Web 访客参会页和 Flutter 企业入口。

`ENT-UI-006` 当前代码候选覆盖知识源、术语包、话术模板三类稳定资源和修订列表，显式显示
draft/review/published/expired、生效范围和只读快照；所有内容请求携带当前 tenant 与签名 route document，
写入使用服务端 `expectedVersion`，`knowledge:read` 角色不显示写入口，403/409/503 分别进入
forbidden/conflict/not_ready 且 PostgreSQL 缺失时不回退到 SQLite/JSON。该自动化满足 AC-UI-004/005/007/011
的代码候选条件，并复用 AC-ENT-0021/0022 服务端 guard；正式接受仍需桌面浏览器矩阵、键盘/无障碍、真实
PostgreSQL staging 双租户并发发布及 ASR/翻译/LLM Worker 引用消费，当前不能进入 A1 或生产放行。

`ENT-UI-005` 当前代码候选覆盖成员目录、现有账号加入、角色/状态编辑和九角色 scope 说明。页面直接读取
共享 `enterpriseRoleScopes`，成员 API client 为读写请求携带 Bearer、`x-tenant-id` 和签名 route document，
body 不发送 tenantId；只读角色不渲染新增/编辑入口，无 scope 的直接 URL 不发起成员读取，所有者与当前账号
不提供自改入口，服务端 membership/RBAC/route guard 继续作为最终授权边界。403/409/503 分别进入
forbidden/conflict/not_ready，安全 trace ID 可见。当前 API 只把已注册 userId 加入企业并返回 active membership，
没有短信、邮件或 Provider 邀请，因此不能把“添加成员”表述为外部邀请成功。该自动化满足
AC-UI-002/003/004/005/006/011 的代码候选条件；本地 Chromium 1440px 检查只证明单一桌面布局，不替代
Chrome/Safari/Edge 全矩阵、320-1280px、深色/200% 缩放、axe/键盘或真实 PostgreSQL staging 验收，当前不能
进入 A1 或生产放行。

### 4.2 浏览器和设备矩阵

| 类别 | 最低矩阵 |
| --- | --- |
| 桌面 Web | macOS Chrome/Safari；Windows Chrome/Edge 当前支持版本 |
| Web 参会 | Chrome/Safari 的麦克风、共享屏幕、标签页和权限拒绝路径 |
| iPhone | 支持范围内最小屏和主力机型，浅/深色、动态字体、横竖屏 |
| Android | 代码/模拟器门禁；真机按既定产品化阶段执行并明确未验收项 |
| 网络 | 正常、150ms RTT、1%/5%丢包、断网恢复、Wi-Fi/蜂窝切换 |

视觉回归只比较稳定组件和布局；时间、计时器、随机 ID 和媒体画面需使用固定 fixture，不能通过放大截图容差掩盖真实错位。

## 5. SaaS 控制面验收

### 5.1 开通和路由

- 同一开通 idempotency key 重放100次只产生一个 tenant、subscription 和 regional tenant。
- 区域 provisioning 失败时 tenant 保持非 active；恢复后可继续，不生成第二个租户。
- `homeRegion/cellId/routeEpoch` route document 有签名、短期有效且不能篡改；旧 epoch 被拒绝。
- 把 AP 区域 token 发送到 EU 数据面时写请求被拒绝，并提示重新发现路由。
- 控制面短时不可用时，已登录区域会话可继续安全运行；禁止新开通和套餐变更。

### 5.2 套餐和权益

- 成员数、会议并发、屏幕共享、客服并发、外呼国家和 API 限额分别验证。
- 降级套餐不能删除历史数据；新高成本任务按生效时间阻断。
- 套餐升级后 entitlement 版本更新，客户端旧缓存不能越权或永久看不到新能力。
- 超额、欠费、暂停、恢复和注销均产生审计事件。
- 欠费暂停不突然切断进行中的紧急人工接管或会话结束流程。

### 5.3 计量和账单

- 原始 usage event、不可变 ledger 和账期聚合三层可对账。
- 时区、套餐和席位在账期中途变化不重复计量。
- 调整使用新 ledger entry，不修改历史流水。
- 重试、webhook 重放和 Worker 恢复不重复计费。
- 账单以 `billing_account_id + tenant_id` 归属；篡改 tenant、个人 `user_id` 或付款联系人不能读取、调整或结算另一租户账单。
- 个人订阅/余额迁移到企业账单时生成期初快照和 adjustment，保留源 hash；禁止通过 ID 映射直接复用个人账单记录。

## 6. A1 租户、权限和数据验收

### 6.1 租户隔离

- 租户 A 创建活动、会议、知识、客户和导出。
- 使用租户 B 的普通用户、管理员、API key 和伪造 tenant 参数访问。
- 期望所有读写返回无权限或不存在，日志不泄露资源是否存在。
- 并发运行 50 个 A/B 任务，查询、列表、分页和导出均不串租户。
- 租户 A 持续高负载时，租户 B 的登录、会议和客服仍满足限流后的服务目标。
- 使用无 `BYPASSRLS`、非表 owner 的真实应用角色：仅设置 `app.user_id` 时只能读取本人 Tenant Directory；不能 JOIN/子查询 members，也不能读取其他 user 的目录。
- 从本人目录获得 tenant 引用后必须逐租户重新校验 active tenant/member；伪造 selected tenant 时不得先泄露 tenant 是否存在。
- 公共 communication session、participant、media leg、Worker dispatch、Provider operation 和 TTS playback 使用两个真实 tenant 做 CRUD、分页、取消和迟到事件攻击；Repository predicate、复合 FK 和 forced RLS 三层都必须拒绝跨租户访问。
- 对只传 session/provider/playback/dispatch ID、不传 scope，或把 `owner_id`/`user_id` 过滤省略的调用做负向测试；任何返回全局记录的通用 Repository 都阻断 A1。

`ENT-DATA-008` 当前仅具备本地自动化候选证据：公共第31段 migration 的不可空 scope、
复合 FK、写入 trigger、forced RLS 和 enterprise tenant session/Repository contract 已由
schema 测试及 session/leg/dispatch/provider/playback/participant 六资源跨租户矩阵覆盖。
正式 `AC-ENT-0014` 仍必须在无 `BYPASSRLS`、非表 owner 的真实 PostgreSQL 应用角色下，
以两个 tenant 执行 CRUD、裸 ID、伪造 scope、取消和迟到事件攻击；该证据未完成前不得把
`ready_for_acceptance` 改为 `accepted`，也不得通过 A1/H3。

### 6.2 RBAC

| 操作 | 管理员 | 营销主管 | 坐席 | 主持人 | 审计员 |
| --- | --- | --- | --- | --- | --- |
| 发布知识 | 允许 | 按授权 | 拒绝 | 拒绝 | 只读 |
| 审批活动 | 允许 | 允许 | 拒绝 | 拒绝 | 只读 |
| 接管客服 | 按授权 | 拒绝 | 允许 | 拒绝 | 只读 |
| 停止共享 | 允许 | 拒绝 | 拒绝 | 允许 | 只读 |
| 导出审计 | 允许 | 拒绝 | 拒绝 | 拒绝 | 按授权 |

### 6.3 幂等和账本

- 同一 idempotency key 重放100次只产生一次业务结果。
- webhook 乱序、重复和延迟不重复拨号、工具执行、导出或结算。
- session 终态、hold release、ledger 和 outbox 原子提交。
- API 重启后余额、任务和审计保持一致。
- 在真实 PostgreSQL 上并发 claim 同一 outbox，只有一个 Worker 获得有效 lease；进程在 claim、Provider 返回和 finalize 三处故障后均可恢复。
- lifecycle 和 outbox 的平台恢复发现只返回最小 tenant/job/event 引用；实际 claim/finalize 必须在对应 tenant RLS transaction 内完成。
- cell Worker 仅设置自己的 `app.cell_id`，并记录 worker/trace；不得读取其他 cell、未分配 cell 的记录、payload、request hash 或 Provider reference。
- tenant 迁移 cell 后，旧 cell 的已发现引用在 claim 前复核失败；复核和 claim 使用同一事务及 tenant route row lock，新 cell projection 更新后才能 claim。伪造 tenant/ref 不得绕过该复核。
- PostgreSQL account subject 只接受规范 `user_<uuid>`；raw UUID、测试短名和 system actor 不能写入 user 列。audit/policy/idempotency actor 可接受受约束的 `system:*` 命名空间。
- schema verify 必须逐列拒绝遗留 UUID identity；带非账号 actor 的数据库执行 down migration 时必须明确阻断，不能静默丢失或改写 actor。
- API 默认启动不得连接 PostgreSQL；`verify` 不得写 migration，`migrate_verify` 必须先迁移再校验。非法 mode、缺连接、checksum/schema/RLS/identity 失败必须在恢复任务和监听端口之前终止，且校验连接必须关闭。
- Provider 已完成但响应丢失时，重试必须携带同一 idempotency key 并获得同一结果；没有 sandbox 或白名单 Provider 证据时，不能把自动化结果升级为 `accepted`。

## 7. A1 企业会议验收

### 7.1 创建和入会

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-MTG-001 | 预约会议 | 邀请、策略、术语和保存期限正确 |
| AC-MTG-002 | 即时会议 | 3秒内获得可用 join token |
| AC-MTG-003 | 未授权入会 | token/tenant/meeting 任一不符即拒绝 |
| AC-MTG-004 | 四人入会 | 成员、访客和主持人身份正确 |
| AC-MTG-005 | 重启恢复 | API/Worker 重启后会议和参与者状态收敛 |

### 7.2 字幕、翻译和说话人

- 两人无停顿轮流说话，字幕不跨人合并。
- 四人顺序和随机发言，标签不固定错误归到同一人。
- 中英夹杂不因语言切换产生硬断点。
- 30分钟会议 audio frame drop 为零或有明确网络诊断。
- final 字幕首屏 P95 不高于2.5秒；译文在 final 后 P95 不高于1.5秒。
- TTS 顺序与 turn 一致，抢话只取消目标腿当前播放。

### 7.3 屏幕共享

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-SHARE-001 | Web 整屏/窗口/标签页 | 三种可用来源均能发布和停止 |
| AC-SHARE-002 | iPhone ReplayKit | 离开 App 后持续共享，返回后状态一致 |
| AC-SHARE-003 | 同时共享竞争 | 两人同时 acquire 仅一人成功 |
| AC-SHARE-004 | 主持人停止 | 500ms内撤销，迟到轨道不能恢复 |
| AC-SHARE-005 | 暂停恢复 | 暂停冻结画面，恢复不创建重复共享记录 |
| AC-SHARE-006 | 网络切换 | Wi-Fi/蜂窝切换不结束会议，轨道可恢复 |
| AC-SHARE-007 | 自适应画质 | 网络受限优先保留音频和字幕 |
| AC-SHARE-008 | 系统音频 | 与麦克风独立，不形成循环和错误发言段 |
| AC-SHARE-009 | 横屏/大字体 | 控件、字幕和画面不遮挡关键操作 |
| AC-SHARE-010 | 结束清理 | meeting ended 后无活跃租约和轨道 |

共享启动 P95 不高于3秒；主持人 stop P95 不高于500ms。默认数据库和对象目录中不得出现屏幕帧。

### 7.4 屏幕 OCR 翻译

- PPT、网页、表格和深色页面识别。
- 相同帧不重复调用 OCR/翻译。
- 译文位置与原文区域对应，缩放和横屏保持对齐。
- OCR 服务关闭时共享继续，只提示内容翻译不可用。
- 未授权时 OCR Worker 不订阅屏幕轨道。

### 7.5 会后材料

- 逐字稿、译文、说话人和时间轴一致。
- 摘要、决定、待办和风险均引用 segment ID。
- 未说出的截止时间和负责人不得由 LLM 补写。
- 当前会议姓名修改不自动污染企业全局身份。
- 导出权限、审计和删除期限正确。

## 8. A2 AI 客服验收

### 8.1 渠道和语言

- PSTN、Web 和 App 各创建一个真实会话。
- 中文、英文和快速切换均能识别并回复。
- AI 身份与录音告知在业务回答前完成。
- 客户拒绝录音时按企业策略切换不录音或转人工。

### 8.2 RAG

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-CS-RAG-001 | 已发布知识 | 回答准确且保存引用版本 |
| AC-CS-RAG-002 | 无知识问题 | 明确无法确认并提供人工路径 |
| AC-CS-RAG-003 | 过期知识 | 不进入回答上下文 |
| AC-CS-RAG-004 | 跨租户诱导 | 不返回另一租户内容 |
| AC-CS-RAG-005 | 冲突知识 | 按生效版本并提示需要确认 |

### 8.3 工具调用

- 查询订单使用当前客户授权身份，不能修改客户 ID 查询他人订单。
- 创建工单前复述关键信息并取得确认。
- 相同请求重试只生成一个外部工单。
- Adapter 超时不对客户说“已经完成”。
- 退款、付款、身份验证和合同修改必须请求人工。

### 8.4 人工接管

- 客户主动说“转人工”后立即进入 handoff_requested。
- AI TTS 在300ms目标内停止，旧音频不恢复。
- 两个坐席同时 claim 只能一个成功。
- 坐席看到客户问题、知识引用、工具结果和风险。
- 坐席退出或断网后会话可重新分配，不形成双控制者。

### 8.5 客服结果

- 会话结束生成摘要、诉求、处理结果和待办。
- 工单/CRM 不可用时 outbox 重试并只同步一次。
- 指标可以按租户、渠道、语言、问题和知识版本过滤。

## 9. A3 出海外呼营销验收

### 9.1 合规预检

以下任务拨号数必须为零：

- 无授权证据。
- 授权已撤回或过期。
- 命中企业禁拨名单。
- 不在当地允许时间窗口。
- 活动未审批或已暂停。
- 国家策略缺失或过期。
- 租户余额不足或达到并发熔断。

### 9.2 任务并发

- 50个 Scheduler 并发 claim 同一批任务，每个任务最多 dispatch 一次。
- Worker 在 dispatch 前崩溃，租约超时后可恢复。
- Provider 已接受请求但响应丢失时，通过 idempotency 查询，不盲目重新拨号。
- answered/completed webhook 重放100次只结算一次。

### 9.3 真实通话

- 使用明确授权的企业测试号码白名单。
- 接通后先说明品牌、AI 身份和目的。
- 客户说“不感兴趣/不要再联系”后立即停止并写 suppression。
- 再次导入同号码也不得生成可执行任务。
- 中途要求人工时可接管；无人接管时明确结束或预约回拨。
- 高风险请求不得由 AI 承诺或执行。
- 无 PSTN clearPlayback 能力时必须半双工，不宣称全双工。

### 9.4 结果和 CRM

- disposition、意向、摘要和下一步与真实对话一致。
- 预约和回访只创建一次。
- CRM 故障不影响通话终态和结算。
- 国家、活动、话术版本和 Provider 成本可拆分分析。

## 10. H1 故障注入和长稳

| 故障 | 期望 |
| --- | --- |
| API 重启 | 客户端重连，任务不重复，终态收敛 |
| Gateway 重启 | 保存已完成 segment，最后一句 flush |
| Worker 崩溃 | lease 恢复，不重复拨号/工具/播放 |
| LiveKit 断开 | 会议和客服显示明确重连状态 |
| ASR 故障 | 转人工或保留通话，不生成假字幕 |
| LLM 故障 | FAQ/结束语或转人工，不自由编造 |
| TTS 故障 | 字幕保留；外呼安全结束或转人工 |
| OCR 故障 | 屏幕共享继续 |
| CRM 故障 | outbox 重试，业务终态不回滚 |
| 数据库 busy | 有限重试，超时明确失败，不丢 ledger |
| SaaS 控制面中断 | 已建立区域会话继续；开通和套餐变更明确不可用 |
| 单租户流量失控 | 只熔断该租户，不影响其他租户 |

长稳要求：

- 会议连续2小时。
- 客服连续100个会话。
- 外呼白名单连续100个任务。
- 无内存持续增长、残留 hold、重复 ledger、残留 screen share lease 或无法结束 session。
- 依次执行 25、50、100 并发通讯会话阶梯压测，并保留 API/DB/LiveKit/Worker/Provider/tenant 指标和拒绝原因。
- 使用真实会议、客服、外呼、ASR、翻译、TTS 混合流量连续120分钟；不得用纯健康检查或单一 mock 请求替代。
- 压测中让一个 tenant 持续超配额，验证其他 tenant 的登录、建会、接管和安全结束能力仍满足目标；过载 tenant 只收到有界拒绝/降级。

## 11. H2 安全和隐私

- 伪造 tenant、user、role、meeting、campaign 和 customer ID 攻击。
- token 过期、重放、跨房间和越权发布轨道攻击。
- webhook 签名、时间戳、防重放和 payload 限制。
- prompt injection 不能绕过工具 allowlist 和租户过滤。
- 日志中不存在完整号码、token、声纹、音频和屏幕像素。
- 对声纹、录音和诊断音频分别执行缺授权、错 purpose、跨租户、过期、撤回和重放矩阵；
  任一失败必须使当前策略快照/Worker 副作用失败闭合，不能只隐藏客户端入口。
- 导出、删除、撤回和保存期限有审计记录。
- 删除任务在对象服务故障后最终收敛。
- 安全扫描 P0/P1 问题清零。
- 外部请求携带伪造 tenant/role/scope/cell/route epoch tracing baggage 时，网关必须删除并从已验证身份重建；trace/baggage 不能扩权。
- 临时依赖漏洞例外必须列 owner、锁定版本、缓解措施和到期日；例外到期或适用版本变化会阻断发布，且任何报表不得将其表述为“零漏洞/已修复”。

## 12. H3 PostgreSQL、Cell 和灾备

- PostgreSQL 作为所有真实 SaaS 租户的初始真源。
- 内部 SQLite 演示数据可以迁移，但不能作为客户生产迁移路径的必要依赖。
- 验收 commit 锁定的公共31段 manifest（基线从 `fe1c3c2` 演进）与 enterprise 18段 migration manifest 在隔离企业数据库从空库完整执行；两个 manifest 的顺序、checksum、schema verify 和 down/forward 策略均有证据，不能只跑其中一套。
- 每个进程只有一个 Storage Driver 和 startup verdict；HTTP、企业 Repository、统一通讯会话和 cell Worker 使用同一 verified Primary Runtime，不存在 fallback、shadow read、dual write 或按路由混用。
- 应用 tenant、user directory、cell discovery、migration、maintenance 分别使用最小权限角色；生产 TLS 使用 `verify-full`。应用角色没有 `BYPASSRLS`、表 owner、DDL 或关闭 RLS 权限。
- 公共 communication session、participant、media leg、dispatch、Provider operation、playback 和相关账本全部具有 tenant scope、复合 FK 和 `FORCE ROW LEVEL SECURITY`；使用跨租户 ID、缺 scope、伪造 owner/user 过滤做负向验证。
- 使用普通应用角色验证 `communication_session_bindings` 的三类互斥业务 FK、同 tenant 公共 session 复合 FK、route/policy/entitlement 快照不可变、唯一绑定和跨租户不可见；按 Meeting/Support/Marketing 分别执行精确重放、参数漂移、旧 route/generation、重复序号、非法倒退和终态恢复矩阵。
- 使用普通应用角色验证 communication policy/version/snapshot forced RLS、不可变 trigger、授权撤回即 invalidated、dispatch grant 的 policy FK；按有效、缺失、过期、错 fingerprint、错 purpose、跨租户和撤回后迟到副作用执行负向矩阵。
- 使用普通应用角色验证 billing account/plan/subscription/entitlement/change history forced RLS、活动 subscription 唯一、plan/snapshot/change 不可变，以及 entitlement projection/binding/grant 的 tenant 复合 FK；按跨租户、停用 account、过期账期、错 subscription/plan/version、席位超限、幂等漂移和客户端 limit 伪造执行负向矩阵。
- accounts、tenant、communication session、segment、campaign、support、meeting、ledger 和 object hash 数量与规范化 SHA-256 一致。
- 全量复制后记录增量水位，切换时获取 writer fence、清退旧 API/Worker、重放剩余 inbox/outbox，再做第二次 count/hash；切换或对账失败可按书面决策回滚，旧 writer 不能继续写入。
- staging startup 必须拒绝 local evidence、签名篡改、错误 cutover/target ID、错误 commit/image/topology、错误 system identifier/OID、缺 baseline 引用、未清退 writer 或任一31+18 migration 漂移。维护工具只验证 fence，不自动执行 promote 或隔离旧主。
- migration 后使用普通应用角色验证 `FORCE ROW LEVEL SECURITY`；确认 user directory self policy、tenant projection policy、成员投影同步和跨租户拒绝均生效。
- 使用独立 cell Worker 角色验证 pending projection forced RLS、trigger 同步、空 cell 失败闭合、旧 cell 拒绝和 tenant transaction 原子 claim。
- 使用 API 应用角色验证 PostgreSQL runtime 只在 startup gate `verified` 后创建；非法或 `dual_write` driver、连接/校验失败均不得监听端口，也不得回退到 legacy。
- 停止 API/Worker 后，分别从 JSON 和 SQLite 导入 Tenant/Member/Job/Audit/Inbox/Outbox；确认 SQLite 原文件 hash 不变、目标非空时导入拒绝、每集合 count/SHA-256 与总 hash 一致。
- 人为改变一条记录、漏写一个集合和制造数据库约束错误，确认 import transaction rollback；独立 `reconcile` 使用 repeatable-read 只读快照并报告具体不匹配集合。
- Worker 同 cell 多实例并发时验证只有一个有效 claim；单条 finalize 失败不阻断同批其他记录，poll 故障后继续下一轮，所有 Provider 投递复用 event ID 幂等键。
- 验证 `0010` 将旧 UUID identity 规范化为 `user_<uuid>`，Directory self RLS 仍生效，system actor 可审计且 user 列拒绝 system actor。
- 分别执行 disabled、verify、migrate_verify 和非法启动模式；确认 disabled 无连接、verify 无写 migration、migrate_verify 顺序正确，所有失败均无 HTTP 监听或后台恢复任务。
- 恢复后余额、审计、禁拨和授权证据一致。
- 租户迁移 cell 后旧 cell 拒绝新写入，route document 指向新 cell。
- 在不同物理故障域部署主备，执行自动 leader election；网络分区/主机掉电后旧主必须被 fencing，旧 route epoch 和旧 Worker generation 的写入/副作用全部拒绝，原主重新加入前先校验 timeline/数据一致性。
- base backup 与 WAL 加密保存到异地主机不可变存储，执行指定时间点恢复并核对 tenant、session、ledger、audit、suppression、consent 和 object manifest；同机副本、人工 promote 或只验证归档文件存在均不算通过。
- 主产品 staging、同机复制、个人账单或可选 owner Product Records 的结果不能继承为本 H3 证据；每份证据必须绑定企业 commit、image digest、数据库 manifest checksum 和环境拓扑。

`ENT-DATA-009` 的本地 PostgreSQL 16 同机双库、`pg_dump/pg_restore`、writer fence 和
篡改负测只满足 `AC-ENT-0020` 的机制/自动化前置条件，不满足上述不同物理故障域、
异地主机不可变 WAL/PITR、自动选主、RPO/RTO 或完整 H3 放行条件。

具体 RPO/RTO 由企业 SLA 确定；未确定前不能在材料中承诺数值。

## 13. 验收执行顺序

| 周期 | 内容 | 放行结果 |
| --- | --- | --- |
| T0 | A0 工程、SaaS 控制面、A1 公共底座 | A1 候选环境 |
| T1 | A1 会议、屏幕共享和纪要 | A1 企业会议试用 |
| T2 | A2 客服、RAG、工具和接管 | A2 客服试点 |
| T3 | A3 外呼白名单、合规和结算 | A3 单国家外呼灰度 |
| T4 | H1/H2 故障、安全和长稳 | 候选发布 |
| T5 | H3 PostgreSQL、灾备和发布材料 | A4 企业正式发布 |

## 14. 验收证据格式

每个验收任务保存：

```text
acceptanceId
taskId
commitSha
buildVersion/imageDigest
tenantId (脱敏)
session/campaign/meeting id
testDevice/browser/provider
startedAt/endedAt
expected/actual
metrics
ledger/hold result
log or screenshot references
status: pass/fail/blocked
owner
reviewer
evidencePath
```

不得仅以“感觉正常”结项；真实媒体任务必须包含服务端 session、Provider、用量和错误诊断证据。

## 15. 最终发布门禁

企业正式发布必须全部满足：

- A0-A3 与 H1-H3 适用项通过。
- 无串租户、误拨、重复结算、无法停止共享或高风险自动执行问题。
- PostgreSQL 和备份恢复通过。
- 公共/enterprise migration、统一 Primary Runtime、通讯 tenant scope、全量切换/hash 和跨故障域自动恢复全部通过。
- 租户开通、套餐、计量、欠费、注销、区域路由和 noisy-neighbor 门禁通过。
- 客户不需要安装或维护任何 AI Phone 服务端组件。
- 真实 PSTN、域名、证书、Webhook、监控和值班配置 ready。
- 外呼目标国家的规则和告知文本已由企业法务确认。
- iOS/Web 正式构建通过；Android 能力按既定产品化阶段明确标注。
- 管理员、坐席、主持人和审计员使用手册完成。
- 已准备 kill switch，可按租户、活动、Provider 和功能立即停止。
- 不存在已到期的临时安全例外；未到期例外必须在发布记录中明确风险、缓解和截止日，不得宣称零漏洞。

## 16. 开发任务与验收执行矩阵

| 开发任务 | 首次执行 | 必须复跑 | 可放行到 |
| --- | --- | --- | --- |
| CORE-001/002 | A0、A1 tenant/RBAC | 所有新增企业资源和角色变更后 | A1 |
| CORE-003、UI-001..010 | AC-UI-001..012、A0 build | 每次导航、主题、状态组件或前端依赖变更 | A1 |
| CORE-004/005 | AC-ENT-0021/0022、A1 tenant/RBAC、知识/术语/话术恶意输入 | schema、分块、发布、检索、resolver 或引用格式变更后 | A1；对象存储/embedding/真实 Worker 与质量证据完成后进入 A2/A3 |
| UI-011/012、MTG-001..013 | AC-UI、AC-MTG、AC-SHARE、会后材料 | RTC、token、共享、字幕或布局变更后 | A1 |
| CS-001..012 | AC-UI、A2 客服、H1 故障 | Agent、知识、工具、队列或 Provider 变更后 | A2 |
| MKT-001..014 | AC-UI、A3 外呼、H1/H2 | 国家策略、Provider、调度、话术或接管变更后 | A3 |
| DATA-001..009 | A0 单 Primary、A1 隔离、H1、H3 | schema、Repository、Primary runtime、scope、迁移、备份或 cell 变更后 | A4 |
| CORE-007/010/012、CORE-013..015 | AC-ENT-0014..0019、A1 隔离、业务会话、计量、H1/H2 | 会话、dispatch、账务、cell route、声音/录制策略或 Worker 变更后 | A1；对应 Provider/账务环境就绪后进入 A2/A3 |
| REL-001..008、OBS-001 | H1/H2/H3 和最终发布门禁 | 每个正式候选版本 | A4 |

### 16.1 执行节奏

1. 开发任务进入 `ready_for_acceptance` 时创建对应 acceptance run，冻结 commit、构建和环境。
2. QA 执行自动化和人工场景；Backend/RTC 提供 trace、Provider、ledger 和数据库证据；Web/Flutter 提供页面、浏览器和真机证据。
3. 失败项创建缺陷并关联 acceptance ID；修复后先复跑失败项，再按上表复跑受影响组。
4. 所有证据由独立 reviewer 复核后，任务才能标记 `accepted`。
5. 外部账号或法律确认缺失时，只允许保持 `blocked` 或缩小发布范围，不能以 mock 通过替代真实门禁。
