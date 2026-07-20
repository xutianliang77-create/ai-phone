# 无界AI企业版详细功能设计

版本：v1.47
日期：2026-07-20
状态：SaaS 详细设计基线，已对齐统一通讯平台

## 1. 产品定位

无界AI企业版（工程名 AI Phone Enterprise）面向有跨语言获客、客户服务和多人协作需求的企业。产品由企业 Web 控制台、员工移动 App、Web 参会页和电话媒体入口组成，并统一运行在无界AI Communication Session 平台上。

产品采用多租户 SaaS：企业注册、选择区域和套餐后即可使用，由 AI Phone 统一提供服务器、模型、实时媒体、升级、监控和备份。当前版本不向客户交付服务器安装包或私有化模型运行环境。

企业版复用无界AI的 LiveKit、实时翻译、Speech Runtime、Voice Agent Runtime、
Provider Adapter、可靠事件和会话历史能力，并新增：

- 出海 AI 外呼营销。
- AI 客服。
- 企业会议、屏幕共享和企业级会后材料。

### 1.1 产品目标

- 让企业在一个租户内完成跨语言会议、客服和受控外呼，不重复建设实时媒体、翻译、知识和审计底座。
- 让会议、客服、外呼和人工接管统一引用一个权威 `communicationSessionId`，避免房间、
  电话、Agent、计费和审计各自形成不一致的会话真值。
- 让管理员看清“当前能否安全执行”：功能入口、Provider readiness、套餐权益、合规策略和预算使用同一服务端真值。
- 让每一次 AI 回答、工具执行、拨号、接管和材料发布都可回溯到操作者、策略版本、知识版本和证据。

### 1.2 非目标

- 不替代通用 CRM、工单、日历、OA 或财务系统，只通过 Adapter 交换必要业务对象。
- 不让 LLM 直接成为业务状态真值或高风险动作执行者。
- 当前版本不提供客户自建服务器、客户自管模型或绕过平台升级的私有化分支。
- 不承诺“配置一个 Provider 即生产可用”；正式试点还必须通过 PostgreSQL、域名、TLS、备份、限流、审计和真实链路验收。
- 不把无界AI个人版的 `userId`、可选 `ownerId`、个人套餐或个人声纹直接解释为企业
  `tenantId`、企业账单或企业生物特征授权。
- 不把主产品的隔离 staging、同机复制或单项压力测试当作企业版生产验收。

## 2. 用户和角色

| 角色 | 主要权限 |
| --- | --- |
| 企业所有者 | 企业设置、套餐、全部数据和管理员授权 |
| 企业管理员 | 成员、知识、渠道、策略、活动和审计管理 |
| 营销主管 | 创建、审批、暂停活动，查看营销结果 |
| 营销人员 | 管理授权线索、查看结果、跟进和人工接管 |
| 客服主管 | 队列、坐席、知识、质检和服务策略 |
| 客服坐席 | 接管会话、处理工单和填写结果 |
| 会议主持人 | 创建会议、成员权限、共享控制和材料发布 |
| 普通成员 | 加入会议、查看自己有权访问的记录和待办 |
| 审计员 | 只读查看授权、策略、操作和导出记录 |

## 3. 企业 Web 信息架构

一级导航固定为：

1. 工作台。
2. 外呼营销。
3. AI 客服。
4. 企业会议。
5. 客户与线索。
6. 知识与术语。
7. 数据分析。
8. 合规与审计。
9. 企业设置。

移动 App 重点承载会议、告警、实时通话和人工接管；批量活动、知识维护和分析主要在 Web 控制台完成。

### 3.1 页面级设计

| 页面 | 主要使用者 | 核心内容 | 主要操作 | 权限 scope |
| --- | --- | --- | --- | --- |
| 工作台 | 全部成员 | readiness、待办、用量、告警、最近会话 | 进入待处理对象、查看降级原因 | `tenant:read` |
| 外呼活动 | 管理员、营销团队 | 活动状态、授权覆盖、国家策略、预算、漏斗 | 创建、校验、审批、启动、暂停、取消 | `campaign:read`、`campaign:write`、`campaign:approve` |
| 客户与线索 | 营销团队、客服主管 | 客户档案、线索、授权、禁拨和历史会话 | 导入、去重、撤回、跟进 | 业务资源 scope + 数据范围 |
| 客服队列 | 客服主管、坐席 | 等待队列、SLA、实时会话和接管状态 | claim、接管、转组、结束 | `support:read`、`support:manage`、`support:takeover` |
| 企业会议 | 主持人、成员 | 日程、参会者、字幕语言、共享和材料 | 创建、入会、共享控制、发布材料 | `meeting:read`、`meeting:write`、`screen_share:stop` |
| 知识与术语 | 管理员、业务主管 | source、版本、解析状态、生效范围和引用 | 上传、审核、发布、停用 | `knowledge:read`、`knowledge:publish` |
| 数据分析 | 主管、审计员 | 质量、成本、漏斗、SLA 和失败分类 | 筛选、下钻、导出 | 对应只读 scope |
| 合规与审计 | 管理员、审计员 | 策略版本、授权证据、操作事件、导出记录 | 查询、复核、受控导出 | `audit:read`、`audit:export` |
| 企业设置 | owner、admin | 成员、角色、套餐、区域、渠道和保存期限 | 邀请、停用、配置、申请迁移 | `tenant:read`、`tenant:write`、`member:read`、`member:write` |

页面只按服务端返回的 scopes 隐藏或禁用入口，不得把前端可见性当作授权。直接调用 API、伪造 scope 或重放旧页面请求仍必须由服务端拒绝。

### 3.2 客户端分工

| 能力 | Web 控制台 | Flutter App | Web 参会页 |
| --- | --- | --- | --- |
| 租户/成员/知识/活动批量配置 | 主入口 | 只读或轻操作 | 不提供 |
| 会议创建与主持 | 完整 | 完整 | 受 token 限制 |
| 屏幕共享 | screen/window/tab | ReplayKit/MediaProjection | screen/window/tab |
| 客服接管 | 完整坐席台 | 告警与应急接管 | 不提供 |
| 实时字幕与译音 | 支持 | 支持 | 支持 |
| 审计与大批量导出 | 主入口 | 仅查看结果 | 不提供 |

当前 `ENT-UI-008` 的审计页已实现事件筛选、详情和受控 JSONL 导出；导出必须声明目的、时间范围和保留期，
并以异步 job 显示 processing/completed/failed/expired。数据分析页当前只允许按明确 session ID 下钻真实质量、
Provider、usage/ledger 和 trace；跨会话业务聚合与货币成本尚未实现时保持 not_ready/not_configured，
不能用示例指标或客户端估价替代。

### 3.3 通用页面状态

所有企业页面统一处理以下状态，禁止用空白页或假成功代替：

- `loading`：显示骨架或局部进度，不阻塞无关导航。
- `empty`：说明为什么为空，并只向有权限者显示创建入口。
- `not_ready`：显示缺失的 Provider、策略、套餐或基础设施门禁，以及可执行的修复动作。
- `degraded`：保留可用能力，明确标记已关闭的模型、译音、OCR 或外部同步。
- `forbidden`：不泄露目标资源是否存在，提供返回入口。
- `conflict`：版本冲突后刷新服务端状态，不能覆盖他人修改。
- `processing`：异步导入、发布、导出和删除显示 job 状态，可离开页面后继续。
- `failed`：显示可行动的错误类别和 trace ID；重试写操作复用原 idempotency key。

## 4. SaaS 租户生命周期

### 4.1 开通

1. 企业管理员注册账号并验证企业邮箱。
2. 创建企业租户，选择数据区域、默认语言和时区。
3. 选择试用或正式套餐，确认服务条款和数据处理协议。
4. 邀请成员并分配角色。
5. 配置知识、电话渠道、会议策略和预算。
6. readiness 检查通过后开放对应功能。

租户的 `homeRegion` 创建后不能由普通管理员直接修改；同区域跨 Cell 或跨区域迁移必须通过受控迁移任务完成。

首批 `ENT-DATA-005` 只开放给平台运维的维护命令，不新增租户管理员自助迁移 API。迁移固定经历
`export -> object receipt -> cutover -> reconcile`：先停止源 Cell API/Worker 和活动会话/租约，证明源库只读、
旧 writer 会话为零及目标可写，再复制当前 tenant 的全部 enterprise 记录和公共 tenant communication scope。
数据库中出现任何无 tenant selector 的 enterprise 业务表、目标已有该 tenant、对象引用无匹配复制回执、
逐表 count/hash 不一致或 route epoch 未精确递增一次时均不得切换路由。

回滚不是简单把旧路由指回陈旧副本。当前目标 Cell 必须先进入相同停写窗口，再把最新 tenant 数据反向全量
覆盖旧 Cell、递增 route epoch 并重新对账；不可变 ledger、audit、consent 和业务证据不得在应用路径被改写。
签名 evidence 绑定 tenant、源/目标 Cell、数据库身份、commit、image 和 topology。控制面路由发布、真实对象
复制和跨 Cell 演练未完成前，企业设置仍只显示只读 region/cell，不显示“迁移成功”。

### 4.2 套餐和权益

- 套餐按席位和用量组合，不通过 App 端按钮判断权益。
- 权益包括成员数、会议并发、屏幕共享、客服并发、外呼国家、PSTN 分钟、模型档位、保存期限和 API 限额。
- 所有服务端命令在执行前读取 entitlement snapshot。
- 超额时按租户策略阻断新任务、允许只读访问或进入按量计费，不能静默超额。
- 套餐变更保留生效时间和操作者审计。

### 4.3 暂停和注销

- 欠费或管理员暂停后停止新外呼和新客服任务，进行中的通话按安全策略结束。
- 会议和历史数据按套餐进入只读或保留期状态。
- 注销前提供导出、删除范围和预计完成时间。
- 注销使用 tombstone 和对象删除 outbox，完成后生成可审计结果。

