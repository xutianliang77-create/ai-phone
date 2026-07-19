# 无界AI企业版验收任务与计划

版本：v1.57
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
| AC-ENT-0020 | Primary 切换与恢复证据 | 公共31段/企业44段 manifest、全部业务表 count/整行 hash、关键 tenant/session/ledger/audit/consent/suppression/country-policy/approval/object 清单和增量 WAL 水位一致；源 writer fence 与 SQLSTATE 25006 写拒绝、旧 API/Worker 角会话为0、目标写探针成功；baseline/cutover/restore evidence 验签并绑定 commit/image/topology/system identifier/OID；任意单行篡改失败闭合 |
| AC-ENT-0021 | 企业知识版本 | source/revision/chunk 只能由 `knowledge:publish` 且持有效 tenant route 的角色写入；revision 服务端串行递增，chunk/block 唯一且 hash 由服务端生成；无 chunk、非 review、旧 expectedVersion、跨租户和 tenantId 伪造全部拒绝；published version/chunk 不可更新删除；检索强制 tenant/locale/country/product/effective-time，只返回每个 source 最新有效 published revision，并产生稳定 `knowledgeVersionId:blockId` citation；draft/review/failed/未来/过期均为0结果 |
| AC-ENT-0022 | 企业术语与话术版本 | term pack/script template 稳定资源与 revision 只能由 `knowledge:publish` 且持有效 tenant route 的角色写入；revision 服务端串行递增，term ID/原词唯一，话术必说语与禁语不冲突，hash 由服务端生成；非 review、旧 expectedVersion、跨租户、tenantId 伪造、评审后改内容/hash 和 published 更新删除全部拒绝；resolver 强制 tenant/source-target locale/country/product/purpose/effective-time，只返回当前有效 published 版本，且顶层、ASR、翻译和 LLM 的 `termPackVersionId` 完全相同，话术版本只进入 LLM；draft/review/未来/过期/用途不符均明确 not ready |
| AC-ENT-0023 | 企业会话链路报告 | API 响应 `x-trace-id` 与 TenantContext、communication binding、usage event/ledger 和 Provider operation 一致可关联；会话报告只允许 `audit:read` 且必须受 tenant forced RLS 隔离；质量指标只由真实 segment/latency 计算，无样本返回 `no_samples`；用量逐项引用 event/ledger/trace；无单位价格表时货币金额必须为 null 且 reason 为 `pricing_not_configured`；跨租户 session ID、伪造 trace 和 legacy trace 不得泄露其他租户审计 |
| AC-ENT-0024 | 受控审计导出 | 创建要求 `audit:export`、有效签名 route、幂等键、目的、最长31天半开范围和1至30天保留期；job/request/终态不可改写且 forced RLS；Worker 最多导出10000事件/10MiB并生成 event count、size、SHA-256、到期时间；下载重新鉴权、校验对象 size/hash并写审计；跨租户、篡改、过期、未配置对象存储全部失败闭合；物理到期删除和对象清单由 REL-002 验收 |
| AC-ENT-0025 | Support Agent | run/turn 使用 tenant-first FK、forced RLS、幂等/hash/sequence 和终态不可变；Provider 请求关闭 thinking 并使用六字段 strict JSON schema，额外字段、无引用回答、引用越界、风险未 handoff 全部拒绝；无 evidence 不调用 LLM，未配置/超时/不可用/非法输出明确 degraded/handoff；上下文不超过12轮/8000字节；ticket/lease/policy/route/generation 在 prepare、complete、TTS authorize 均复核，取消/接管后旧 generation 不能播放或恢复，playout 完成前不能标 delivered |
| AC-ENT-0026 | Tool Registry | definition 按 tenant/name 串行递增 revision，draft/active/retired 单向且发布后内容不可改写，同名只有一个 active；forced RLS 和复合 FK 阻断跨租户；read/reversible/high-risk 必须分别精确映射 `support:read/none`、`support:manage/customer_confirmation`、`support:takeover/human_handoff`；schema 只允许封闭根对象、32个 primitive 字段和8192字节，未知字段/类型/边界失配均拒绝；授权重验内部凭据、ticket/lease/binding/policy/route/generation/run/session，tenant/customer/session 不可伪造；同幂等键同 hash 精确重放、异 hash 冲突；只读只创建 requested，可逆写只创建 awaiting_confirmation，高风险只 handoff 且不创建 execution；未注册、draft、retired 和旧非终态 execution 均不得继续执行 |
| AC-ENT-0027 | 只读 Tool Adapter | 只允许 active `order.lookup/logistics.lookup/inventory.lookup` 的 read execution；签名 Worker、run、session/customer、schema/arguments hash 和租约在 claim/finalize 均复核；订单/物流跨 customer 与不存在表现一致，库存不能跨 tenant；默认 Adapter 返回 not_configured 且不调用外部系统，mock 明确 `simulated=true`；并发请求仅一个 lease 生效，过期重领递增 attempt，旧 lease/迟到结果不能完成；输出精确校验，缺 Adapter receipt 或结果/hash 不一致失败闭合，同 execution 同参数稳定回放且不重复产生有效结果 |
| AC-ENT-0028 | 可逆写 Tool Adapter | 只允许 active `ticket.create/callback.schedule/note.add` 的 reversible_write execution；确认挑战绑定当前 run、挑战后新 turn、sequence、客户文本 hash 和120秒有效期，未确认、含糊、过期、旧 turn、跨 run/session/tenant、参数或 revision 变化时 Outbox 数为0；回拨时间在挑战和确认时均为未来；确认与密文 Outbox 同事务，明文参数不入库/审计；Adapter 必须 tenant-bound、声明 Provider 幂等保证且 fingerprint/simulated 与确认时一致；超时/未知结果使用同一幂等键重试且不写确定失败，完成或确定失败必须带 receipt/reference 并与 execution/outbox/audit 原子 finalize；并发/重复确认只存在一个 Outbox 和一次有效外部效果；默认 not_configured，mock 固定 `simulated=true` |
| AC-ENT-0029 | 高风险人工接管 | active high-risk definition 必须精确为 `support:takeover/human_handoff`；退款、付款、身份验证及其他 high-risk 请求只生成不可执行且不可变的 handoff request，绑定 tenant/run/session/customer/definition revision/arguments hash/policy/risk evidence hash；原始参数和敏感材料不入库/审计；首次请求与 run/session 的 handoff_requested 原子提交，同幂等键同证据返回同 request、异证据冲突；DB insert/mutation guard、forced RLS 和 execution guard 阻断跨租户、失活绑定、改写删除、execution/Outbox/Provider 调用；接管后普通回答不能获得新 TTS 授权；当前不得声称坐席已接通 |
| AC-ENT-0030 | 坐席队列与互斥接管 | queue SLA 为10..86400秒、claim lease 为30..3600秒；work-item 按 SLA breach、priority、handoff time、ID 稳定排序；claim 只能绑定当前登录 active 客服成员，请求体不能指定 agent；同 tenant/session 同时最多一个 active claim，human_active 的 session/claim/assigned user 必须一致；坐席只能自释/续租，owner/admin/support_manager 才能覆盖释放或改派，目标必须是同 tenant active 客服角色；claim/release/reassign 同键同 hash 精确重放、异 hash/旧 version 冲突；lease 到期可原子释放重领且旧坐席不能继续控制；跨租户、paused/disabled queue、非 handoff session、非客服角色、直接 SQL 绕过、事务中途失败均不得形成双控制者 |
| AC-ENT-0031 | 坐席工作台与 AI 停止发言 | workbench activate/read 只允许 assigned agent 或同 tenant owner/admin/support_manager 且 active claim 未过期；claim、session human_active、最新 Agent run cancel 和审计原子提交，旧 claim 恢复也必须先补建 fence；cancelled/terminal/not_started 才能返回 ready，旧 Worker ticket/generation 的 prepare/TTS authorize/deliver 均为0；字幕只返回 tenant-scoped 每段最终 revision并稳定排序，跨租户 session/segment/customer/case/tool/risk 不可见；客户、Agent 上下文、知识维度、case、工具结果和风险证据完整但不暴露 phone/request/idempotency/dispatch secret；续租为 now+queue lease，字幕轮询不续租且旧响应不回退 claim version；release/过期/断网后控制停止；Provider/API 缺失的静音、转组、结束、工单、回呼固定 not_ready；真实 LiveKit 中已开始音频须在300ms内 interrupt 且旧音频不恢复 |
| AC-ENT-0032 | 工单、回拨与可靠后续动作 | 仅 assigned agent 或同 tenant owner/admin/support_manager 且 active claim/route 有效时可提交，session/claim expected version 失配、跨租户或 body 伪造 tenant/customer/agent 均拒绝；`0035` 两表 tenant-first FK、forced RLS、状态 trigger 和同 session 幂等键/hash 阻断跨租户、改写删除、同键异请求和孤儿业务行；Provider/keyring 未配置时业务行/Outbox/审计均为0，simulated 必须显式；ready 时 pending case 或 dispatch_pending callback、followup、密文 Outbox、脱敏审计原子提交且只返回 processing；超时/未知结果/fingerprint变化/非法 receipt 使用同一 Provider 幂等键重试，不写 external ID；确定 receipt 才原子收敛 case/callback、command、Outbox 和审计；会话释放/结束不取消已接受 Outbox，也不等待外部完成 |
| AC-ENT-0033 | 客服质检分析 | `quality:read` 仅主管/owner/admin/auditor可读，`quality:manage` 仅主管/owner/admin可发布与分析；`0036` 三表 tenant-first FK、forced RLS、insert guard 和不可变 trigger 阻断跨租户与改写；规则按 locale/通配符解析、同键同 hash 重放、异 hash 冲突；仅 ended/failed session 与终态 Agent run 可分析，source hash 绑定 run/turn/output；五类结构发现与 evidence hash 可复现；Dashboard 每会话只计最新复核；未配置语义模型时 review 固定 partial/not_configured、错误回答率为 null，禁止以无引用规则冒充语义错误率 |
| AC-ENT-0034 | Campaign 聚合 | `campaign:read/write/approve` 角色矩阵与签名 route 生效；创建只能形成当前 tenant/actor 的 `draft/not_submitted`；创建、PATCH、schedule 均要求幂等键，同键同 hash 精确重放、异 hash 冲突且不重复审计；PATCH 只改未提交草稿且 expectedVersion 冲突不覆盖；`0037` 唯一键、owner/member 复合 FK、forced RLS、身份/版本/状态 trigger 阻断跨租户、改写和非法迁移；schedule 仅 `campaign:approve` 且 approved 状态/审批、policyVersion、未来 startAt 全部满足时进入 scheduled，任一缺失 task/Outbox/Provider 副作用均为0；Web 不显示 fixture 或真实 PSTN 成功 |
| AC-ENT-0035 | 线索导入与回滚 | `campaign:read/write` 与签名 route 生效；CSV/API 最大500行、E.164 国家解析、时区/语言/扁平属性边界和逐行错误可复现，任一错误 Lead/link/batch 为0；号码原始值/E.164 仅 AES-GCM 密文落库，tenant HMAC hash 唯一且 API/Web/审计/日志只显示 hint；同 tenant 号码与 external ID 一致绑定，同活动重复为 duplicate、已有 Lead 新关联为 linked、新 Lead 为 created，三计数之和等于总行数；同键同规范 hash 精确重放、异 hash 冲突；`0038` 三表 tenant-first FK/forced RLS、batch/link/row 不可删除、row append-only、状态/version trigger 阻断跨租户与改写；回滚只允许未提交草稿和正确 expectedVersion，同键重放，保留 batch/row/Lead，且有其他活动关联、consent 或 task 的 Lead 不停用；保护密钥/非 PostgreSQL 未配置时503且不回退；Consent/Suppression/task/Outbox/usage/PSTN 副作用均为0 |
| AC-ENT-0036 | 自动营销电话授权证据 | `campaign:read/write`、active membership 与签名 route 生效；登记只接受当前 tenant 的 active Campaign Lead、固定 `automated_marketing_call` purpose、允许的取得渠道、严格时间/版本/来源和 UUID 对象描述；S3/KMS 或非生产本地证据实体必须真实存在，tenant/object metadata、SHA-256、size、content type 和服务端加密全部匹配，公开 URL、缺配置、篡改或跨 tenant 对象均失败闭合；`0039` Campaign/Lead/member 复合 FK、forced RLS、唯一 evidence/幂等键、不可删除/不可改写 trigger 只允许一次版本化撤回；同键同 hash 精确重放、异 hash/重复 object 冲突；有效性按服务端时间要求 granted、未过期、未撤回且 active link/Lead；无有效授权、未来授权、过期或撤回时可执行任务数为0，task insert/reschedule 由数据库拒绝；撤回不删除历史，取消无替代有效授权的 pending/scheduled/retry 任务并审计；Web 只显示脱敏号码、证据 hash/对象引用、状态和真实阻断原因，不显示 PSTN/Provider 成功 |
| AC-ENT-0037 | 企业与全局禁拨名单 | `campaign:read/write`、active membership 与签名 route 生效；公开创建只允许当前 tenant 的 active Campaign Lead、固定 tenant scope、四类受控来源、严格原因/来源标识和幂等键，号码只从加密 Lead 的 tenant HMAC 身份解析；global scope 只允许 namespaced system actor 与 `global_registry` 投影，租户成员、body scope 或跨 tenant ID 不能伪造；`0040` 复合 FK、forced RLS、唯一 phone/scope 与 actor/key、不可更新删除 trigger 和同号码 advisory transaction lock 阻断跨租户及 task/create 竞态；同键同 hash 精确重放、异 hash 冲突，已有号码不重复写；首次禁拨在同一事务取消该号码跨活动全部 pending/scheduled/retry，task insert/reschedule 命中 tenant/global 时 SQL 拒绝；全局注册表未配置/降级时资格为 not_ready，不能把 tenant 未命中显示为可拨；Web 只显示脱敏号码、不可变原因/来源/取消数和真实 readiness，不显示 Scheduler/PSTN 已停止 |
| AC-ENT-0038 | 国家策略与执行栅栏 | `campaign:read/approve`、active membership 与签名 route 生效；发布只接受当前 tenant、ISO 国家、规范版本、1..28 个同日不跨午夜/不重叠窗口、频控/重试边界、三段告知、合法语音信箱 union、合规依据和明确有效期；同 actor/key 同 hash 精确重放、异 hash 冲突，同国家版本和有效期区间唯一；`0041` forced RLS、member 复合 FK、不可更新删除 trigger、JSON/actor/tenant guard 阻断改写和跨租户；Campaign readiness 与 scheduled trigger 对每个国家按 startAt 返回/拒绝 missing/future/expired；task 必须引用与 Lead country 一致且覆盖 scheduledAt 的版本，Lead IANA timezone 缺失/非法、当地窗口外、跨活动最小间隔或滚动频控超限时 SQL 拒绝；Web 只展示真实版本/hash/阻断原因并声明配置不等于法律结论，不显示审批/Scheduler/PSTN 成功 |
| AC-ENT-0039 | 活动校验与审批快照 | `campaign:read/write/approve` 角色、active membership 与签名 route 生效；validate 只接受当前 tenant 的 draft/rejected expectedVersion 和幂等键，固化 Campaign、startAt Policy set、active Lead/link/committed batch、逐 Lead 目标时间有效 Consent 与 Suppression set；缺未来时间、无 Lead、国家/策略/IANA timezone/Consent 不符或任一禁拨时 blocked 且 Campaign 不变；ready 才经 validating 进入 pending；approve/reject 必须引用同 Campaign ready validation，批准前重建 snapshot，漂移返回 stale，拒绝理由必填并回 rejected draft；`0042/0043` 两表 forced RLS、复合 FK、insert-only、actor/time/source-version/状态 trigger 阻断跨租户和 SQL 跳步；批准固定 decision ID/hash，scheduled 与 task 再复核当前 snapshot 且 task 必须出现在冻结 Lead/Consent/Policy set；Web 只展示真实计数/hash/issues/decision，不显示 Scheduler/PSTN 成功 |
| AC-ENT-0040 | Scheduler 任务物化与 claim | schedule 在 Campaign 状态变更同一事务按 approved snapshot 为每条冻结 Lead 生成唯一 attempt-1 task；任一 IANA/当地窗口解析失败时零 task/零状态变化，同命令重放不增加 task；内部 claim 必须同时通过内部密钥、签名 route、当前 tenant/cell/route epoch、approval/Lead/Consent/Suppression/Policy/当地窗口、活动与租户 entitlement 并发和精确60秒营销 usage hold；`FOR UPDATE SKIP LOCKED` + version CAS + DB trigger 下50 Scheduler 并发每 task 仅一 claim，单租户满载不阻塞其他 tenant；崩溃后 lease 到期释放 hold 并回 retry，撤回/禁拨取消未派发 claim；Web 只读显示真实计数/预算/并发且不显示通信会话、Outbox 或 PSTN 成功 |

