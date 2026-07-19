# 无界AI企业版详细功能设计

版本：v1.18
日期：2026-07-19
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

租户的 `homeRegion` 创建后不能由普通管理员直接修改；跨区域迁移必须通过受控迁移任务完成。

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

### 5.2 线索管理

- 支持 CSV、CRM Adapter 和 API 导入。
- 号码统一转换为 E.164，并保留原始输入。
- 按企业、号码和活动去重。
- 每条线索保存来源、授权用途、授权渠道、授权时间、失效时间和证据引用。
- 授权用途必须覆盖自动营销电话；普通邮件或人工电话授权不能自动推导。
- 合并企业禁拨名单、国家禁拨结果和活动排除名单。
- 联系人撤回后立即停止所有待执行任务，并生成审计事件。

### 5.3 AI 营销专员

- 配置品牌、身份、产品、价值主张和目标市场。
- 配置开场告知、资格问题、产品说明、异议处理和结束语。
- 支持自动语种识别和同一通话内语言切换。
- 支持普通话、英语和已上线目标市场语言的声音预设。
- 可执行目标限于记录意向、预约、发送资料、创建回访和转人工。
- 不得自主承诺价格、付款、退款、合同、医疗、法律或金融结论。
- 知识不足时必须说明无法确认，不得使用 LLM 自由补写事实。

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

### 5.6 结果和分析

- 结果分类：无意向、潜在线索、预约成功、需回访、拒绝联系、无效号码。
- 自动生成摘要、需求、异议、意向等级、承诺和下一步。
- 预约、回访和资料发送必须形成可追踪任务。
- 支持结果推送 CRM Adapter，并保存外部对象 ID。
- 指标包括接通率、有效对话率、预约率、接管率、退订率、投诉率和单有效线索成本。

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

### 6.3.1 企业术语与话术版本

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

### 6.5 人工坐席工作台

- 左侧为等待队列和 SLA。
- 中间为实时原文、译文和通话控制。
- 右侧为客户资料、知识建议、订单和历史摘要。
- 提供接管、静音、转组、结束、创建工单和预约回拨。
- 接管时向坐席发送问题、已执行动作、风险和建议，不要求重新询问全部信息。

### 6.6 质检和分析

- 自动检查身份告知、服务用语、错误承诺、敏感信息和未解决问题。
- 主管可按会话回放、字幕、工具调用和证据进行复核。
- 指标包括首次响应、一次解决率、平均处理时长、接管率、知识命中率、错误回答率和投诉率。

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
不显示已完成。访客发布、自适应 simulcast、主持人强停和 OCR
仍分别属于后续任务；未执行真实浏览器/LiveKit 测试前不可宣称 screen/window/tab 可用或通过企业生产门禁。

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

### 7.5 会后材料

- 按说话人生成原文、译文和双语逐字稿。
- 生成摘要、议题、决策、异议、风险和未解决问题。
- 提取待办、负责人、截止时间和优先级，并关联证据 segment。
- 导出 Markdown、PDF、Word，或通过 Adapter 同步协作工具。
- 用户修正姓名和术语只作用于当前会议，除非管理员明确提升为企业词条。

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