### 4.4 SaaS 服务管理

- 企业状态页显示区域、服务健康、用量、事件和维护窗口。
- Provider 故障由平台切换或降级，客户不配置模型地址。
- 高级套餐可使用平台托管的专属容量或专属 SaaS cell，但仍由 AI Phone 运维，不属于私有化部署。

## 5. 出海 AI 外呼营销

### 5.1 活动创建

创建向导依次收集：

1. 活动名称、目标和负责人。
2. 目标国家、时区、语言和产品。
3. 线索来源和授权证明。
4. AI 角色、声音、知识库和话术。
5. 拨打窗口、并发、重试和人工接管策略。
6. 合规预检和主管审批。

未完成授权证明、国家策略或审批的活动不能开始。

#### 5.1.1 Campaign 聚合首批实现边界

- 新活动只能由服务端以当前登录成员作为负责人创建为 `draft/not_submitted`；客户端提交的 tenant、owner、
  status、approval 或 policy version 不成为真值。同一幂等键同内容返回原活动，异内容返回冲突。
- `campaign:read` 只读取当前 tenant 的活动列表和详情；`campaign:write` 只允许以 expectedVersion 修改尚未
  提交的草稿字段，不允许强制覆盖或修改聚合身份。创建、草稿更新和待调度命令均要求幂等键；同一 actor、
  route 和键只精确重放同一 request hash，响应丢失时客户端必须复用原键。
- “进入待调度”只改变 Campaign 聚合状态，不生成 call task、usage hold、Outbox 或 PSTN 请求。该命令要求
  `campaign:approve`，并同时复核活动为 `approved`、审批为 `approved`、策略版本存在、开始时间为未来。
- 当前 Web 页面提供上述真实聚合、线索导入和授权证据能力，并明确标出禁拨、国家策略、审批流、Scheduler 和
  PSTN 尚未接入；不得把不可用按钮或静态活动卡片解释为活动已经启动。

### 5.2 线索管理

- 支持 CSV、CRM Adapter 和 API 导入。
- 号码统一转换为 E.164，并保留原始输入。
- 按企业、号码和活动去重。
- 每条线索保存来源、授权用途、授权渠道、授权时间、失效时间和证据引用。
- 授权用途必须覆盖自动营销电话；普通邮件或人工电话授权不能自动推导。
- 合并企业禁拨名单、国家禁拨结果和活动排除名单。
- 联系人撤回后立即停止所有待执行任务，并生成审计事件。

#### 5.2.1 线索导入首批实现边界

- 当前实现支持单次最多500行的 CSV 或 API JSON；CSV 要求 `phone,countryCode`，可带
  `externalId,timezone,language` 和 `attr.*`。服务端按国家解析有效号码并生成规范 E.164，任一行格式、国家、
  时区、语言、属性或身份冲突都会返回逐行错误，整批不创建 Lead、Campaign 关联或导入批次。
- 号码原始输入和规范 E.164 分别用 AES-256-GCM 密文保存，tenant + E.164 仅生成 HMAC-SHA-256 去重值；
  Web、公开 API 和审计只返回末四位提示。号码保护密钥未配置、Repository 非 PostgreSQL 或 tenant route
  失效时失败闭合，不回退 SQLite/JSON。
- Lead 在 tenant 内按号码 hash 唯一，`externalId` 与号码必须保持一一一致；同一号码重复导入到同一活动记为
  `duplicate`，已有 tenant Lead 首次关联活动记为 `linked`，新 Lead 记为 `created`。幂等键同一规范内容精确
  重放，异内容冲突。
- 已提交批次可在活动仍为 `draft/not_submitted` 时按 expectedVersion 回滚；回滚只停用该批次创建的活动关联，
  不删除 Lead 或逐行证据。没有其他活动关联、授权或通话任务的 Lead 才转为 inactive。
- 导入不生成授权证据、禁拨记录、Country Policy、审批快照、call task、Outbox、usage hold 或 PSTN 请求。
  CRM Adapter 导入仍属于后续集成，不得把 `sourceReference` 当作 CRM 同步成功。

#### 5.2.2 授权证据首批实现边界

- 授权必须精确绑定当前 tenant、Campaign、active Lead 和 `automated_marketing_call` 用途；取得渠道仅允许 Web
  表单、签署文件、录音通话或 CRM 证明。邮件、人工电话或其他用途不能推导为自动营销电话授权。
- 数据库只保存证据对象 UUID、SHA-256、字节数、内容类型、来源、声明版本、取得/失效时间和 actor。登记前由
  受信对象存储 Adapter 读取实体并核对 tenant/object metadata、内容 hash、大小、类型和服务端加密；不接受公开 URL。
  生产环境禁止本地目录，未配置或任一字段不一致时失败闭合。
- 只允许在 `draft/not_submitted` 活动为 active Campaign Lead 新增证据；登记和撤回均要求幂等键。证据身份、用途、
  内容摘要、时间和创建信息不可改写或删除，只允许按 expectedVersion 一次性写入撤回 actor、原因和时间。
- 列表保留 pending/active/expired/revoked 全历史；“当前有效”只由服务端时间计算，要求已经取得、未过期、未撤回且
  Lead/活动关联仍 active。客户端时间、状态徽标或对象 UUID 不参与授权决定。
- `marketing_call_tasks` 在 insert 或变更 Campaign/Lead/计划时间时由数据库再次要求覆盖计划时间的有效授权；缺失、
  尚未生效、过期、撤回或跨活动证据都不能形成可执行任务。撤回保留证据历史，并取消没有其他有效授权覆盖的
  pending/scheduled/retry 任务；已交给 PSTN 的物理中止仍属于后续 Scheduler/Provider 验收。
- 当前 Web 线索表可进入授权详情，显示脱敏号码、服务端有效性、对象引用、缩略 hash、不可变历史和撤回影响；
  不上传任意 URL、不显示电话号码明文，也不把授权登记解释为禁拨/国家策略/审批/PSTN 已通过。

#### 5.2.3 禁拨名单首批实现边界

- 联系人拒绝再次联系、撤回自动营销电话授权、投诉处理或合规人员人工录入，都会形成 tenant scope 的不可变禁拨
  记录；号码不从请求体接收，只从当前 tenant 的 active Campaign Lead 读取 HMAC 身份和脱敏提示。
- tenant scope 对当前企业全部 Campaign 生效。global scope 是受信平台禁拨注册表按 tenant HMAC 生成的隐私投影，
  只允许 namespaced system actor 写入；普通成员、客户端 scope 或直接跨租户 ID 不能伪造全局命中。
- 首次写入在同一事务取消相同号码跨活动的 pending/scheduled/retry task，保留终态任务和禁拨原因、来源、actor、
  时间、取消数量。禁拨记录不可更新或删除；已有同 scope 号码不会重复创建。
- task 新建或改变 Campaign/Lead/计划时间时，数据库先按 tenant + phone HMAC 取得同一事务锁，再复核 tenant/global
  禁拨；并发中无论 task 还是禁拨先提交，最终都不能留下可执行待任务。
- 公开 API 要求 `campaign:write`、active membership、签名 route 和幂等键；读取要求 `campaign:read`。请求 tenant
  只做一致性核对，legacy/SQLite/JSON 明确失败闭合。
- 当前全局禁拨注册表 Provider 未配置，企业名单未命中时只返回 `not_ready`，不能显示“可拨”。Web 在授权详情中
  展示真实 tenant/global 历史、全局 readiness 和服务端取消数量；Country Policy、Scheduler、PSTN dispatch 与已在
  Provider 侧执行的物理挂断仍属于后续任务。

#### 5.2.4 国家策略首批实现边界

- 国家策略是 tenant-owned 的不可变发布版本。每个版本固定一个 ISO 国家、当地星期/分钟窗口、滚动频控、最小
  重试间隔、品牌/AI 身份/营销目的三段告知、语音信箱模式、合规确认依据和明确生效/失效时间；同国家生效区间
  不得重叠。
- 发布要求 `campaign:approve`、active membership、签名 route 和幂等键。普通营销成员和审计员只能读取；body
  tenant、跨租户 ID、同键异内容、重复版本、重叠有效期、跨午夜或重叠时间窗口全部拒绝。
- `disabled` 和 `human_only` 语音信箱模式不能夹带留言内容；只有 `compliant_message` 固化版本与短消息。这里仅保存
  企业合规负责人确认的配置，不根据法规链接自动生成法律结论，也不代表目标国家/州/号码类型已通过法务放行。
- Campaign readiness 按计划开始时间逐个解析目标国家。缺失、尚未生效或已过期均为 blocked；进入 scheduled 时
  数据库再次要求全部国家有覆盖目标时间的版本。具体审批时冻结 policy set/data snapshot 属于 `ENT-MKT-006`。
- 新建或重排 `marketing_call_tasks` 必须显式引用具体国家策略版本。数据库按 Lead 的国家和 IANA 时区换算当地时间，
  在与禁拨相同的 tenant+phone 事务锁内复核有效期、窗口、跨活动滚动频控和最小重试间隔；缺时区、非法时区、
  窗口外、过密或超频都不能留下可执行任务。
- 当前 Web 只显示真实策略版本、hash、有效期、合规依据和逐活动 readiness；不显示审批、Scheduler、PSTN 或法务
  验收成功。SQLite/JSON 不承载国家策略并固定失败闭合。

#### 5.2.5 活动审批首批实现边界

- `campaign:write` 可对 `draft/not_submitted|rejected` 活动执行 validate。服务端以 startAt 固化 Campaign 内容、目标
  Country Policy set、active Lead/link/committed batch、每条 Lead 的有效 Consent 和当前 Suppression set；没有未来
  开始时间、没有有效 Lead、任一国家缺策略、Lead 国家不匹配、IANA 时区无效、缺授权或命中禁拨均保持 blocked。