`ENT-CS-005` 当前只形成 `AC-ENT-0026` 的代码候选；自动化、migration up/down/forward、
forced-RLS 双租户、并发发布、Worker 竞态和真实 Provider/Adapter 均未执行。Agent `toolRequest`
仍固定为 `null`，不能用授权记录代替外部成功证据。

`ENT-CS-006` 当前只形成 `AC-ENT-0027` 的 migration、Repository/runtime/API、严格 Adapter contract、
默认 unavailable 和 simulated mock 代码候选；测试已定义但按要求未运行，真实 PostgreSQL
up/down/forward、forced-RLS 双租户、并发 claim/reclaim、进程崩溃、Provider 超时和真实 ERP/物流/
库存链路均未执行，因此任务保持 `in_progress`，不能作为 A0/A2/H2/H3 或生产成功证据。

`ENT-CS-007` 当前只形成 `AC-ENT-0028` 的 `0032`、Repository/runtime/API、确认 turn 证据、AES-GCM
Outbox、Worker Publisher/finalize、严格 Adapter contract、默认 unavailable 和 tenant-bound simulated
mock 代码候选；测试已定义但按要求未运行，真实 PostgreSQL up/down/forward、forced-RLS 双租户、
并发/重复确认、崩溃窗口、key rotation、未知 Provider 结果及真实工单/CRM/回拨链路均未执行，因此
任务保持 `in_progress`，不能作为 A0/A2/H2/H3 或生产成功证据。

`ENT-CS-008` 当前只形成 `AC-ENT-0029` 的 `0033`、Repository/runtime、high-risk 分类、不可变 hash
证据、幂等请求、run/session 原子状态迁移和 TTS handoff fence 代码候选；测试已定义但按要求未运行，
真实 PostgreSQL up/down/forward、forced-RLS 双租户、并发同键/异键、直接 SQL 绕过、旧 TTS 竞态和
人工接通均未执行。任务保持 `in_progress`，不能作为 A0/A2/H2/H3、坐席可用或生产成功证据。

`ENT-CS-009` 当前只形成 `AC-ENT-0030` 的 `0034`、Repository/runtime/API、SLA/lease、独占 claim、
release/renew/reassign、角色守卫和脱敏审计代码候选；测试已定义但按要求未运行，真实 PostgreSQL
up/down/forward、forced-RLS 双租户、并发 claim、锁顺序、断线/lease 到期、崩溃窗口、重启恢复和真实
坐席媒体均未执行。任务保持 `in_progress`，不能作为 A0/A2/H2/H3、工作台可用或生产成功证据。

`ENT-CS-010` 当前只形成 `AC-ENT-0031` 的 workbench runtime/API、Agent run cancel fence、字幕/客户/知识/
风险/历史投影、lease heartbeat 和 Web 三栏代码候选；测试已定义但按要求未运行，真实 PostgreSQL/forced-RLS、
跨租户、双坐席、旧 Worker/TTS、300ms物理停播、真实 LiveKit、浏览器/axe/视觉和 CRM/Ticket Provider 均未
执行。任务保持 `in_progress`，不能作为坐席已接通、物理音频已停止或生产成功证据。

`ENT-OBS-001` 当前仅完成实现和 typecheck；按开发阶段指令尚未执行 migration up/down、Repository/API、
跨租户、legacy trace、Provider 失败和无样本矩阵，不能标记 `ready_for_acceptance`，也不能作为 H1/A4 证据。

`ENT-UI-008` 当前实现已覆盖审计筛选/详情、显式 session 下钻和 AC-ENT-0024 的受控导出代码路径；
本轮只允许静态检查，尚未执行 migration up/down/forward、Repository/API/Worker/object store、双租户 forced-RLS、
浏览器、键盘或无障碍矩阵。对象到期只阻断下载并写入存储过期元数据，物理删除/清单对账仍待 REL-002，
因此任务保持 `in_progress`，不能作为 A1/H2/H3 或生产放行证据。

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

`ENT-UI-009` 当前代码候选覆盖 system/light/dark 持久化主题、浅深色令牌、320/600/960/1280 收敛规则、
移动端可滚动带文字主导航、动态字号、路由焦点与跳至主内容、可聚焦横向数据区、表格 caption、图标按钮名称、
高对比和 forced-colors 基础规则。浅色风险小字使用对比度 5.94:1 的独立前景令牌；该数值只证明该令牌与白色
背景的静态计算，不代表完整页面已通过 WCAG AA。按本轮指令未执行浏览器截图/布局断言、200% 缩放、动态字体、
横屏、键盘路径、axe 或视觉回归，因此 AC-UI-008/009/010 尚未通过，任务保持 `in_progress`。

`ENT-UI-010` 当前代码候选定义 Chromium/Firefox/WebKit、九角色导航、直接 URL、320/600/960/1280/1440、
浅深主题、200% 动态字号、键盘 skip link、axe A/AA、截图回归和脱敏客户端事件用例。发布脚本强制固定 matrix、
JavaScript/CSS 预算、无 source map、无本地/内部地址、私钥、cloud key、fixture/debug code，且 release version/commit
必须嵌入 bundle、匹配 clean HEAD。错误上报 body 不接收 tenantId/message/stack/token，服务端以 membership、
`tenant:read` 和签名 route document 重建 tenant/region/cell/epoch 后写结构化日志。按本轮指令未运行 Vitest、API、
Playwright、axe 或视觉回归，也未生成/审批截图基线，因此 AC-UI-001..012 和正式 release gate 均未通过。

`ENT-UI-011` 当前 Flutter 代码候选把企业入口与个人主导航隔离，每次进入重新校验账号有效期、active membership、
所选 tenant、短期签名 route document、region/cell/epoch、`/enterprise/v1/me` scopes 和 Provider capability；401 会清理
会话与企业选择，离线或上下文不一致不显示缓存工作区。五入口使用 Material Icons；会议和接管分别按
`meeting:read`、`support:takeover` 发现。会议现读取 tenant-scoped API、换取短期 grant 并使用独立企业 LiveKit 音频
客户端，不复用个人同传或 Call Link；接管未实现时仍明确 `not_ready`。当前只通过 `flutter analyze`，未运行 Flutter test、构建、动态字体、横竖屏或真机矩阵，因此该候选不能
作为 AC-UI-001..006/008..011、A1 或移动端生产放行证据，任务保持 `in_progress`。

`ENT-UI-012` 当前 Web 代码候选把 `/join/:meetingId` 放在成员 `AuthProvider/AppShell` 外，不读取账号、membership、
tenant 导航或成员数据。guest token 只接受 URL fragment，query token、非法 meeting/token、地址栏清理失败均拒绝；
有效凭据清除地址后只驻留页面内存，不进入 storage、日志或 UI。访客点击后才以加密邀请换取短期 RTC grant，
客户端只开放麦克风发布和订阅，并明确禁止 data/camera/screenShare；字幕和共享保持 `not_ready`。当前仅有
typecheck/build/bundle 静态证据，未运行 token 攻击测试、浏览器、
权限、设备、axe 或视觉矩阵，不能满足 token 单会议约束、AC-UI-004/005/008..012、AC-MTG 或 A1。

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