- ready validation 是不可变记录，只把活动经 `validating` 提交到 `pending_approval/pending`；blocked validation 不改
  Campaign。校验与禁拨写入使用同一 tenant+phone 事务锁，Lead/link/batch/Consent 使用数据库共享锁，避免并发空窗。
- `campaign:approve` 才能 approve/reject。批准前重建完整快照并要求 snapshot hash 与所引用 ready validation 完全一致；
  拒绝必须给出理由并回到 `draft/rejected`，后续编辑会重置为 `not_submitted`。两类 decision 均不可更新删除。
- 批准后 Campaign 固定 approval decision ID 和 validation snapshot hash。scheduled transition 及未来 call task 再由
  SQL 比对当前策略、Lead、Consent、Suppression；撤回、禁拨、新旧集合替换或伪造 ID 时任务数为零。
- Web 只展示目标时间、数量、缩略 hash、服务端 issue 和决策历史；“批准”不等于具体法域法律意见，也不表示
  Scheduler、usage hold、Outbox 或 PSTN 已执行。legacy/SQLite/JSON 固定返回 PostgreSQL required。

#### 5.2.6 Scheduler 首批实现边界

- 活动 schedule 成功不再只改变聚合：服务端在同一 PostgreSQL 事务内按批准快照为每条冻结 Lead 生成一个确定性
  attempt-1 task。每条 task 固定审批、国家策略、当地执行时间、生成 hash 与 actor；任一目标无法解析当地窗口时活动和
  task 全部不变。
- 内部 Scheduler 只领取已经到期且当前仍满足审批、active Lead/link、Consent、Suppression、Country Policy 和被叫
  当地窗口的 task。每次领取必须同时获得活动/租户并发配额和60秒营销用量 hold，并绑定当前租户 route epoch、claim
  owner、token hash、lease 和 generation。
- Scheduler 崩溃只会让未派发 claim 在 lease 到期后释放 hold 并回到 retry。授权撤回或新增禁拨会同步取消未派发
  claim；已经交给 Provider 的物理停止由 `ENT-MKT-008` 负责。
- Web 调度器面板只读展示真实 task 数量、下个计划时间、活动/租户并发和预算状态。它不提供“开始拨号”，也不把 claim
  显示为已接通或已完成。

#### 5.2.7 PSTN dispatch 首批实现边界

- 内部 dispatch 入口只接受 Scheduler 的 tenant、task、claim token、dispatch generation 和签名 route document。
  服务端在拨号前重新验证当前 region/cell/route epoch、审批、Lead/link、Consent、Suppression、Country Policy、
  被叫当地时间窗、活动 entitlement 和尚有至少15秒的 claim lease；客户端不能提交号码或 Provider。
- prepare transaction 创建 tenant-scoped communication session/binding、无明文号码的 Outbox 和不可变 dispatch。
  Provider 请求使用 tenant+task+generation 稳定幂等键；号码只在事务提交后由 keyring 解密到 Provider 请求内存，
  不写 Outbox、审计或 Web 响应。
- Provider 调用位于数据库事务外，最多等待10秒。首次明确接受后 finalize transaction 才把 task 标为 dispatched、
  结算固定60秒 `marketing_call_seconds` hold 并推进 binding；同 dispatch 重放只返回既有结果，不再次拨号或扣费。
- 超时、连接中断或可重试 HTTP 错误按 `unknown/reconciliation_required` 保留，lease reaper 不产生下一代盲目重拨。
  明确拒绝释放 hold，task 在原 lease 到期后由 Scheduler 恢复。后续 Provider 状态以签名 webhook event ID 去重，并
  重读 route/generation/call fence 后推进 answered/completed/failed，不重复结算。
- Provider、HTTPS Bridge、Bridge token、webhook secret、号码 keyring 或 Provider 持久幂等保证任一缺失时只显示
  `not_ready`。Web 面板只读展示 dispatch 数量、Provider readiness 和60秒结算规则，不提供模拟拨号按钮或成功文案。
- 当前仅形成代码和静态门禁候选；真实 PSTN sandbox、PostgreSQL forced-RLS、丢响应对账、并发和浏览器未验收，
  不能宣称企业外呼已可生产使用。

### 5.3 AI 营销专员

- 配置品牌、身份、产品、价值主张和目标市场。
- 配置开场告知、资格问题、产品说明、异议处理和结束语。
- 支持自动语种识别和同一通话内语言切换。
- 支持普通话、英语和已上线目标市场语言的声音预设。
- 可执行目标限于记录意向、预约、发送资料、创建回访和转人工。
- 不得自主承诺价格、付款、退款、合同、医疗、法律或金融结论。
- 知识不足时必须说明无法确认，不得使用 LLM 自由补写事实。

#### 5.3.1 Marketing Agent 首批实现边界

- 每个 Campaign 按国家和 locale 配置独立 profile，固化品牌、AI 身份、营销目的、产品、价值主张、声音、资格问题、
  退订词、转人工词和结束语。profile 只允许在 `draft/not_submitted` 修改；活动批准后不能换话术或声音。
- 开场告知必须同时逐字包含品牌、AI 身份和营销目的。PSTN prepare 只有在目标 profile、当前有效 published Term Pack、
  published Script Template、LLM Provider 和签名 Agent runtime 全部 ready 时才创建 dispatch；缺任一项固定 `not_ready`。
- PSTN prepare 在同一事务创建不可变 Agent run，并把短期签名 ticket、HTTPS runtime URL 和 run ID 交给 Bridge。
  ticket 固定 tenant、dispatch、task、communication session、dispatch generation 和 route epoch；每次 disclosure、turn、
  TTS 授权、交付和 finalize 都重读这些 fence。
- disclosure 必须先授权、确认已播放，之后才能进入资格问题。每个 qualification turn 只能使用配置中的下一条原问题；
  answer/objection 必须引用本轮 tenant-scoped published knowledge，缺证据或 Provider 失败时明确无法确认并结束。
- 服务端只接受严格结构输出，拒绝额外 thinking/tool 字段、越界 citation、跳过资格问题、未交付 disclosure、以及价格、
  付款、退款、合同、医疗、法律或金融保证。文本只有在再次通过 TTS authorize 后才可播放，播放完成才推进状态。
- 退订意图由服务端确定性识别，在同一 tenant transaction 写入不可变 suppression 并返回结束话术；不依赖 LLM 是否遵循。
  转人工先写 `handoff_requested` 并停止 AI；`ENT-MKT-011` 再把已冻结策略物化为 Support Queue 桥接，
  当前 Provider 未配置或无300ms停播/坐席加入保证时仍如实说明不可完成媒体转接。
- 同一通话只允许切换到 Campaign 已配置且能解析同一 product/country/purpose 的 published 内容版本；不允许临时翻译或
  自由生成另一语言事实。Web 复用既有 Material Icons 与 Campaign 卡片，只展示真实 profile/readiness，不模拟通话成功。
- 当前为代码和静态门禁候选；未运行 migration、forced-RLS、真实 PostgreSQL/LLM/PSTN、浏览器或通话验收，不能宣称
  Marketing Agent 已通过企业生产门禁。

### 5.4 拨号策略

- 按被叫当地时间和国家策略生成可拨窗口。
- 设置活动级和租户级并发、频率、重试次数及间隔。
- 区分未接、忙线、无效号码、语音信箱、拒绝和接通。
- 被叫表达拒绝联系时立即停止、挂断并写入企业禁拨名单。
- 语音信箱策略由国家策略决定，可关闭、仅留合规短消息或转人工。
- AI 接通后先完成品牌、AI 身份和营销目的告知，再进入业务话术。