`ENT-UI-007` 当前代码候选覆盖区域/route、Provider capability、billing account/subscription/entitlement、预算和
usage ledger 账期聚合。企业设置主入口以 tenant:read 发现，二级入口分别由 member/billing/usage scope 守卫；
无权直接 URL 在页面请求前停止，服务端 RBAC/route guard 仍是最终授权边界。homeRegion/cell 只读且不显示 route
signature；Provider 页面只展示 capability/status/reason/脱敏 fingerprint，不接收 Key、Secret、Webhook 或探测 URL；
订阅变更只提交精确 plan code/version、seats、cycle 和稳定幂等键，预算更新提交 expectedVersion，409 不覆盖服务端
版本；503 明确 not_ready 且不回退 SQLite/JSON。该自动化满足 AC-UI-002/003/004/005/006/007/011 的代码候选
条件。本地隔离 Chromium 1440×1000 和 390×844 检查仅证明两个布局样本，未覆盖完整 AC-UI-008/009/010；正式
接受仍需浏览器/键盘/axe 矩阵、真实 PostgreSQL staging、双租户攻击、真实 Provider/账务和 A1/H3 门禁。

`ENT-UI-004` 当前实现把 tenant/region、Provider capability、subscription、budget、usage aggregate 和按明确
session ID 查询的 trace report 投影到工作台。billing/usage/audit 数据只有具备对应 scope 才请求；预算告警只允许
category、unit、period 全部相同的预算和聚合比较，不跨单位合计；业务汇总接口、单位价格或质量样本缺失时分别显示
not_ready、not_configured 或 no_samples，不把不可用数据算作健康，也不生成示例趋势。本轮只执行 typecheck、生产
Web build、文件规模和 diff 静态门禁，按要求未执行 component/API/browser/PostgreSQL 测试，因此尚不能声称满足
AC-UI-003/004/005/006/008/009/010/011/012 或 AC-ENT-0017/0018/0019/0023，任务保持 `in_progress`。

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

`ENT-MTG-001/002` 当前代码候选新增 `0021/0022`、Meeting/Participant/Artifact 领域状态机、tenant-scoped Repository、
Primary runtime adapter、recoverable aggregate、创建/邀请/成员与访客入会 API、加密邀请和短期 LiveKit grant。
创建要求 tenant+key+hash 幂等并在单事务写 host/binding/audit/outbox；缺 route、policy、entitlement、密钥或 Provider
均失败闭合。当前未运行 up/down、forced RLS、九角色/跨租户、token 篡改与过期、CAS 竞争、四人 RTC、API/Worker
重启或 PostgreSQL 恢复测试，因此 AC-MTG-001..005 和 A1 均未通过。

### 7.2 字幕、翻译和说话人

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-MTG-006 | 四人独立音轨 | 每个 source participant/track 独立分段，姓名、原文和译文不串轨 |
| AC-MTG-007 | 个人字幕语言 | 中文选择只收到中文 final，英文选择只收到英文 final，切换后旧 playback generation 被拒绝 |
| AC-MTG-008 | 定向投递 | 服务端数据包只发往目标 LiveKit identity；客户端拒绝 participant 发送、错误 target/session/meeting/topic |
| AC-MTG-009 | Worker fencing | 过期 ticket、错误 cell、旧 route epoch/generation、失效 policy snapshot 均不能写入或投递 |
| AC-MTG-010 | 重放和恢复 | 同一事件重试只保留一条 tenant/meeting/target event；API/Worker 重启不重复字幕 |
| AC-MTG-011 | 译音降级 | 定向 TTS 未配置时明确 `not_ready`，不发布全局译音轨，不显示假成功 |
| AC-MTG-012 | Web/Flutter 消费 | Web 与 Flutter 只显示通过完整绑定校验的 final 字幕，最多保留有界窗口且 eventId 去重 |

- 两人无停顿轮流说话，字幕不跨人合并。
- 四人顺序和随机发言，标签不固定错误归到同一人。
- 中英夹杂不因语言切换产生硬断点。
- 30分钟会议 audio frame drop 为零或有明确网络诊断。
- final 字幕首屏 P95 不高于2.5秒；译文在 final 后 P95 不高于1.5秒。
- TTS 顺序与 turn 一致，抢话只取消目标腿当前播放。

`ENT-MTG-003` 当前已形成 `0023`、tenant-aware Worker snapshot/heartbeat/refresh/events/finalize API、
每 participant track 独立 Speech Pipeline、append-only target event、LiveKit server-only destination identity
投递，以及 Web/Flutter 个人语言选择和可信字幕消费代码候选。按本轮要求未运行任何测试，也未执行 migration、
forced-RLS、跨租户/ticket 攻击、事件重放、四人真实媒体、浏览器或真机矩阵；真实 ASR/翻译/LiveKit Provider
也未配置，定向 TTS 保持 `not_ready`。因此 AC-MTG-006..012 和 A1 均未通过，任务保持 `in_progress`。

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
| AC-SHARE-011 | Android MediaProjection | Android 13/14/15 授权、前台通知、系统/通知停止、后台与返回状态一致 |

共享启动 P95 不高于3秒；主持人 stop P95 不高于500ms。默认数据库和对象目录中不得出现屏幕帧。

`ENT-MTG-004` 当前已有 `0024`、tenant-scoped lease/command Repository、acquire/pause/resume/renew/stop API、
expected-version CAS、代际最小权限 grant、cell pending-work 到期回收及 LiveKit 撤销 outbox 代码候选。按本轮
“测试先略过”要求，尚未运行 migration up/down、forced-RLS/跨租户、双 acquire、幂等重放、暂停窗口、Worker 崩溃恢复、
Provider 未配置/超时/404、真实 LiveKit track 撤销或浏览器/真机矩阵；AC-SHARE-001..011 和 A1 均未通过，任务保持
`in_progress`。特别是静态 typecheck 不能证明500ms停止、客户端消失后回收或旧 generation 无法恢复。

`ENT-MTG-005` 当前已形成成员 Web `getDisplayMedia`、真实 display surface 映射、独立屏幕 publisher Room、首次
track SID 绑定与周期续租、当前 generation identity 过滤、视频布局和开始/暂停/恢复/停止代码候选。静态 typecheck、
生产 Web build 和非 release bundle 检查只能证明可编译和体积边界；按要求未运行 unit/API/Playwright，也未验证
Chrome/Edge/Safari/Firefox 的 screen/window/tab 权限、用户拒绝、浏览器原生停止、暂停恢复、网络重连、旧 identity
迟到、两人竞争或真实 LiveKit 首帧/撤销。因此 AC-SHARE-001/003/005/006/007/009/010 仍未通过，不能进入 A1 放行。

`ENT-MTG-006` 当前已形成 iOS Broadcast Upload Extension、App Group entitlement、无令牌租约清单、Flutter bridge、
独立最小权限 publisher Room、25秒系统确认超时、10秒续租和系统停止回收代码候选。静态 analyze、plist/PBX 解析、
build setting 检查与扩展 Swift typecheck 不替代真机：必须在目标 iPhone 上验证系统广播选择器、离开 App/锁屏持续、
返回状态一致、系统控制中心停止、来电/音频中断、Wi-Fi/蜂窝切换、后台续租、扩展被杀、清单过期、旧 generation/nonce、
真实 LiveKit 首帧和服务端撤销。当前未构建或安装 App，也未运行上述矩阵，因此 AC-SHARE-002/006/009/010 和 A1 均未通过。

`ENT-MTG-007` 当前已形成 Android 一次性 MediaProjection 授权、Android 13+ 通知权限、Android 14
`mediaProjection` 前台服务、独立最小权限 publisher Room、token-free Service 控制、25秒激活超时、10秒续租，
以及系统投屏/通知/租约停止汇合代码候选。恢复验收时必须在 Android 13/14/15 目标机验证：两类权限接受/拒绝/取消、
通知持续可见和停止动作、系统状态栏/隐私控制停止、前后台/锁屏/Activity 重建/进程回收、Service 被杀、租约过期、
旧 generation/nonce、Wi-Fi/蜂窝切换、真实 LiveKit 首帧与服务端撤销。还必须固定验证 `flutter_webrtc 1.4.0` 系统停止
监听可建立；监听结构不匹配时应停止并显示失败，而不是继续显示共享中。本轮未运行测试、APK 构建或真机矩阵，因此
AC-SHARE-006/009/010/011 和 A1 均未通过。

`ENT-MTG-008` 当前只形成 Web 独立系统音频发布/观看和 Enterprise Meeting Agent 双重输入守卫代码候选。恢复验收时
至少覆盖 Chrome/Edge/Safari/Firefox 的标签页/窗口/整屏音频能力差异、用户未勾选音频、请求后浏览器无音轨、系统音频
entitlement 拒绝、grant capability 不一致、video/audio 部分发布失败、音频单独结束、暂停恢复、自动播放拒绝和旧
generation 音轨。真实 LiveKit 房间中必须证明共享者本机没有捕获音轨回放，远端可以手动/自动播放，扬声器和耳机下均
不形成回声环；Worker 证据必须证明 `ent-share:*`/`SCREEN_SHARE_AUDIO` 没有 ASR segment、caption 或 speaker 记录，
成员 microphone 仍正常处理。iOS/Android 应保持无入口和 `includesSystemAudio=false`，直到各自真实采集链路另行验收。
本轮按要求未运行上述测试，因此 AC-SHARE-008 和 A1 均未通过。

`ENT-MTG-009` 当前只形成 Web/Flutter 显式 simulcast/dynacast、renderer 尺寸驱动订阅和三种布局代码候选。恢复验收
必须从 LiveKit server/client stats 证明 smooth/auto/high 的主层和附加层真实发布、无订阅层被 dynacast 关闭、远端
元素/Widget 缩放或不可见会改变订阅需求，弱网下降层时麦克风、系统音频和字幕不断流；Firefox/不支持环境应明确单层
而不是报告多层。布局矩阵至少覆盖320/390/600/760/840/960/1280px、手机横屏低高度、Web 200%缩放和Flutter
1.0/1.5/2.0动态字体，三种模式均不得遮挡共享停止、麦克风、离会或字幕。当前未运行上述浏览器/真机/真实媒体测试，
因此 AC-SHARE-006/007/009 和 A1 均未通过。

`ENT-MTG-010` 当前形成独立 force-stop API、`screen_share:stop` 服务端 guard、活动参会者复核、stop CAS/generation
fence、force-stop 审计/状态 outbox、LiveKit 即时撤销与持久撤销 outbox，以及 Web/Flutter scope 受控确认操作代码候选。
恢复验收时必须执行 owner/admin/meeting_host/member/auditor/guest × 自己/他人 share × 同租户/跨租户/跨 meeting
矩阵；验证缺 scope、已离会、伪造 participant/tenant、错误 expected version、相同 key/hash 重放、同 key 不同 hash、
普通 stop 与 force-stop 竞争、旧 renew/resume 迟到均失败闭合。真实 LiveKit 中需记录 API commit 到旧 publisher 消失
的 P95，证明目标500ms、Provider 404/超时/失败的 completed/pending 语义、outbox 恢复，以及旧 generation track 永不
重新渲染。还需覆盖 Web/Flutter 确认、重复点击、pending、离线和动态权限回收。本轮按要求未运行这些测试，
因此 AC-SHARE-004 和 A1 均未通过，`ENT-MTG-010` 保持 `in_progress`。

### 7.4 屏幕 OCR 翻译

- PPT、网页、表格和深色页面识别。
- 相同帧不重复调用 OCR/翻译。
- 译文位置与原文区域对应，缩放和横屏保持对齐。
- OCR 服务关闭时共享继续，只提示内容翻译不可用。
- 未授权时 OCR Worker 不订阅屏幕轨道。

`ENT-MTG-012` 当前代码候选新增 `0026` 五张 forced-RLS 表、短期绑定 ticket、`SUBSCRIBE_NONE` 精确轨道订阅、服务端
pHash claim/usage ledger、显式 HTTPS Provider 和 Web/Flutter 定向布局消费。正式验收必须覆盖：默认关闭；相同/近似帧
100次只产生一次 Provider/usage；两名订阅者同语言共享 run、切换语言结束无订阅旧 run；关闭/离会/租约过期/route epoch
变化后 Worker 下一帧失败；伪造 tenant/meeting/share/generation/publisher/track/participant/ticket/event/revision 全部拒绝；
PPT/网页/表格/深色主题及320/390/600/960/1280、横屏、200%和动态字体坐标对齐；Provider off/超时/429/畸形布局、
LiveKit data publish 失败和 Worker 崩溃时原共享与字幕不断流且 API polling 可恢复。还需证明数据库、对象存储、日志和错误
响应均无原始帧，readiness fingerprint 来自真实 health probe。当前按要求只运行静态门禁，未运行上述自动化、migration、
Provider、LiveKit、浏览器或真机矩阵，因此本节和 A1/H3 未通过，任务保持 `in_progress`。

### 7.5 会后材料

- 逐字稿、译文、说话人和时间轴一致。
- 摘要、决定、待办和风险均引用 segment ID。
- 未说出的截止时间和负责人不得由 LLM 补写。
- 当前会议姓名修改不自动污染企业全局身份。
- 导出权限、审计和删除期限正确。

`ENT-MTG-011` 当前实现新增 `0025` 材料 run、规范化 segment、逐项 evidence、当前会议 speaker label、action item
CAS、artifact/audit/outbox，以及 Web/Flutter 服务端材料消费。验收还必须覆盖 target fan-out 去重、最新 revision、同键重放、
不同 hash、跨租户/跨会议 ID、空/伪造 evidence、未配置/超时/畸形 Provider、owner/due hallucination、发布竞争、保存到期和
meeting ended 后迟到 Worker 事件拒绝。本轮按要求未运行这些门禁，因此 `ENT-MTG-011` 保持 `in_progress`，A1/H3 未通过。

### 7.6 日历 Adapter

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-MTG-013 | 主持人同步 | 只有 future scheduled meeting host + `meeting:write` 可提交；成员、审计员、跨租户和伪造 tenant 全部拒绝 |
| AC-MTG-014 | 幂等与未知结果 | 同请求、并发请求、POST 响应丢失和409重试始终只存在一个 Google event；不同 private meeting/sync 标记判为 collision |
| AC-MTG-015 | 事务收敛 | sync/outbox/audit 同事务创建，Provider receipt/outbox finalize/audit 同事务完成；崩溃恢复不出现假成功或重复副作用 |
| AC-MTG-016 | 配置与密文 | readiness、tenant binding、service account、public URL、keyring 任一缺失均失败闭合；数据库和日志无标题/链接明文 outbox、凭据或 guest token |
| AC-MTG-017 | 真实客户端 | Web/Flutter 的预约、pending、synced、failed、403/409/503、窄屏/大字体和图标语义均通过；访客邀请保持独立 |

当前只形成 migration、Repository/runtime/API、Google/mock Adapter、加密 outbox、Worker 和 Web/Flutter 代码候选，
contract test 已定义但按要求未运行。真实 PostgreSQL forced-RLS/崩溃恢复、Google Workspace domain-wide delegation、
浏览器和真机证据均缺失，因此 AC-MTG-013..017 未通过，`ENT-MTG-013` 保持 `in_progress`。

## 8. A2 AI 客服验收

### 8.0 领域底座门禁

| 编号 | 场景 | 通过标准 |
| --- | --- | --- |
| AC-CS-001 | forced-RLS | channel/customer/queue/session/case/tool 跨租户读写与伪造 tenant 均被拒绝 |
| AC-CS-002 | 幂等创建 | 同 key/hash 重放返回同一 session/binding，不同 hash 冲突且不留半条记录 |
| AC-CS-003 | 状态 CAS | session/case/tool 非法迁移、版本竞争、身份改写、删除和终态回退均失败 |
| AC-CS-004 | 原子绑定 | support session 与公共 communication session/binding 同事务成功或回滚 |
| AC-CS-005 | 重启恢复 | API/Worker 重启后仅恢复非终态会话，关联资源一致，缺 binding 明确未就绪 |
| AC-CS-006 | tenant dispatch | ticket 篡改、过期、旧 route epoch、跨 tenant/channel/type 均被拒绝 |
| AC-CS-007 | 入站重放 | 同 source/event/hash 只创建一个 session，不同 hash 冲突且原记录不变 |
| AC-CS-008 | Provider 降级 | PSTN inbound 未配置/未 ready、签名未通过或内部 ticket 未配置时创建数为零 |
| AC-CS-009 | 三渠道一致性 | PSTN/Web/App 均进入 tenant-scoped communication session 与唯一 support binding |