美国和英国等市场对自动营销电话、AI/预录语音、禁拨和授权有严格要求；系统必须按国家策略执行，而不是依赖运营人员自行判断。参考：[FCC AI 语音裁定](https://docs.fcc.gov/public/attachments/DOC-400393A1.pdf)、[FTC Telemarketing Sales Rule](https://www.ftc.gov/legal-library/browse/rules/telemarketing-sales-rule)、[ICO 自动营销电话指引](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/plan-direct-marketing/)。

上述链接只作为 Policy Engine 设计输入，不构成面向具体国家、州、号码类型和用途的法律结论。每个上线国家必须由合规负责人确认规则文本、适用范围、生效时间和证据要求，并以不可变 `policyVersion` 发布；版本过期时阻断新任务。

### 5.5 实时监控和人工接管

- 活动看板显示待拨、振铃、通话、等待接管、完成和失败。
- 主管可查看实时双语字幕、当前意图、情绪和风险提示。
- 客户要求人工、连续两次无法回答、投诉或敏感行为时请求接管。
- 接管成功后 AI 停止发言，保留字幕、翻译和答案建议。
- 接管超时按策略结束或预约人工回拨，不能让 AI 越权继续。

#### 5.5.1 实时监控首批实现边界

- 活动监控只读取服务端 tenant-scoped PSTN dispatch、call task、Marketing Agent run/turn、公共最终修订字幕和
  Provider operation，不从浏览器本地缓存、fixture 或推测状态补齐数据。
- Campaign 汇总固定显示全部、活跃、需要关注和失败数量；单通话显示脱敏号码 hint、dispatch/task/Agent 状态、
  disclosure 是否交付、当前意图、风险信号、失败码、Provider 接受/接听延迟和状态新鲜度。
- 客户文本只从公共 `transcript_segments` 的当前最大 revision 读取；Agent turn 继续只保存客户文本 hash，监控页不会
  反向恢复原始输入。字幕无样本时显示“无样本”，不生成示例对话。
- 当前传输明确为5秒服务端快照，只有面板展开时刷新；API 返回 `streamStatus=not_configured`，页面固定显示“非流式”。
  Realtime Gateway/可靠订阅尚未接入，不能把轮询快照宣称为实时流成功。
- `ENT-MKT-010` 监控面板仍没有拨号、静音、挂断或接管命令；接管从 `ENT-MKT-011` 的 Campaign 策略和
  Support 坐席工作台进入，不在监控读投影上新建命令真值。Outcome/后续动作仍属于 `ENT-MKT-012`。
- 当前只形成 PostgreSQL 读投影、API 和 Web 静态代码候选；未运行 PostgreSQL/RLS、双租户、真实通话、浏览器、负载或
  Realtime Gateway 验收，不能宣称实时监控通过企业生产门禁。

#### 5.5.2 真实人工接管首批实现边界

- 运营人员在活动未提交草稿中绑定当前租户的 active Support Queue、PSTN Support Channel、
  10..86400秒等待时间和超时结束/需回拨策略。设置进入活动审批 snapshot/hash，批准后不可暗改。
- handoff 话术完成播放后，Marketing run 保持 `handoff_requested` AI 数据库停播 fence，并在同一 tenant
  事务中创建绑定原 dispatch/call/Lead 的 Support Customer/Session 桥接。任一写入失败整体回滚。
- 桥接会话直接进入现有 Support Queue，坐席仍通过 `support_agent_claims` 互斥领取、续租、释放和改派；
  `marketing_handoffs` 不保存 claim ID，不制造第二套坐席归属真值。
- 坐席打开工作台时，服务端先复核 active claim、`human_active` session 和 AI fence，再使用稳定幂等键调用
  事务外 HTTPS Provider。页面把“领取成功”、“AI 数据库已停播”和“媒体已接管”分层展示。
- 媒体只有在300ms内收到 AI 音频已停止且坐席已加入的完整 Provider receipt 才能显示 active。缺配置、
  非 HTTPS、无 Provider 幂等保证、无坐席加入保证、超时或回执不完整都明确 `not_ready/failed`。
- 超时且未领取的桥接会话由 cell Worker 收敛为 `timed_out` 或 `callback_required`。后者只是需要后续
  回拨的不可变证据，不是回拨已排程/已接通；未有 Provider receipt 不声称已挂断。
- 当前只形成 PostgreSQL/API/Adapter/Web 静态代码候选；未执行真实 migration/RLS、PSTN/坐席媒体、300ms、
  浏览器或容量验收，不构成企业生产门禁通过结论。

### 5.6 结果和分析

- 结果分类：无意向、潜在线索、预约请求、需回访、拒绝联系、无效号码和通话失败；预约请求不等于预约成功。
- 自动生成摘要、需求、异议、意向等级、承诺和下一步。
- 预约、回访和资料发送必须形成可追踪任务。
- 支持结果推送 CRM Adapter，并保存外部对象 ID。
- 指标包括接通率、有效对话率、预约率、接管率、退订率、投诉率和单有效线索成本。

#### 5.6.1 Outcome 首批实现边界

- Outcome 只能绑定同租户、同 Campaign、已终态的 call task/PSTN dispatch，以及已结束的 Agent run；
  `accepted`、`answered`、claim 成功、handoff 请求或 callback_required 均不能单独当作业务成功。
- 同一 task 只允许固化一个 Outcome，创建后不可修改或删除。重复幂等键返回原结果，不同请求或并发重复创建均拒绝，
  避免同一通话反复生成结果和后续任务。
- 运营人员只选择当前最终 revision 字幕或已交付 Agent turn；Repository 再补充终态 dispatch/run、handoff、suppression
  等服务端证据，并固化 evidence/source hash。Outcome 和普通审计不复制客户原文。
- `no_interest/potential_lead/appointment_requested` 必须有客户字幕证据；拒绝联系必须已有 suppression；无效号码必须有
  allowlist Provider 失败码；通话失败必须有真实 dispatch/run 失败证据。服务端同时校验意向等级和结果分类不矛盾。
- 预约仅固化为 `appointment_requested` 和内部 `appointment_request/requested`，不表示日历已预约；回拨、资料发送和
  人工复核同样只创建一个内部 requested action，不表示外部动作已执行。
- CRM/日历/消息 Provider 同步、可靠 Outbox 和外部对象 receipt 属于 `ENT-MKT-013`；未配置时当前页面固定显示
  “外部已执行 0”，不得生成模拟成功。
- 当前只形成 `0048`、PostgreSQL Repository/runtime/API 和同风格 Web 静态代码候选；未运行 migration/RLS、双租户、
  真实通话、浏览器或 Provider 验收，不能宣称 Outcome 通过企业生产门禁。

#### 5.6.2 CRM Adapter 首批实现边界

- 首个 Provider 为 Salesforce。运营人员可对已固化 Outcome 发起一次 CRM 同步；API 只返回“已入队”，页面在
  Provider GET 对账回执到达前显示“等待 Provider 回执”，不得显示已同步。
- 服务端为 tenant + Outcome 生成稳定 External ID，同一个 Outbox 事件在超时、429、5xx、401 token 更新或进程重启后
  仍使用同一 ID upsert；外部恢复后只收敛到一个 Salesforce 记录。
- Salesforce 管理员必须配置专用集成用户、OAuth Client Credentials、API 版本、自定义对象、External ID 字段和载荷
  字段。凭据只在 Worker 服务器读取；浏览器、DTO、审计和 Outbox 明文均不包含 secret 或 Outcome 摘要。
- CRM sync 聚合只保存 payload hash、Provider/config fingerprint、外部 ID/URL、尝试次数、错误码和 receipt hash；
  disposition/intent/summary/next action 仅存在于 AES-256-GCM 加密 Outbox payload 与目标 CRM 记录。
- 缺租户绑定、OAuth、字段映射或 payload keyring 时明确 not_ready；CRM 故障不回滚 Outcome、通话终态、结算或
  MKT-012 requested action。Provider 明确拒绝可形成终态 failed，未知结果继续重试而不声称失败或成功。
- 当前仅形成 `0049`、Repository/runtime/API/Worker/Salesforce Adapter、mock/contract 测试定义和同风格 Web 静态候选；
  未运行 migration/RLS、双租户、真实 Salesforce sandbox、故障注入或浏览器验收，不能宣称 CRM 已通过生产门禁。

#### 5.6.3 活动分析首批实现边界

- 运营人员在单个 Campaign 卡片展开“活动分析”，读取同一 PostgreSQL 一致性快照；页面不从浏览器缓存、轮询结果或
  fixture 重建指标。当前活动本身就是“按活动”维度，并同时展示国家和冻结执行版本拆分。
- 漏斗固定为有效线索、已物化任务、Provider 接受、真实接听、verified Outcome；比率只使用相邻阶段，分母为0时返回
  `null`，不显示100%、0%或估算值。正向兴趣只含 `potential_lead/appointment_requested`，不等于成交。
- 投诉只统计 `suppression_entries.source=complaint` 且 `origin_campaign_id` 明确绑定本活动的不可变记录；执行版本拆分只
  统计 `source_reference` 与 communication session 精确相等的投诉，不能从退订、风险词或低意向推断投诉。
- 用量从 immutable usage event、settle ledger 和 adjustment 计算结算量、调整量、净量与事件数。没有价格表时货币金额
  必须保持空值并显示 `pricing_not_configured`，不得把秒数、token 或 hold 额度冒充成本。
- CRM 只统计 `synced` 且已经 GET 对账的 receipt；pending、failed、HTTP 202、PATCH accepted 和内部 requested action
  都不进入外部成功数。当前只形成 API/Repository/Web/测试定义的静态候选，未完成真实 PostgreSQL/RLS、浏览器或容量验收。

## 6. AI 客服

### 6.1 渠道

- PSTN 呼入电话。
- 企业 Call Link 和网页语音入口。
- App 内语音客服。
- 后续通过 Channel Adapter 接入国际社交和消息渠道。

同一客户跨渠道会话归并到统一客户档案，但只有已授权数据可以进入新会话上下文。

### 6.2 呼入流程

1. 接入渠道并创建客服会话。
2. 告知 AI 身份、录音和数据使用规则。
3. 自动识别语言和客户意图。
4. 查询知识库或调用受控业务工具。
5. 回答、执行低风险操作或请求人工接管。
6. 结束后生成摘要、工单和待办。

#### 6.2.1 会话领域真值与恢复

- 渠道、客户、队列、客服会话、工单和工具执行均为 tenant-scoped 资源；业务 ID 不能脱离
  `tenantId` 被读取或关联。
- 同一会话创建命令由 `idempotencyKey + requestHash` 判定重放或冲突，并在一个数据库事务内
  创建 `support_session`、公共 `communication_session` 和唯一 support binding。任何一步失败均不保留
  半条会话或伪造 Provider 成功。
- 会话以 `created -> waiting -> ai_active -> handoff_requested -> human_active` 为主路径；
  handoff 无坐席时可回到 AI，进行中会话可结束或失败，终态不可改写。
- API/Worker 重启只从 PostgreSQL 读取非终态会话，并一起恢复渠道、客户、队列、工单、工具执行和
  communication binding。binding 缺失必须显式暴露为未就绪，不得临时生成进程内真值。

#### 6.2.2 三渠道统一入站

- PSTN、Web 和 App Adapter 共用一个入站事件契约：稳定 `sourceEventId`、渠道、发生时间、优先级和
  hash 化客户键；禁止提交原始电话号码或用请求 body 的 `tenantId` 作为授权真值。
- 可信 ingress 先以内部凭据换取短期 dispatch ticket。ticket 固定 tenant、channel、channel type、region、
  cell 和 route epoch；过期、篡改、跨渠道或旧路由请求均拒绝。
- PSTN 每次授权都读取实时 capability 且必须具有 inbound 能力；Web/App first-party 路径不冒充外部 Provider。
  Provider 未配置、探测失败或签名服务未配置时返回 not ready，不创建半条会话。
- 相同 provider event ID 与相同 payload hash 只返回原会话；相同 ID 不同内容返回冲突。Provider 签名验证
  必须在 edge Adapter 完成，只有验证成功的事件才能进入内部 tenant dispatch。

### 6.3 知识问答

- 知识按国家、语言、产品、版本、生效时间和可见范围管理。
- 回答必须关联引用的知识版本。
- 过期、未审核或无权限文档不能进入检索上下文。
- 没有可信证据时回答“无法确认”，并提供转人工路径。
- 企业术语和禁止替换词同时作用于 ASR、翻译和答案生成。

知识发布闭环固定为：创建 source -> 创建不可复用的 draft revision -> 一次性提交 chunk 集合并进入
review -> 发布生效窗口。发布者不能从客户端指定 tenant、revision、content hash 或 citation；服务端按
chunk 顺序和内容生成 SHA-256，并把回答引用固定为 `knowledgeVersionId:blockId`。已发布版本及其 chunk
不可改写，新版本发布不改变历史会话引用。

检索请求必须显式提交 locale、country 和 product，服务端再叠加 tenant 与当前时间过滤；只选择每个
source 当前满足条件的最高 published revision。draft、processing、review、failed、尚未生效和已过期
版本均返回空。当前未配置 embedding Provider 时使用确定性的受限文本检索，不把 pending embedding
伪装为向量检索成功。

`ENT-CS-003` 把上述检索接入客服会话专用 RAG 入口。只有 `waiting`、`ai_active`、
`handoff_requested` 或 `human_active` 会话可以检索；请求不能提交 tenant 覆盖。命中时只返回已审核证据和
稳定 citation，由后续 Support Agent 按引用生成答案；无命中时返回本地化“无法确认”与转人工指令，不调用
LLM 生成企业事实。每次检索只审计维度、结果数和逐条知识版本/citation/hash，不保存问题或知识正文。

### 6.3.1 Support Agent

- AI 接待只在已有 support session、queue、communication binding、活动 entitlement 和当前通讯策略快照均有效时启动；
  客户端不能提交 tenant、cell、route epoch、generation 或模型地址。
- 每轮只消费服务端返回的当前 published RAG evidence。没有证据时不调用 LLM，而是使用本地化固定话术说明无法确认并转人工；
  Provider 未配置、超时、不可用或返回非法 JSON 时采用同一显式降级路径，不显示或播报“成功回答”。
- 模型输出必须严格等于 `spokenText/intent/toolRequest/riskSignals/knowledgeCitations/conversationState` 六字段；
  `thinking/reasoning/analysis` 或任何额外字段均拒绝。`ENT-CS-005` 建立注册和授权边界，
  `ENT-CS-006` 增加独立只读执行入口；Agent 生成尚未接入该入口，`toolRequest` 仍固定为 `null`。
- `answer/qualify` 必须至少引用一条本轮 evidence，引用只能是服务端给出的 citation 子集；任何风险信号必须转人工。
- 最近上下文最多12轮、单轮1500字节、整体8000字节，并以 hash、幂等键和递增 sequence 保存；客户输入单独只保存 SHA-256，
  恢复所需的受限上下文按租户数据生命周期处理。
- 每个 Worker ticket 固定 tenant/session/cell/route epoch/policy/entitlement/generation。回复完成后、TTS 播放前必须再次向 API 授权；
  取消、接管、过期 lease、旧 generation 或策略失效都会拒绝播放，Worker 立即中断 speech、清空缓冲且不自动恢复旧音频。

### 6.3.2 企业术语与话术版本

- 术语包是租户内稳定资源，每次修改创建独立 revision；版本维度包含源/目标语言、国家、产品和
  `marketing|support|meeting|all` 使用范围。
- 术语条目保存稳定 term ID、原词、译词、别名、可选发音、大小写敏感和禁止替换标记；服务端生成
  内容 SHA-256，客户端不能指定 hash 或 revision。
- 话术模板按用途建立稳定资源，版本保存目标语言、国家、产品、提示文本、必说语、禁语和变量名；
  必说语与禁语冲突时禁止进入审核。
- 两类内容都遵循 `draft -> review -> published`，发布必须携带 expectedVersion 和有效时间窗；
  已审核内容、hash 和已发布版本不能改写，修订必须创建新 revision。
- 运行前由服务端按 tenant、语言、国家、产品、用途和当前时间解析当前有效 published 版本。
  同一运行上下文中的 ASR、翻译和 LLM 必须引用完全相同的 `termPackVersionId`；话术版本只附加给
  LLM。review、未生效、过期、跨租户或内容 hash 不一致时明确返回 not ready，不回退到草稿或
  伪造 Provider 成功。

### 6.4 工具调用

工具分三级：

| 等级 | 示例 | 执行要求 |
| --- | --- | --- |
| 只读 | 查询订单、物流、库存、预约 | 权限校验后可自动执行 |
| 可逆写入 | 创建工单、预约回拨、修改备注 | 明确复述并取得客户确认 |
| 高风险 | 退款、付款、身份验证、合同变更 | 必须人工接管或企业审批 |

LLM 只能提出结构化工具请求；Policy Engine 校验租户、客户、权限、参数和确认状态后才能真正执行。

`ENT-CS-005` 将工具登记为租户内不可变 revision，状态只允许
`draft -> active -> retired`。同名工具同时最多一个 active revision；发布新版会在同一事务中
退役旧版，已发布定义不允许改写。注册信息包含：

- 小型、封闭的输入 schema：根对象、`additionalProperties=false`、最多32个字段，字段只支持
  `string/number/integer/boolean`，整体最多8192字节。
- 固定风险策略：只读=`support:read + none`，可逆写=`support:manage + customer_confirmation`，
  高风险=`support:takeover + human_handoff`；客户端不能自由组合这三组值。
- 授权前重验 Worker ticket、lease、binding、policy、route epoch、generation、run 和客服会话；
  `tenantId/customerId/sessionId` 全部由服务端上下文解析，不接受模型或请求体覆盖。
- 参数必须精确符合 active revision 的 schema，并仅保存规范化 SHA-256；原始参数不进入
  tool execution 或审计明细。同一幂等键异参数直接冲突。
- 只读授权只能创建 `requested`；可逆写只能创建 `awaiting_confirmation`，不代表已执行；
  高风险只返回人工接管，不创建可执行记录。未注册、草稿或已退役工具均失败闭合。

`ENT-CS-006` 只开放 `order.lookup`、`logistics.lookup`、`inventory.lookup` 三个只读工具：

- 必须先取得 `ENT-CS-005` 创建的精确 `requested` execution，再由签名 Worker ticket 调用内部
  `execute-read`；请求不能另传 tenant、customer 或 session。
- 订单和物流按当前 support session 的 customer 过滤，其他客户的同标识与“不存在”返回一致；
  库存只在当前 tenant 的 Adapter 绑定内查询。
- 数据库先以15秒租约和递增 attempt 原子 claim，Adapter 在事务外最多执行5秒，随后以相同
  lease/version/definition/session fence 完成；过期或旧租约结果一律丢弃。
- 结果按工具精确字段校验，成功必须带 Adapter receipt/reference，并保存 SHA-256；完成记录只允许同参数稳定回放。审计只保存工具名、
  decision、Provider fingerprint、`simulated` 和结果 hash，不保存原始参数或结果正文。
- 生产 runtime 默认 `not_configured`。确定性 mock 只能显式注入并返回 `simulated=true`，不代表
  ERP、物流或库存 Provider 已接通。

`ENT-CS-007` 固定开放 `ticket.create`、`callback.schedule`、`note.add` 三个可逆写工具：

- Worker 必须先请求确认挑战；系统用客户语言精确复述主题/内容、回拨时间/原因或备注，并只接受
  确定性的“确认/取消”同义短语。挑战绑定当前 run、确认后的新客户 turn、sequence、客户文本
  SHA-256 和120秒有效期，不能拿确认前或其他会话的回复复用。
- 未确认、回复含糊、挑战过期、工具 revision 退役、session 非 `ai_active`、参数 hash 改变或
  Adapter/keyring 未配置时均不创建 Outbox，也不调用外部系统。回拨时间在发起确认和实际入队时
  都必须仍处于未来。
- 确认后原始参数使用 AES-256-GCM 密封，tenant/execution/customer/tool/idempotency 作为附加认证
  上下文；数据库与审计只保存确认/响应/结果 hash、Provider fingerprint、simulated 标志和 receipt，
  不保存明文 Outbox 参数。
- Cell Worker 使用同一 Provider 幂等键重试未知网络结果；超时、抛错和无 receipt 不得当作确定失败
  或再次创建业务对象。只有 Provider 明确完成或携带 reference 的确定失败才进入终态并原子发布
  Outbox。同一次 execution 的重复确认返回原 event，不产生第二个有效工单、回拨或备注。
- 生产组合默认 `not_configured`；tenant-bound mock 明确 `simulated=true`，只验证协议候选，不能对客户
  表述为工单系统、CRM 或回拨系统已成功。

本阶段仍不包含退款、支付或身份验证 Adapter，也不把“授权/确认记录已创建”、Outbox 已入队、mock
结果或静态检查表述为外部业务操作已成功。Support Agent 的 `toolRequest` 仍固定为 `null`，模型到
确认入口的自动编排不在本批开放。

`ENT-CS-008` 把退款、付款、身份验证以及其他登记为 `high_risk` 的请求收敛为不可执行的人工接管请求：

- 高风险仍必须精确登记为 `support:takeover + human_handoff`；任何参数 schema、工具 revision 或
  Worker/run/session 绑定不一致都失败闭合，绝不降级为只读或可逆写工具。
- 授权入口只保存 tenant、当前 Support Agent run、support session、customer、active tool revision、
  规范化参数 SHA-256、风险类别和风险证据 SHA-256，不保存退款原因、支付资料、身份材料等原文。
- 首次请求在同一数据库事务内写入不可变 `handoff request`，把 Agent run 和 support session 原子推进为
  `handoff_requested`；数据库继续拒绝为该请求创建 `tool_execution`、Outbox 或 Provider 调用。
- 同一幂等键且证据完全一致只返回原接管请求；参数、revision、run、session、customer 或证据任一变化即冲突。
  接管后只能授权 `handoff` 话术 TTS，普通回答不得继续播报。
- `refund.*`、`payment.*`、`identity.*` 分别归类为退款、付款、身份验证；其他 high-risk 工具统一归入
  `other_high_risk`，安全行为完全相同。当前只生成待人工处理的证据记录，不表示退款、付款或身份验证已完成。

`ENT-CS-009` 已形成坐席排队与接管代码候选：

- 主管以队列配置默认优先级、handoff SLA 和 claim lease；等待项按 SLA 是否超时、优先级、请求人工时间、
  会话 ID 确定性排序，不依赖进程内队列或不透明模型评分。
- 坐席只能以当前登录成员身份自领，不能在请求体伪造 `agentUserId`。同一会话由数据库部分唯一索引保证
  同时最多一个 active claim，并把 `human_active` 会话绑定到同一个 claim 和 assigned member。
- 坐席可续租或自释；owner/admin/support_manager 可释放和改派给 active 的客服角色。改派按
  old claim 终结、会话回到 handoff、new claim 建立、会话重新激活的单事务完成。
- lease 到期后工作项重新可见；新坐席 claim 时先在同一事务终结旧 claim 并释放会话，避免双控制者。
  claim/release/reassign 均使用 optimistic version、幂等 hash、脱敏审计和 tenant route document。
- 当前只证明服务端队列和互斥接管候选，不代表坐席工作台、字幕/通话控制、真实人工已接通或 PostgreSQL
  生产门禁通过；这些仍分别属于 `ENT-CS-010` 和真实环境验收。

`ENT-CS-010` 已形成坐席工作台代码候选：

- Web 左侧只读取当前 tenant 的 queue/work-item；接管后才读取对应 session 的客户、字幕、Agent 上下文、
  风险、case 和工具执行，不提供跨坐席的活动会话目录。
- claim 成功在同一 tenant 事务内把当前 Support Agent run 收敛为 `cancelled`；旧 Worker 的 prepare、TTS
  authorize 和 deliver 继续受 run/ticket/generation fence 拒绝。刷新既有 claim 时，工作台 activate API
  重新校验 assigned user、active claim 和未过期 lease 后补建相同停止栅栏。
- 中间字幕区只轮询 tenant-scoped `transcript_segments` 的最终 revision；没有 segment 时只显示已有 Agent
  上下文并标记“非实时字幕”，不生成示例对话或翻译。
- 右侧客户资料、历史 case、工具结果、高风险接管和知识检索均来自现有服务端聚合；知识检索沿用当前
  Agent 的 locale/country/product，缺少维度时禁用而不猜测默认值。
- claim 心跳从当前时间续一个 queue lease，续租冲突或到期后停止控制。释放接管回到等待队列；静音、
  转组、结束通话、创建工单和回呼没有安全 Provider/API 时固定显示 `not_ready`。
- 当前没有 LiveKit worker interrupt 回执、真实坐席媒体、CRM/Ticket Provider 或浏览器测试，因此只证明
  新生成/授权/交付的 AI 发言被服务端栅栏阻断，不证明已经播放的音频在300ms内物理停止，也不表示生产可用。

### 6.5 人工坐席工作台

- 左侧为等待队列和 SLA。
- 中间为实时原文、译文和通话控制。
- 右侧为客户资料、知识建议、订单和历史摘要。
- 提供接管、静音、转组、结束、创建工单和预约回拨。
- 接管时向坐席发送问题、已执行动作、风险和建议，不要求重新询问全部信息。
- 当前 Web 代码候选采用三栏布局、Material Icons 和同一浅/深色令牌；2.5秒字幕快照与 claim 心跳分别
  处理，字幕读取失败不能延长控制权，续租失败也不能用本地状态继续控制。
- “AI 已停止”只在服务端确认 run 为 `cancelled`、不存在或已终态时显示。active、handoff_requested、
  ending 或租约失效均不能进入 ready 工作台。
- 尚未接通的媒体按钮保持 disabled + reason code。工单/回拨只在服务端声明 Adapter、加密 keyring 和
  Provider 幂等保证均 ready 时开放；提交后显示“异步处理中”，只有确定性 Provider receipt 才显示完成。
- 坐席提交工单/回拨必须仍持有当前 session 的 active claim，并携带 session/claim expected version；API
  请求体不能指定 tenant、customer 或 agent。Provider 未配置时不落本地业务记录或 Outbox，不使用 toast、
  本地 mock 或临时 ID 冒充成功；显式 simulated Adapter 的页面和结果持续标记“仅协议验证”。
- 工单先建立 tenant-scoped pending case，回拨先建立 `dispatch_pending` 记录，再和后续动作账本、密文
  Outbox、脱敏审计同事务提交。网络超时或未知结果用原 Provider 幂等键后台重试，坐席可继续或结束会话；
  receipt 完成后才写 external ticket/callback ID，确定失败保留失败原因供坐席处理。

### 6.6 质检和分析

- 质检规则是租户级、按语言或 `*` 通配语言发布的不可变版本；每次复核固定规则版本、引擎版本和
  会话/Agent turn source hash，证据变化或规则升级会形成新复核，不改写历史结果。
- 首批确定性规则检查：首次送达回答是否完成 AI 身份告知、回答/需求确认是否缺少知识引用、风险信号是否
  未转人工、是否命中禁用承诺，以及已生成回答是否完全未送达。短语使用 NFKC、大小写和连续空白归一化后匹配。
- 只有 `ended/failed` 会话及 `completed/failed/cancelled` Agent run 可分析。进行中的会话不提前定性；
  没有 Agent 输出、没有适配语言规则或证据绑定不完整时明确拒绝。
- 客服主管、企业管理员和所有者可发布规则并以明确 session ID 触发分析；审计员只读 Dashboard 和证据；
  坐席不取得质检页或质检数据权限。客户端提交的 tenant、角色或 scope 不能扩权。
- Dashboard 每个会话只统计最新复核，展示严重/高/中命中、未告知会话数、无引用回答数和最新分析时间；
  会话详情关联确定性发现、Agent 回答、最终 revision 字幕和最小化工具执行证据。
- “无引用回答”只是结构规则，不等于语义错误回答。当前没有语义质检模型或人工金标 Adapter，复核固定为
  `partial/not_configured`，错误回答率保持 `null`；不得补零、推断准确率或用规则命中率冒充语义质量。
- 当前只支持主管按会话 ID 手动触发，不包含自动批处理、实时流式评分、抽样复核工作流、投诉归因或 KPI
  计算。首次响应、一次解决率、平均处理时长、接管率、投诉率仍待后续聚合任务。

## 7. 企业会议

### 7.1 会前

- 创建即时或预约会议。
- 生成企业 Call Link，或通过日历 Adapter 创建邀请。
- 设置会议语言、参会者、术语包、纪要模板和保存期限。
- 配置录音、转写、翻译、屏幕 OCR 和材料导出授权。
- 主持人可限制谁能共享屏幕、录制和导出。

### 7.2 会中翻译

- 多人实时字幕、自动语种识别和双向翻译。
- 每个参会者独立选择字幕语言和是否播放译音。
- 独立 participant track 优先作为身份真值；单音轨再使用说话人分离。
- 说话人切换驱动 ASR turn，禁止跨说话人合并文本。
- 支持抢话、重叠、主持人静音、姓名修正和重点标记。
- 用户可标记决策、待办、风险和稍后讨论。

当前 `ENT-MTG-003` 代码候选把每个 LiveKit participant audio track 作为独立翻译源，参会者在入会前选择中文或英文字幕，服务端只把匹配语言的 final 原文/译文投递到该参与者 identity。偏好变更递增独立 `playbackGeneration`，旧 Worker ticket、旧 communication generation 或旧播放 generation 均不得恢复结果。定向 TTS 尚未实现，用户请求译音时必须显示 `not_ready`，不能把一条全局音轨冒充个人译音。

### 7.3 屏幕共享

- Web 支持共享整个屏幕、窗口或浏览器标签页。
- iOS 使用 ReplayKit，Android 使用 MediaProjection。
- 同一时间默认只允许一名共享者；主持人可以停止或切换共享者。
- 支持开始、暂停、恢复和停止共享。
- 支持自动、流畅和高清画质。
- 支持可用平台上的系统音频共享，并与麦克风音轨分离。
- 网络变差时优先保证语音和字幕，再降低共享画质。

当前 `ENT-MTG-004` 服务端代码候选已提供成员当前共享查询以及 acquire、pause、resume、renew、stop 命令。
每个命令要求签名 tenant route、当前会议 participant、策略/entitlement、幂等键和 expected version；同一会议只保留
一个 active/paused 租约。每代共享使用独立发布 identity 和仅允许 screen-share source 的短期 grant；暂停、停止、
租约到期或 route fence 会撤销旧 identity。Provider 未配置或撤销暂时失败时返回 `pending` 并由 outbox 重试，
不显示假成功。

当前 `ENT-MTG-005` 成员 Web 代码候选只在用户点击后调用 `getDisplayMedia`，并从浏览器实际
`displaySurface` 映射 screen/window/tab；浏览器不报告来源时立即停止采集，不以用户预选值冒充。取得真实来源后
才申请服务端租约，并用独立于麦克风会议连接的最小权限 Room 发布 screen track；发布成功立即绑定 track SID，
随后按10秒续租。观看端从当前租约取得 publisher identity，只接受该 identity 的 `screen_share` 轨道，旧 generation
即使迟到也不渲染。

共享者可暂停、恢复和停止；暂停保留本地 capture 但断开旧发布身份，恢复使用新 generation grant 重新发布，停止或
浏览器原生“停止共享”先结束本地 track，再提交幂等 stop。服务端返回撤销 pending 时界面保持“正在停止/暂停”，
不显示已完成。访客发布和 OCR 仍分别属于后续任务；未执行真实浏览器/LiveKit 测试前不可宣称
screen/window/tab 可用或通过企业生产门禁。

当前 `ENT-MTG-010` 代码候选增加独立主持人强停入口。只有持有 `screen_share:stop` scope 且仍是该 meeting
活动参会者的 owner/admin/会议主持人可以请求；服务端不信任隐藏按钮或客户端传入角色。强停复用既有 CAS stop
状态迁移，把 share 置为 ended、递增 version/generation、清空 track SID 与租约，并以独立 `force_stop` 请求 hash、
审计动作和 `force_stopped` outbox 区分普通共享者停止。LiveKit 即时撤销失败时返回 pending 并由原撤销 outbox
最终收敛；客户端保持“停止中”，使用同一幂等键有界重试，不把 Provider 未完成显示为成功。

当前 `ENT-MTG-008` Web 入口提供“共享系统音频”选择，但以浏览器实际返回的 audio track 为唯一事实：请求音频后
没有得到音轨时，在 acquire 前停止全部采集并提示选择支持音频的标签页或关闭选项，不把无音频共享登记为成功。
得到音轨后，服务端分别校验系统音频 entitlement 和 generation grant，客户端核对 grant capability，再把视频发布为
`screen_share`、音频发布为独立 `screen_share_audio`。视频结束时停止整次共享；活动中的音频单独结束时只移除音频发布，
明确显示“系统音频已结束，共享画面继续”，不会因可选音频故障终止画面。
观看者通过独立 audio 元素播放；共享者本机不附加该轨，避免捕获音频再次本地回放形成循环。

会议翻译 Worker 只接受 `ent:<participantId>:<role>` 发布者的 microphone source，`ent-share:*` 和
`screen_share_audio` 不进入参会者 ASR/字幕。iOS ReplayKit 当前仍忽略 `.audioApp/.audioMic`，Android MediaProjection
当前没有 AudioPlaybackCapture/自定义 WebRTC audio source；两端继续固定 `includesSystemAudio=false`，不得用开关或
通知文案冒充实现。当前未执行浏览器、真实 LiveKit、耳机/扬声器回声、ASR 错误发言段或移动端真机验证，任务保持
`in_progress`。

当前 `ENT-MTG-006` iOS 代码候选在成员已加入企业会议后按 `screenShareRole` 显示 ReplayKit 入口，提供自动、流畅、
高清三档和开始/停止；不开放系统音频，也不把暂停冒充完成。主 App 在申请服务端租约前先确认 Broadcast Extension 与
App Group 可用，取得 generation 专属 grant 后建立独立 publisher Room，再调起系统广播选择器。25秒内未开始广播、
系统停止、离会、续租失败或服务端 generation 改变时先停止本地广播并回收租约。

Broadcast Extension 不接收 RTC token，只读取 App Group 中带到期时间的 share/generation/publisher/nonce 控制清单，
过期、清单删除或代际不匹配即停止；视频样本只经 App Group Unix socket 交给主 App 的 LiveKit 采集路径，音频样本忽略。
离开 App 后持续共享依赖正在进行的会议音频后台会话，不能作为任意后台执行能力。未完成真机、真实 LiveKit、后台/锁屏、
网络切换和系统权限验证前，不能宣称 AC-SHARE-002 或企业生产门禁通过。

当前 `ENT-MTG-007` Android 代码候选复用同一成员角色、三档画质、独立 publisher Room、25秒激活超时和10秒续租。
Android 13+ 先请求可见前台通知权限，再由系统 MediaProjection 弹窗取得一次性捕获授权；用户拒绝时不申请服务端租约。
Android 14 顺序固定为授权成功、acquire、启动 `mediaProjection` 前台服务、创建屏幕轨，避免在前台服务就绪前消费授权。
通知停止、系统投屏停止、租约到期、离会和续租失败均先停止本地发布，再收敛服务端租约。Service 只接收
share/generation/publisher/lease/nonce，不接收 RTC token；系统音频固定关闭。未完成 APK 构建、目标 Android 真机、权限拒绝、
后台/锁屏、进程回收、网络切换和真实 LiveKit 验证前，不能宣称 Android 屏幕共享可用或通过生产门禁。

共享布局提供：

- 画面优先。
- 字幕优先。
- 画面与字幕并排。
- 手机横屏全屏和浮动字幕。

当前 `ENT-MTG-009` 把前三种布局落为 Web/Flutter 可见选择：画面优先保持共享画面在前并限制字幕区高度，字幕优先
把字幕置前并缩短共享画面，并排在空间和字号允许时使用两列。为避免关键控制被遮挡，当前代码候选没有启用浮动字幕
overlay；Web 低于960px自动单列，Flutter 宽度低于840或文字缩放超过1.5倍时自动单列，窄屏按钮使用 wrap/grid。

发布端按画质显式配置 screen-share simulcast：smooth 为720p主层+360p低层，auto 为1080p主层+360p/720p，
high 为1440p主层+360p/720p；两端开启 dynacast。Web 观看端用 LiveKit `RemoteVideoTrack.attach/detach`，Flutter
用 `VideoTrackRenderer`，使 adaptive subscription 依据真实可见性、CSS/Widget 尺寸和像素密度选择层，而不是仅把原始
MediaStreamTrack 交给 video。SDK/浏览器不支持 screen simulcast 时保持单层明确降级；媒体层降级不影响会议麦克风、
系统音频或服务端定向字幕。真实弱网、层选择、CPU、横屏和200%/动态字体尚未验收，任务保持 `in_progress`。

### 7.4 共享内容翻译

- 用户主动开启后，服务器低频提取关键帧进行 OCR。
- OCR 结果按原位置显示译文，可切换原图、译图和双语对照。
- 无变化区域不重复 OCR 和翻译。
- 默认不保存关键帧；保存或录制必须单独授权。
- OCR 失败不得中断屏幕共享和会议字幕。

`ENT-MTG-012` 当前代码候选把共享内容翻译做成每个参会者独立、默认关闭的订阅。开启时服务端复核 active
participant、当前 share/generation/track、tenant route、entitlement 和短期 Worker ticket；Worker 只订阅该发布者的
`screen_share` 视频轨，按1至2秒采样并在调用外部 Provider 前提交64位感知 hash。相同或近似帧不消耗 Provider，业务库
只保存 run、订阅、frame hash/尺寸、归一化布局块和实际 Provider fingerprint，不保存图像字节。Web/Flutter 仅接受服务端
定向、与当前 meeting/participant/share/generation/run 匹配的布局；data channel 不可用时以四秒 API 轮询读取已落库布局。
Provider、调度或 RTC 未配置时显示 `not_configured/failed`，原共享画面和会议字幕继续。自动化、真实 PostgreSQL、
OCR Provider、LiveKit、浏览器和真机验收尚未执行，因此任务保持 `in_progress`。

### 7.5 会后材料

- 结束会议后冻结 `meeting_translation_events` 的最新 revision；服务端按 source participant、track、segment 去除
  target fan-out 重复记录，再按说话人生成原文、译文和双语逐字稿。客户端不得从本地字幕缓存重新拼接材料。
- 每次生成形成独立材料修订，固化 source count、SHA-256、保存期限、Provider fingerprint 和 review 状态；同一
  idempotency key 只返回同一修订，不同请求 hash 冲突。
- 生成摘要、议题、决策、异议、风险和未解决问题；每一项必须引用当前修订内真实 segment，引用不存在时整项拒绝。
- 提取待办、负责人、截止时间和优先级，并关联证据 segment。负责人只有在 Provider 文本与唯一参会者姓名精确匹配且
  引用片段明确出现姓名时才绑定；截止时间只有在引用片段出现同一可解析值时才保存，未说出的字段保持空值。
- Provider 未配置、不可用或失败时只保留冻结逐字稿，并分别显示 `not_configured` 或 `failed`；不得用本地模板摘要
  冒充 AI 复核成功。摘要与待办必须经主持人/管理员 CAS 发布后才成为 published artifact。
- draft 修订只对当前会议主持人、owner 和 admin 可见；普通成员与审计只读取最新 published 修订，不能提前消费未复核结论。
- 导出 Markdown、PDF、Word，或通过 Adapter 同步协作工具。
- 用户修正姓名只更新本次材料的 speaker label 和材料版本，不修改 participant/member；术语提升仍需管理员走企业词条发布。

`ENT-MTG-011` 当前已形成 PostgreSQL schema、Repository/runtime/API、OpenAI-compatible review adapter 的明确降级、
Web/Flutter 材料入口和审计/outbox 代码候选。导出 Adapter、自动化、真实 migration/forced-RLS、Provider、浏览器和真机
证据尚未执行，因此任务保持 `in_progress`，不代表企业生产门禁通过。

### 7.6 企业日历同步

- 只有未来的预约会议可同步；即时、已开始、已结束或已取消会议不创建外部事件。
- 只有会议主持人且具有 `meeting:write` scope 时可提交，同一会议最多绑定一个 Provider 事件。
- 首个 Adapter 为 Google Calendar。事件只包含会议标题、起止时间和已认证成员入口，不创建 Google Meet，
  也不把访客 token 或 Provider 凭据发送给客户端；外部访客仍走独立短期邀请。
- Provider 未配置、实时 readiness 非 ready、租户未绑定、加密 keyring 缺失或 Worker 不可用时明确失败或 pending，
  不生成本地假事件。同步成功后才显示经服务端验证的 Provider reference。
- 重试沿用由 tenant 与 meeting 派生的稳定 event ID；Provider 返回重复 ID 时读取并核对无界 meeting/sync 标记，
  相同事件收敛为成功，不同事件作为 collision 失败。

`ENT-MTG-013` 当前代码候选已形成 `0027` forced-RLS 同步记录、主持人 API、加密 outbox、Google Workspace
service-account Adapter、可注入 mock 以及 Web/Flutter 状态入口。自动化、真实 PostgreSQL、Google Workspace 管理授权、
浏览器和真机验收未执行，因此保持 `in_progress`，不代表企业生产门禁通过。

## 8. 企业公共能力

- 企业和成员管理、RBAC 和数据可见范围。
- SaaS 套餐、席位、entitlement、试用、续费、停服和注销。
- `homeRegion`、区域服务状态、数据驻留和受控迁移。
- 企业知识库、术语库、营销话术和会议模板。
- 国家策略、授权证据、禁拨名单和保存期限。
- Provider 路由、灰度、成本和降级策略。
- 租户级用量、预算、余额、预警和账单。
- 操作审计、数据导出审计和异常告警。

### 8.1 统一通讯会话和企业运行策略

- 会议、客服、营销外呼和人工接管都创建或绑定唯一 `communicationSessionId`；
  LiveKit room、SIP call、participant、track 和 Provider operation 只是可恢复的外部绑定。
- 会话创建时冻结签名 route document 的 `routeEpoch`、home region/cell、policy version 和
  entitlement version；任何迟到事件必须携带相同 route epoch，并以 generation + event sequence
  收敛，不能恢复已终止会话。
- Worker 只接受服务端从当前会话绑定派生的短期签名 ticket；ticket 固化 tenant、session、cell、
  route epoch、generation、capability 和到期时间。签发、accept、heartbeat、提交结果均二次读取
  当前 binding/lease；取消会释放租户容量并使旧 ticket 立即失效。
- 客户端必须展示 `dispatching`、`ready`、`draining`、`cancelled`、`degraded`、
  `captions_only` 和 `half_duplex` 等真实运行状态，不把已受理误显示为已执行。
- 管理员可配置租户允许的端侧/云端 ASR、翻译、TTS、声纹、录音和诊断策略；
  每次发布生成不可变 tenant policy version。端侧/云端执行偏好支持仅端侧、优先端侧、
  优先云端、仅云端和禁用；服务端依据当时有效的 capability/readiness 决定实际路径。
- 会话 dispatch 前生成不可变策略快照，冻结 policy version、route epoch、generation、
  ASR/翻译/TTS 引擎、Provider/device fingerprint、readiness 到期时间、允许的 Worker capability
  和实际降级状态；短期 Worker ticket 必须绑定该快照，客户端不能自行声明能力可用。
- 缺少配置、fingerprint、有效 readiness 或授权证据时只能进入 `captions_only`、
  `half_duplex`、`blocked` 等真实状态，不能生成虚假 ready、声纹命中、录音或诊断成功。
- 企业声纹、参考音频和诊断证据必须有独立目的、授权、保存期限和删除路径；
  个人声纹不能默认进入企业租户，企业声纹不能跨租户共享。声纹、录音和诊断音频分别
  绑定 purpose-specific authorization；证据缺失、过期或撤回时立即阻断新 dispatch，并使
  仍在运行的策略快照失效，但不得改写快照中已经冻结的历史决策字段。
- 工作台分别展示数据库 primary readiness、Provider readiness、容量、依赖安全例外和
  灾备状态；任一子项 ready 不代表企业整体 production ready。
- 数据库 readiness 必须区分 schema 已验证、切换证据已验证、逻辑恢复已验证和异地
  PITR 已验证；证据需显示环境、commit/image/topology、cutover ID 和最近验证时间。
  本地或同故障域恢复只能显示“机制已验证”，不能显示“生产灾备就绪”。

### 8.2 企业用量预算

- 预算按 tenant、用量类别、单位和 UTC 周期配置；不同单位不得相加，也不能用个人余额替代企业预算。
- 高成本任务先创建 usage hold，执行终态按真实用量 settle；取消或到期只释放 hold，不产生消费流水。
- 相同 hold/settle 幂等键与相同请求 hash 只返回原结果；同键不同载荷必须拒绝，不能重复占用或扣量。
- 服务端在租户事务内串行复核已结算量、有效 hold 和预算上限；客户端显示的余额不参与授权决定。
- 达到阈值时只追加一条预算告警；历史 usage ledger 和告警不可更新或删除，纠正必须走后续调整流水。
- SQLite/JSON 运行时明确报告 PostgreSQL required，不能用内存预算或演示余额伪造企业账务成功。

### 8.3 租户账务和套餐权益

- 每个 tenant 只有一个 tenant-owned billing account；付款联系人只是账号 subject，不能替代
  `tenantId`、跨租户共享余额或继承个人订阅。
- 套餐能力由服务端已发布的不可变 plan version 决定。租户变更只能引用 plan code/version、
  席位数和账期类型，不能提交 entitlement 内容、并发上限或账期起止时间。
- 变更套餐在一个 tenant transaction 内退役旧 subscription/entitlement，创建新订阅和不可变
  entitlement snapshot，并追加幂等变更记录与审计；同一 billing account 同时最多一个活动订阅。
- 新会话绑定和 Worker dispatch 必须同时复核活动 billing account、活动订阅、有效账期、精确
  entitlement version 和 capability limit。任一缺失、过期或不一致都失败闭合，客户端缓存和
  `maxUnits` 不参与授权。
- 当前实现不连接支付渠道，也不生成付款、续费或开票成功；真实账务 Provider、回调、退款和
  对账仍须后续环境验收。SQLite/JSON 继续返回 PostgreSQL required。

### 8.4 不可变计量和账期聚合

- 每次真实消费先追加 tenant usage event，再在同一事务追加一条引用该 event 的 settle ledger；
  event 和 ledger 的 tenant、billing account、类别、单位、金额、来源、请求 hash 和时间必须一致。
- 原始 event 与 ledger 都不可更新或删除。错账只能由内部受控账务运行时追加 adjustment ledger，
  adjustment 必须引用原 settle ledger、记录原因和 actor，且累计调整后不能产生负数净用量。
- 账期聚合按 `tenant + billing account + category + unit + UTC period` 重建，保存 settle、adjustment、
  net、记录数、SHA-256 ledger hash、source watermark 和版本；聚合可重建，不能反向改写原始流水。
- 租户公开接口只提供 `usage:read` 的聚合只读列表，不提供 owner/admin 自助冲正入口；账务调整
  必须来自受控内部流程并写审计，避免租户角色给自己减免用量。
- SQLite/JSON 不承载企业计量真值，继续明确返回 PostgreSQL required。当前完成的是本地数据库
  机制与自动化，不等于真实支付、开票、A1/H3 或企业生产账务门禁通过。

## 9. 核心流程契约

### 9.1 首次开通

| 项目 | 设计 |
| --- | --- |
| 前置条件 | owner 账号已验证，服务条款和数据处理协议版本有效 |
| 主流程 | 创建租户 → 分配 region/cell → 建立套餐和权益 → 区域数据面 provision → readiness → 激活 |
| 成功结果 | 获得可签名验证的 route document；owner membership、订阅、权益和审计事件一致 |
| 失败处理 | 保持 `provisioning_failed`，展示可重试步骤；相同幂等键不重复创建租户或计费对象 |

### 9.2 外呼活动上线

| 项目 | 设计 |
| --- | --- |
| 前置条件 | 线索授权、禁拨、国家策略、PSTN、预算和人工接管均 ready |
| 主流程 | 草稿 → 导入线索 → 合规校验 → 主管审批 → 排期 → 执行 → 结果/结算 |
| 成功结果 | 每个拨号任务关联活动快照、授权证据、策略版本、唯一 communication session、provider call 和 ledger |
| 失败处理 | 任一 readiness 失败即阻断新拨号；Provider 未配置显示 `not_ready`，不得生成假 call ID |

### 9.3 客服接管

| 项目 | 设计 |
| --- | --- |
| 前置条件 | 渠道 ready、队列有可用坐席或明确回拨策略 |
| 主流程 | AI 服务 → 风险/请求触发 handoff → 队列 claim → 上下文交接 → 人工服务 → 结束 |
| 成功结果 | 同一会话同一时刻只有一个控制方；接管后 AI 音频立即停止，字幕和建议可继续 |
| 失败处理 | claim 冲突返回最新占用者状态；接管超时只能结束或回拨，不能恢复越权 AI 操作 |

### 9.4 会议与屏幕共享

| 项目 | 设计 |
| --- | --- |
| 前置条件 | meeting active、参会 token 有效、主持人策略允许共享 |
| 主流程 | acquire lease → 发布 screen track → 自适应订阅 → pause/resume → stop/revoke |
| 成功结果 | 同一会议只有一个 active/paused share；主持人停止后旧 track 不能恢复 |
| 失败处理 | OCR、翻译或系统音频失败不终止画面；RTC 断开后租约超时收敛为 ended |

## 10. 非功能要求

- 所有企业数据必须租户隔离。
- 共享 SaaS 基础设施必须限制 noisy neighbor，按租户实施配额、并发、限流和熔断。
- 语音故障不得阻断字幕；模型故障必须明确降级。
- 所有外呼、工具写入、共享控制和导出操作必须幂等。
- 网络恢复、App 重启和 Worker 重启后任务必须收敛到唯一状态。
- 取消、接管、禁拨、撤回和主持人停止必须使旧 generation/fencing token 失效，迟到的
  MT、TTS、Agent、Provider 或媒体结果不能恢复已经结束的状态。
- 大租户持续负载时，小租户的登录、会议和客服必须在已声明配额内继续可用；超载只能
  有界拒绝或降级，不能形成无界队列。
- 默认最小化保存原始音频和屏幕内容。
- 客户拒绝、禁拨、撤回和主持人停止等控制必须优先于 AI 生成结果。

## 11. 产品阶段

| 阶段 | 范围 |
| --- | --- |
| 内部演示 | SQLite 单机、企业会议和客服演示，不接入真实企业生产数据 |
| 企业试点 | 企业 tenant-scoped PostgreSQL、统一 communication session、企业会议、屏幕共享、AI 客服知识问答、少量白名单租户 |
| 受控灰度 | AI 客服工具调用、坐席接管、授权线索外呼、单一 PSTN Provider |
| 企业发布 | 多租户 SaaS、国家策略、审计、SLA、灾备和租户生命周期 |
| 增强 | 屏幕 OCR 翻译、更多渠道、A/B 和高级质检 |