`ENT-CS-001` 当前只有 migration、领域模型、Repository/runtime 和未执行的状态矩阵代码候选。按本轮要求
未运行自动化、真实 PostgreSQL migration/forced-RLS、并发 CAS 或重启恢复，因此 AC-CS-001..005
均未通过，任务保持 `in_progress`。

`ENT-CS-002` 的共享契约、ticket、内部路由和事务代码已形成，但未运行 ticket/route/inbox/并发测试，也未接
真实 PSTN edge、Web Gateway 或 App Gateway，因此 AC-CS-006..009 同样未通过。

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

`ENT-CS-003` 已形成会话状态 guard、tenant-scoped 检索、逐条 citation evidence、无证据转人工指令和脱敏引用
审计代码候选。按本轮要求未运行自动化、真实 PostgreSQL forced-RLS、双租户诱导、未来/过期/冲突版本、审计完整性、
召回质量或 Agent 答案测试，因此 AC-CS-RAG-001..005 均未通过，任务保持 `in_progress`。

### 8.3 工具调用

- 查询订单使用当前客户授权身份，不能修改客户 ID 查询他人订单。
- 创建工单前复述关键信息并取得确认。
- 相同请求重试只生成一个外部工单。
- Adapter 超时不对客户说“已经完成”。
- 退款、付款、身份验证和合同修改必须请求人工。

恢复测试后，`ENT-CS-007` 按 `AC-ENT-0028` 执行三组矩阵：确认矩阵覆盖确认/拒绝/含糊/过期/
挑战前 turn/其他 run-session-tenant；事务矩阵覆盖确认写入与 Outbox 原子性、密文/AAD 篡改、双请求
CAS、Worker 在外部调用前后崩溃；Provider 矩阵覆盖超时、连接断开后的未知结果、相同幂等键重放、
fingerprint/key rotation、非法 receipt、确定失败和真实 ticket/callback/note sandbox。每个场景同时核对
外部效果数、execution attempt/status、Outbox published/available、审计脱敏和数据库明文扫描。

`ENT-CS-008` 按 `AC-ENT-0029` 执行四组矩阵：风险矩阵覆盖 refund/payment/identity/contract/未知
high-risk 及伪造 scope/confirmation；绑定矩阵覆盖跨 tenant/run/session/customer、失活 definition、旧
generation/route 和 session 已接管；幂等/事务矩阵覆盖同键同证据重放、同键异参数/revision 冲突、
两个首次请求竞争及 run/session 任一 CAS 失败整体回滚；不可执行矩阵覆盖 tool execution/Outbox 数为0、
直接 SQL insert/update/delete、数据库明文扫描、接管后普通 TTS 拒绝和 handoff 话术许可。每项同时核对
handoff request 数量/hash、会话/run 状态和脱敏审计。

`ENT-CS-009` 按 `AC-ENT-0030` 执行五组矩阵：角色矩阵覆盖 owner/admin/support_manager/support_agent
和其他五类角色的 create/list/claim/renew/release/reassign；租户矩阵覆盖跨 tenant queue/session/claim/member
ID 与 body tenant/agent 伪造；并发矩阵覆盖两个坐席同 session、同键同/异 hash、不同键、lease 到期重领和
旧 version；事务矩阵覆盖 claim insert 后 session CAS 失败、release/reassign 中途崩溃、重启恢复、锁顺序和
终态 claim 改写/删除；SLA 矩阵覆盖临界秒、priority 平手、稳定 ID 排序、paused/disabled queue 和时钟边界。
每项同时核对 active claim 数、session assigned/claim/status、审计、跨租户不可见性和旧坐席副作用为零。

`ENT-CS-010` 按 `AC-ENT-0031` 执行六组矩阵：访问矩阵覆盖 assigned agent、三类 manager、其他角色、
跨 tenant 和过期/终态 claim；事务矩阵覆盖 claim/session/run cancel/audit 任一步失败回滚、旧 claim activate、
active/handoff_requested/ending/terminal/no-run；Worker矩阵覆盖旧 ticket/generation 在 prepare/authorize/deliver
与迟到 turn 的副作用为0；投影矩阵覆盖 transcript 多 revision、200段边界、客户/case/tool/risk 字段最小化和
跨租户 ID；lease矩阵覆盖 now+lease、乱序 GET/renew、409、断网和释放；UI/媒体矩阵覆盖1440/1250/850/600/
320、浅深色、键盘/axe、无字幕/无知识/Provider未配置，以及真实 LiveKit 已播音频300ms interrupt且不恢复。
每项同时核对 fence/run/claim/session version、审计、Provider副作用、浏览器可操作性和禁用原因。

`ENT-CS-011` 按 `AC-ENT-0032` 执行六组矩阵：访问/绑定矩阵覆盖 assigned support_agent、三类 manager、
其他角色、跨 tenant、过期/终态 claim、body tenant/customer/agent 伪造和 session/claim 旧 version；幂等/事务
矩阵覆盖同键同/异请求、两个并发首次请求，以及 case/callback/command/outbox/audit 任一步失败整体回滚且无
孤儿记录；readiness 矩阵覆盖 keyring 缺失、Adapter unavailable、idempotencyGuaranteed=false、fingerprint
变化与 simulated 明示；Worker 矩阵覆盖调用前/未知结果后崩溃、超时、连接断开、非法密文/AAD/receipt、同键
重领和指数退避；投影矩阵覆盖 ticket/callback result kind、scheduledAt、reference/hash、确定失败和迟到结果；
UI/生命周期矩阵覆盖 disabled reason、过去时间、processing/failed/completed、浅深色/键盘/响应式，以及提交后
立即 release/end session 仍可由 Worker 完成。每项同时核对外部有效效果数、两张新增表、case、Outbox attempt/
published、审计无主题/说明/原因明文和数据库 tenant 隔离。

当前仅有实现与静态门禁候选，未执行上述自动化、真实 PostgreSQL、Provider sandbox、浏览器或故障注入；
因此 `AC-ENT-0032` 未通过，`ENT-CS-011` 保持 `in_progress`。

`ENT-CS-012` 按 `AC-ENT-0033` 执行六组矩阵：权限矩阵覆盖 owner/admin/support_manager/auditor、
support_agent 和其他角色的规则列表、发布、Dashboard、分析与详情，并攻击 body tenant/actor/scope、跨 tenant
session/rule/review ID 和失效 route；schema 矩阵覆盖 `0036` up/down/forward、三表 forced RLS、复合 FK、
publisher/analyzer insert guard、UPDATE/DELETE、非法 code/severity/count/semantic status 和非终态直接 SQL；
规则矩阵覆盖 locale 精确/`*` 优先级、短语上下限/NFKC/重复、同键同/异 hash、两个并发首次发布；分析矩阵
覆盖 ended/failed 与非终态 session、completed/failed/cancelled 与 active run、无输出、source hash 任一字段变化、
同证据重放和并发分析；发现矩阵为未告知、无引用、风险未转人工、禁用承诺、未送达分别提供阳性/阴性 fixture，
核对 evidence hash、severity、总数分解和审计；Dashboard/UI 矩阵覆盖每会话最新复核、空租户、100条边界、
320/600/960/1280/1440、浅深色、键盘/axe、403/409/503，并核对语义状态始终 not_configured、错误回答率 null。

语义准确性需另用去标识人工金标集验证模型 fingerprint、语言/国家/问题类型分层 precision/recall、误报/漏报和
人工复核一致性；当前没有该 Adapter、模型或金标，不执行也不声明语义错误回答定位能力。当前仅有实现与静态
门禁候选，未执行自动化、真实 PostgreSQL/RLS、浏览器或语义质量矩阵，因此 `AC-ENT-0033` 未通过，
`ENT-CS-012` 保持 `in_progress`。

### 8.4 人工接管

- 客户主动说“转人工”后立即进入 handoff_requested。
- AI TTS 在300ms目标内停止，旧音频不恢复。
- 两个坐席同时 claim 只能一个成功。
- 坐席看到客户问题、知识引用、工具结果和风险。
- 坐席退出或断网后会话可重新分配，不形成双控制者。
- high-risk 请求只证明 `handoff_requested` 已持久化；`ENT-CS-009/010` 目前也只有未运行的 queue/claim/
  workbench 代码候选。在 AC-ENT-0030/0031 与真实坐席媒体证据完成前，界面和话术不得显示“坐席已接通”、
  “300ms内已停播”或“退款/付款/身份验证已处理”。

### 8.5 客服结果

- 会话结束生成摘要、诉求、处理结果和待办。
- 工单/CRM 不可用时 outbox 重试并只同步一次。
- 指标可以按租户、渠道、语言、问题和知识版本过滤。

## 9. A3 出海外呼营销验收

`ENT-MKT-001` 当前只形成 `AC-ENT-0034` 的契约、`0037`、Repository/runtime/API、聚合状态守卫和 Web
代码候选。恢复测试后执行六组矩阵：角色矩阵覆盖 owner/admin/marketing_manager/marketing_member/auditor/
其他角色；租户矩阵覆盖两个 tenant、伪造 body tenant、跨租户 ID 与失效 route；幂等/CAS 矩阵分别覆盖创建、
草稿更新和 schedule 的同键同/异 payload、响应丢失重试、旧 expectedVersion 和并发草稿更新；schema 矩阵覆盖 up/down/forward、forced RLS、owner FK、
不可删除与非法状态边；调度矩阵逐项移除 approval/status/policy/startAt 并验证业务 task、Outbox、usage hold、
Provider 调用均为0；UI 矩阵覆盖读写/审批入口、空/403/409/503、320/600/960/1280、浅深色和键盘。

本轮未运行上述自动化、真实 PostgreSQL/RLS 或浏览器矩阵；`ENT-MKT-001` 本身也不以 `ENT-MKT-002` 的 Lead
实现替代 Consent/Suppression、Country Policy、Approval snapshot、Scheduler 或 PSTN。因此 `AC-ENT-0034` 未通过，`ENT-MKT-001` 保持 `in_progress`，不能进入
A3 白名单外呼或企业生产门禁。

`ENT-MKT-002` 按 `AC-ENT-0035` 增加七组矩阵：格式矩阵覆盖 CSV 引号/换行/BOM/宽度/大小、API 行数与未知字段；
号码矩阵覆盖国家有效性、E.164、国家不匹配、同号码不同排版和租户隔离；身份矩阵覆盖批内/跨批 phone/externalId
组合及同活动 duplicate；幂等/原子矩阵覆盖同键同/异 hash、响应丢失、任一行错误、两个并发首次导入；schema
矩阵覆盖 `0038` up/down/forward、三表 forced RLS、复合 FK、唯一索引、append-only 和非法状态/version；回滚矩阵
覆盖 expectedVersion、同键重放、跨租户/跨活动、其他 active link、consent/task 保留；保护矩阵核对 AES-GCM AAD、
HMAC tenant boundary、API/审计/日志/错误无明文、缺 keyring/legacy driver 503；Web 矩阵覆盖角色、空/错误/冲突/
not-ready、320/600/960/1280、浅深色、键盘、表格聚焦和不显示授权/PSTN 成功。

本轮只形成代码与静态门禁候选，未运行上述自动化、真实 PostgreSQL/forced-RLS、浏览器、并发或密钥恢复演练；
因此 `AC-ENT-0035` 未通过，`ENT-MKT-002` 保持 `in_progress`。

`ENT-MKT-003` 按 `AC-ENT-0036` 增加八组矩阵：角色/租户矩阵覆盖 owner/admin/marketing/auditor、伪造 body
tenant、跨 Campaign/Lead/Consent 和失效 route；对象矩阵覆盖缺配置、S3/KMS/本地开发边界、not found、tenant/object
metadata、hash、size、content type、加密和25MiB上限；用途/时间矩阵覆盖非自动营销用途、未来、无期限、过期与已撤回；
幂等矩阵覆盖登记/撤回同键同/异 hash、响应丢失、重复 object 和旧 expectedVersion；schema 矩阵覆盖 `0039`
up/down/forward、forced RLS、复合 FK、不可删除/不可改写和 actor/version guard；执行矩阵直接尝试无授权、未来、过期、
撤回和跨活动 task insert/reschedule 并断言为0；撤回矩阵覆盖有/无替代授权、并发撤回和 pending/scheduled/retry 取消；
Web 矩阵覆盖只读/写入、真实状态、320/600/960/1280、浅深色、键盘和不显示 PSTN 成功。

本轮只形成代码与静态门禁候选，未运行上述自动化、真实 PostgreSQL/forced-RLS、真实 S3/KMS、浏览器、并发或
法务证据抽样；因此 `AC-ENT-0036` 未通过，`ENT-MKT-003` 保持 `in_progress`。禁拨依赖由
`ENT-MKT-004` 独立验收，不能反向补算本门禁。

`ENT-MKT-004` 按 `AC-ENT-0037` 增加八组矩阵：角色/租户矩阵覆盖 owner/admin/marketing/auditor、伪造 body tenant、
跨 Campaign/Lead 和失效 route；scope/source 矩阵覆盖公开 tenant、system global、未知 scope/source、联系人拒绝、
授权撤回、投诉和人工录入；号码保护矩阵核对只从当前 Lead 读取 tenant HMAC、API/审计/日志不出现明文；幂等矩阵
覆盖同键同/异 hash、响应丢失和已有号码；schema 矩阵覆盖 `0040` up/down/forward、forced RLS、复合 FK、唯一索引、
不可更新删除和 system actor guard；竞态矩阵覆盖 task insert 与 suppression insert 两种提交顺序及多个并发创建；取消
矩阵覆盖同号码跨活动 pending/scheduled/retry 全取消、其他号码和终态不变；Web/降级矩阵覆盖只读/写入、真实取消数、
global registry ready/not_configured/degraded、320/600/960/1280、浅深色和键盘。

本轮只形成代码与静态门禁候选，未运行上述自动化、真实 PostgreSQL/forced-RLS、并发、全局名单 Provider 或浏览器
验收；因此 `AC-ENT-0037` 未通过，`ENT-MKT-004` 保持 `in_progress`。

`ENT-MKT-005` 按 `AC-ENT-0038` 增加九组矩阵：角色/租户矩阵覆盖 owner/admin/marketing manager/member/auditor、
body tenant、跨 tenant ID 和失效 route；格式矩阵覆盖国家/版本、未知字段、数值边界、跨午夜、窗口重叠和最大28项；
留言/告知矩阵覆盖三段必填、disabled/human-only 夹带内容、compliant message 缺版本/正文；幂等/版本矩阵覆盖同键
同/异 hash、响应丢失、重复版本、相邻/重叠有效期；schema 矩阵覆盖 `0041` up/down/forward、forced RLS、复合 FK、
不可更新删除、actor/tenant/JSON trigger；Campaign 矩阵覆盖单/多国家 missing/future/active/expired 和 scheduled DB
直写；时区矩阵覆盖 IANA、半小时偏移、DST 跳变、空/非法时区和当地窗口边界；频控竞态矩阵覆盖跨活动、同一时刻、
取消任务、最小间隔、窗口边界及多个并发 insert/reschedule；Web 矩阵覆盖读/发权限、真实错误、320/600/960/1280、
浅深色、键盘、法务边界提示和不显示审批/PSTN 成功。

本轮只形成代码、测试定义和静态门禁候选；真实 PostgreSQL migration/forced-RLS、DST/并发、浏览器、目标法域
与企业法务签核抽样均未执行。因此 `AC-ENT-0038` 未通过，`ENT-MKT-005` 保持 `in_progress`；Scheduler/PSTN 仍由
`ENT-MKT-007/008` 负责。

`ENT-MKT-006` 按 `AC-ENT-0039` 增加九组矩阵：角色/租户矩阵覆盖 read/write/approve、body tenant、跨 Campaign/
snapshot/decision 与失效 route；校验矩阵覆盖无 startAt、过去时间、空 Lead、国家不匹配、IANA/半小时时区与全部
Country Policy 状态；数据矩阵覆盖 committed/rolled-back batch、active/inactive Lead/link、多个 Consent 选择、过期/
撤回和 tenant/global Suppression；幂等/CAS 矩阵覆盖 validate/approve/reject 同键同/异 hash、响应丢失和旧 version；
schema 矩阵覆盖 `0042/0043` up/down/forward、forced RLS、复合 FK、insert-only、actor/time/source version 和直接 SQL
跳状态；快照竞态矩阵覆盖 approval 与 Consent revoke/Suppression insert/Lead rollback 两种提交顺序；过期矩阵覆盖
批准后集合变化导致 schedule/task 为0；task 矩阵覆盖伪造 approval ID、非冻结 Lead/Consent/Policy 和跨租户；Web
矩阵覆盖按需读取、成员提交/主管决策、真实 issues/hash、拒绝编辑、320/600/960/1280、主题、键盘和不显示 PSTN 成功。

本轮只形成代码、测试定义和静态门禁候选；自动化、真实 PostgreSQL migration/forced-RLS、双租户、并发竞态、
浏览器与企业法务审批抽样均未执行。因此 `AC-ENT-0039` 未通过，`ENT-MKT-006` 保持 `in_progress`；
`ENT-MKT-007..009` 才负责 Scheduler、Outbox 与 PSTN。

`ENT-MKT-007` 按 `AC-ENT-0040` 增加十组矩阵：schedule 原子性覆盖完整/空/部分窗口解析和命令重放；确定性身份覆盖
tenant/campaign/approval/lead/attempt 与 generation hash；due 矩阵覆盖 IANA/DST、早到/迟到、Policy 有效期、
Consent 过期/撤回、tenant/global Suppression、Lead/link/Campaign 状态和 stale approval；内部入口覆盖密钥、签名
route、home region/cell/epoch 与跨租户伪造；claim 矩阵以50 Scheduler 验证 `SKIP LOCKED` + CAS 单领取；容量矩阵覆盖
Campaign 与 `worker.voice_agent_runtime.concurrent` tenant 上限及跨 tenant 隔离；预算矩阵覆盖未配置/暂停/耗尽、
固定60秒 hold 与失败全回滚；恢复矩阵覆盖 claim 后崩溃、lease 到期、hold expired、generation 递增和 retry；竞态矩阵
覆盖 claim 与 Consent revoke/Suppression insert 两种提交顺序；Web 矩阵覆盖按需只读、真实计数/预算/并发、
320/600/960/1280、主题、键盘和无 PSTN 成功文案。

本轮只形成代码、测试定义和静态门禁候选；未运行自动化、真实 PostgreSQL migration/forced-RLS、50并发、跨 tenant
cell 隔离、崩溃恢复或浏览器。因此 `AC-ENT-0040` 未通过，`ENT-MKT-007` 保持 `in_progress`；Provider adapter、
communication session、Outbox、PSTN dispatch/webhook 与实际扣费由 `ENT-MKT-008` 继续实现。

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
- Tool Registry 分别注入伪造 tenant/customer/session/scope/risk/confirmation、未知/超限/嵌套 schema 字段、
  未注册/draft/retired revision、同幂等键异参数、过期或跨 cell ticket、旧 route/generation 和高风险自动执行；
  任一输入不得生成可执行副作用，审计不得包含原始工具参数。
- Support Agent 分别注入额外 `thinking/reasoning/analysis`、伪 citation、无 citation answer、非 null tool、
  风险未 handoff、超长/超12轮上下文和同幂等键异载荷；任何一项都必须在 TTS 前拒绝且日志无 prompt/query/content。
- 在 Provider 未配置、HTTP 失败、超时、非法 JSON 和知识 prepare/complete 之间换版时验证显式 degraded/handoff；
  无 evidence 请求计数必须为0，不能调用 LLM 生成企业事实。
- 在生成完成、TTS authorize 前、authorize 后未 playout、正在 playout 和心跳间隙分别执行 cancel/takeover/policy revoke/
  generation 递增；旧 Worker 必须 interrupt、clear buffer、禁止 delivered，重启后不得恢复旧 TTS。
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
- 验收 commit 锁定的公共31段 manifest（基线从 `fe1c3c2` 演进）与 enterprise 44段 migration manifest 在隔离企业数据库从空库完整执行；两个 manifest 的顺序、checksum、schema verify 和 down/forward 策略均有证据，不能只跑其中一套。
- 每个进程只有一个 Storage Driver 和 startup verdict；HTTP、企业 Repository、统一通讯会话和 cell Worker 使用同一 verified Primary Runtime，不存在 fallback、shadow read、dual write 或按路由混用。
- 应用 tenant、user directory、cell discovery、migration、maintenance 分别使用最小权限角色；生产 TLS 使用 `verify-full`。应用角色没有 `BYPASSRLS`、表 owner、DDL 或关闭 RLS 权限。
- 公共 communication session、participant、media leg、dispatch、Provider operation、playback 和相关账本全部具有 tenant scope、复合 FK 和 `FORCE ROW LEVEL SECURITY`；使用跨租户 ID、缺 scope、伪造 owner/user 过滤做负向验证。
- 使用普通应用角色验证 `communication_session_bindings` 的三类互斥业务 FK、同 tenant 公共 session 复合 FK、route/policy/entitlement 快照不可变、唯一绑定和跨租户不可见；按 Meeting/Support/Marketing 分别执行精确重放、参数漂移、旧 route/generation、重复序号、非法倒退和终态恢复矩阵。
- 使用普通应用角色验证 communication policy/version/snapshot forced RLS、不可变 trigger、授权撤回即 invalidated、dispatch grant 的 policy FK；按有效、缺失、过期、错 fingerprint、错 purpose、跨租户和撤回后迟到副作用执行负向矩阵。
- 使用普通应用角色验证 billing account/plan/subscription/entitlement/change history forced RLS、活动 subscription 唯一、plan/snapshot/change 不可变，以及 entitlement projection/binding/grant 的 tenant 复合 FK；按跨租户、停用 account、过期账期、错 subscription/plan/version、席位超限、幂等漂移和客户端 limit 伪造执行负向矩阵。
- accounts、tenant、communication session、segment、campaign、support、meeting、ledger 和 object hash 数量与规范化 SHA-256 一致。
- 全量复制后记录增量水位，切换时获取 writer fence、清退旧 API/Worker、重放剩余 inbox/outbox，再做第二次 count/hash；切换或对账失败可按书面决策回滚，旧 writer 不能继续写入。
- staging startup 必须拒绝 local evidence、签名篡改、错误 cutover/target ID、错误 commit/image/topology、错误 system identifier/OID、缺 baseline 引用、未清退 writer 或任一31+44 migration 漂移。维护工具只验证 fence，不自动执行 promote 或隔离旧主。
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
| OBS-001 | AC-ENT-0023、A1 tenant/RBAC、H1 链路与成本追踪 | trace、segment、Provider、usage/ledger、audit 或定价模型变更后 | A1 代码候选；长稳、真实 Provider 和定价/财务证据完成后进入 A4 |
| REL-001..008 | H1/H2/H3 和最终发布门禁 | 每个正式候选版本 | A4 |

### 16.1 执行节奏

1. 开发任务进入 `ready_for_acceptance` 时创建对应 acceptance run，冻结 commit、构建和环境。
2. QA 执行自动化和人工场景；Backend/RTC 提供 trace、Provider、ledger 和数据库证据；Web/Flutter 提供页面、浏览器和真机证据。
3. 失败项创建缺陷并关联 acceptance ID；修复后先复跑失败项，再按上表复跑受影响组。
4. 所有证据由独立 reviewer 复核后，任务才能标记 `accepted`。
5. 外部账号或法律确认缺失时，只允许保持 `blocked` 或缩小发布范围，不能以 mock 通过替代真实门禁。
