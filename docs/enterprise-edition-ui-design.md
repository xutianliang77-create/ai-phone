# 无界AI企业版 UI 详细设计

版本：v1.18
日期：2026-07-19
状态：设计基线；企业 Web 公共组件、首批设置/工作台、响应式/主题/无障碍和 Web/iOS/Android 成员屏幕共享代码候选已实现，正式验收仍在开发

## 1. 设计范围

本文定义无界AI企业版 Web 控制台、客服坐席台、Web 参会页和 Flutter 企业入口的统一视觉、布局、组件、状态与图标规则。业务范围沿用企业版详细功能设计，只覆盖：

1. 企业公共底座与工作台。
2. 出海 AI 外呼营销。
3. AI 客服与人工接管。
4. 企业会议、屏幕共享和会后材料。

本文不增加 OA、通用 CRM、通用工单或私有化部署入口。原型中的租户、会话、活动和指标均为设计示例；Provider、PostgreSQL 和生产 readiness 仍以服务端及环境证据为准。

## 2. 与个人版保持一致

企业版不创建第二套品牌语言，直接继承 `apps/mobile/lib/src/app/theme.dart` 的 Material 3 主题：

- 冷白背景、炭黑正文、钛灰边框。
- 青绿色只用于主操作、选中态、进度和可用状态。
- 珊瑚色只用于信号、风险、失败和需要人工关注的状态。
- 卡片无投影，使用 1px 描边；圆角统一不超过 8px。
- 图标统一使用 Flutter `Icons.*` 对应的 Material Icons；不混用 emoji、Font Awesome、Lucide 或独立线性图标库。
- 选中导航使用实心图标，未选中使用同语义 `*_outlined` 图标。

企业 Web 可以在左侧导航顶部展示无界AI品牌标识；移动端首页继续遵守个人版“不占用业务首屏展示品牌大图”的原则。

## 3. 设计原则

### 3.1 工作优先

- 页面首屏先展示任务、状态和可行动信息，不放营销横幅。
- 一页只保留一个主要操作；批量导入、发布、审批和导出使用明确的异步 job 状态。
- 表格用于高密度管理，卡片用于状态汇总和实时会话，不把所有内容卡片化。

### 3.2 服务端真值可见

- 权限、entitlement、readiness、预算和资源状态均来自服务端。
- 前端隐藏入口只减少干扰，不替代服务端 guard。
- `demo_only`、`not_configured`、`degraded`、`not_ready` 必须显示原始语义，不能改写为“已就绪”。
- 异步命令返回 `processing` 时显示 job；没有 Provider reference 时不显示成功。

### 3.3 风险动作克制

- 启动外呼、发布知识、导出审计、强制停止共享、停用成员和删除租户使用确认对话框。
- 危险操作不使用大面积红色背景，默认使用珊瑚色文字或描边；最终确认按钮才使用 error 色。
- 对话框同时显示影响范围、不可逆后果、当前版本和 trace ID/审批依据。

## 4. 视觉令牌

### 4.1 颜色

| 语义 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| Primary | `#087A70` | `#62D7CA` | 主按钮、选中、链接、进度 |
| On Primary | `#FFFFFF` | `#003731` | 主按钮文字与图标 |
| Signal/Secondary | `#C4574E` | `#FFB0A6` | 风险、失败、接管和信号点 |
| Signal Text | `#A8433C` | `#FFB0A6` | 小字号风险文字；浅色前景静态对比度 5.94:1 |
| Tertiary | `#4F6498` | `#B9C5FF` | 次级信息、分析维度 |
| Surface | `#F7F9F8` | `#0C1110` | 页面背景 |
| Surface Container | `#FFFFFF` | `#151C1A` | 卡片、表格、输入框 |
| Surface High | `#EAF0EE` | `#1C2522` | 选中行、次级区域 |
| Surface Highest | `#E0E9E6` | `#25302D` | 骨架、禁用和轨道 |
| On Surface | `#17201E` | `#E3E8E6` | 主文字 |
| Outline | `#697572` | `#87918E` | 强边框和辅助文字 |
| Outline Variant | `#D2DCDA` | `#394542` | 普通分隔线和卡片描边 |
| Error | `#C34C43` | `#FFB4AB` | 失败和最终危险确认 |

颜色不得单独表达状态；状态徽标同时包含图标和文字。

### 4.2 字体

Web 优先使用系统中文无衬线字体：`-apple-system`、`BlinkMacSystemFont`、`Segoe UI`、`PingFang SC`、`Microsoft YaHei`。与 Flutter 文字层级对齐：

生产 Web 以 `rem` 表达字号、行高、控件和导航基准尺寸；默认根字号下仍与下表像素值一致，用户字体放大时允许内容重排而不是裁切文字。

| 层级 | 字号/行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| Headline Small | 24/30 | 700 | 页面标题 |
| Title Large | 20/26 | 700 | 卡片组和详情标题 |
| Title Medium | 16/22 | 600 | 表格主字段、区块标题 |
| Body Large | 16/25 | 400 | 实时字幕和关键说明 |
| Body Medium | 14/21 | 400 | 默认正文、表格、表单 |
| Label Large | 16/20 | 700 | 主要按钮 |
| Label Medium | 12/16 | 600 | 状态、导航辅助和元数据 |

### 4.3 间距、尺寸和圆角

- 基础间距单位：4px；常用间距为 8、12、16、20、24、32。
- Web 页面左右内边距：宽屏 32px，中屏 24px，窄屏 16px。
- 顶部栏高度 64px；侧边导航宽度 248px，折叠后 72px。
- 输入框和主要按钮高度 48px；紧凑表格操作最低 36px；触控目标不得小于 44px。
- 卡片、按钮、输入框、导航选中态、菜单和提示统一 8px 圆角。
- 不使用悬浮大阴影；弹窗只使用弱遮罩和 1px outline。

## 5. 图标系统

### 5.1 一级导航

| 导航 | 默认图标 | 选中图标 |
| --- | --- | --- |
| 工作台 | `Icons.dashboard_outlined` | `Icons.dashboard` |
| 外呼营销 | `Icons.campaign_outlined` | `Icons.campaign` |
| AI 客服 | `Icons.support_agent_outlined` | `Icons.support_agent` |
| 企业会议 | `Icons.groups_outlined` | `Icons.groups` |
| 客户与线索 | `Icons.contacts_outlined` | `Icons.contacts` |
| 知识与术语 | `Icons.menu_book_outlined` | `Icons.menu_book` |
| 数据分析 | `Icons.query_stats_outlined` | `Icons.query_stats` |
| 合规与审计 | `Icons.policy_outlined` | `Icons.policy` |
| 企业设置 | `Icons.settings_outlined` | `Icons.settings` |

### 5.2 通用操作

| 语义 | Material 图标 | 规则 |
| --- | --- | --- |
| 新建 | `add` | 和对象名组合，例如“新建活动” |
| 搜索 | `search` | 只在输入框中可省略文字 |
| 筛选 | `filter_alt_outlined` | 有筛选时加数量徽标 |
| 刷新 | `refresh_outlined` | 不表示重试写命令 |
| 导入 | `upload_file_outlined` | 上传后进入 processing |
| 导出 | `download_outlined` | 审计导出必须二次确认 |
| 更多 | `more_horiz` | 低频操作菜单 |
| 审批 | `verified_user_outlined` | 不与普通保存共用图标 |
| 人工接管 | `pan_tool_alt_outlined` | 珊瑚色提示 |
| 屏幕共享 | `screen_share_outlined` | 停止使用 `stop_screen_share_outlined` |
| 共享内容翻译 | `translate` | 关闭使用 `visibility_off_outlined`，不另造 OCR 图标 |
| 会议 | `groups_outlined` | 不使用通话 `call_outlined` 替代 |
| 会后材料 | `article_outlined` | 逐字稿使用 `subject_outlined`，复核使用 `fact_check_outlined` |
| 结论与待办 | `summarize_outlined` / `task_alt_outlined` | 发布使用 `publish_outlined`，证据必须保留文字锚点 |
| 知识 | `menu_book_outlined` | 文档文件另用 `description_outlined` |
| 审计 | `policy_outlined` | 安全设置才使用 `security_outlined` |

图标默认 20px，表格内 18px，空状态 32px；图标按钮必须有 tooltip 和可访问标签。

## 6. Web 控制台框架

```text
┌────────────── 248 ──────────────┬──────────────────────────────────────────┐
│ 品牌 / 租户                      │ 搜索        环境状态  通知  当前用户      │ 64
├─────────────────────────────────┼──────────────────────────────────────────┤
│ 工作台                           │ 页面标题 + 说明               主操作      │
│ 外呼营销                         ├──────────────────────────────────────────┤
│ AI 客服                          │ 12 列内容网格，最大宽度 1440               │
│ 企业会议                         │                                          │
│ 客户与线索                       │ 表格、卡片、详情抽屉或实时工作区             │
│ 知识与术语                       │                                          │
│ 数据分析                         │                                          │
│ 合规与审计                       │                                          │
│ 企业设置                         │                                          │
└─────────────────────────────────┴──────────────────────────────────────────┘
```

- 当前租户固定显示在侧栏顶部，可切换时只列出当前账号的 active memberships。
- 环境徽标始终显示 `demo_only`、`trial` 或正式环境名称，避免把演示数据误认为生产数据。
- 角色只用于向用户解释当前视图；权限仍以 `/enterprise/v1/me` 返回 scopes 为准。
- 详情优先使用同页右侧抽屉；复杂编辑、实时客服和会议进入独立页面。

## 7. 通用组件

### 7.1 状态徽标

| 状态 | 视觉 | 文案示例 |
| --- | --- | --- |
| ready/active | 10% Primary 背景 + Primary 文字 | 已就绪、进行中 |
| processing/checking | Surface High + 旋转进度 | 处理中、检查中 |
| degraded | Tertiary 10% 背景 + Tertiary 文字 | 已降级 |
| not_configured/not_ready | Signal 10% 背景 + Signal 文字 | 未配置、未就绪 |
| paused/pending | Surface Highest + On Surface | 已暂停、待审批 |
| failed/denied | Error 10% 背景 + Error 文字 | 失败、已拒绝 |

### 7.2 列表与表格

- 表头 12px/600，正文 14px；行高默认 56px，密集审计表为 48px。
- 第一列是对象主字段；状态列不放在最右侧，保证扫描效率。
- 行点击打开详情，复选框只用于明确支持的批量动作。
- 空表格不显示一排无意义表头，改为带原因和权限判断的空状态。

### 7.3 表单

- 标签位于输入框上方；帮助说明和校验错误位于下方。
- 超过 8 个字段使用分步向导；活动创建固定为 6 步。
- 保存草稿与提交审批分开；提交审批后字段锁定并显示快照版本。
- 版本冲突不提供“强制覆盖”，刷新服务端版本后重新编辑。

### 7.4 反馈

- 页面级错误显示可行动原因、trace ID 和返回入口。
- 成功 Snackbar 只用于已经由服务端确认的同步动作。
- 异步动作使用页面内 job 卡或通知中心，不使用“提交成功”冒充外部完成。

## 8. 页面详细设计

### 8.1 工作台

首屏顺序：

1. 环境和 readiness 总览。
2. 当前角色可处理的待办。
3. 会议、客服、营销三条业务线的实时状态。
4. 用量与预算趋势。
5. 最近审计事件和服务告警。

readiness 卡必须把 PostgreSQL、PSTN、CRM、Calendar、LiveKit 和策略版本分别展示，不能合并成一个绿色“系统正常”。

当前 `ENT-UI-004` 首批实现只展示已有服务端契约可证明的 tenant/region、Provider capability、subscription、
budget、usage aggregate 和显式 session trace report。卡片沿用同一 Material Icons 注册表、1px outline、8px 圆角
和 Primary/Signal 语义；窄屏从四列收敛为两列和一列。PostgreSQL、LiveKit、策略版本以及会议/客服/营销汇总在服务端
接口交付前必须显示 not_ready 或不渲染，不能并入“系统正常”。无 usage/quality 样本不绘制趋势，无价格表不显示金额。

### 8.2 外呼营销

- 顶部：活动状态分段筛选、国家、负责人、日期和“新建活动”。
- 主表：活动、国家/语言、授权覆盖、策略版本、预算、任务状态、负责人。
- 详情页 Tab：概览、线索、话术与知识、合规校验、实时任务、结果分析、审计。
- 启动按钮只有 `campaign:approve` 且 readiness 全部通过时可用；否则显示缺失项，不显示假成功。

### 8.3 AI 客服坐席台

```text
┌──── 等待队列 280 ────┬──────── 实时会话 ────────┬── 客户与知识 340 ──┐
│ SLA / 语言 / 意图      │ 原文、译文、说话人、时间    │ 客户资料            │
│ 会话列表               │ 通话控制和接管状态          │ 订单/工单            │
│ claim 占用者           │ AI 已执行动作与风险          │ 知识建议与引用        │
└───────────────────────┴─────────────────────────┴────────────────────┘
```

- 接管是珊瑚色高关注操作；接管成功后 AI 发言控件立即禁用。
- 知识建议必须显示来源、版本和有效范围；无可信知识时明确“无法确认”。
- 客户敏感字段默认遮罩，按权限临时显示并写入审计。
- `ENT-CS-010` Web 代码候选复用企业壳、8px 圆角、Primary/Signal 颜色与 Material Icons：队列使用
  `inbox`，字幕使用 `closed_caption`，客户使用 `person`，知识使用 `menu_book`，AI 停止使用
  `voice_over_off`，静音/转组/结束使用 `mic_off/swap_horiz/call_end`，工单/回呼使用
  `confirmation_number/phone_callback`，不引入第二套图标。
- 桌面为 queue / conversation / context 三栏；1250px 以下客户上下文换到下一行，850px 以下单列，
  600px 以下控制按钮两列。等待项、SLA、租约、字幕修订、客户、知识引用、风险和历史均来自 API。
- 字幕标注为2.5秒服务端快照；没有字幕时可展示接管上下文，但必须写明“非实时字幕”。静音、转组、
  结束、工单和回呼在 Provider/API 未就绪时为 disabled 并带原因，不显示可点击的假入口。
- 接管后的绿色/Primary 状态只表示数据库已确认 AI run fence；物理媒体停止尚无 Worker 回执时，验收页
  必须继续区分“服务端停止栅栏”和“300ms内音频停止”。

### 8.4 企业会议

- 列表页区分即时会议、预约会议和已结束材料。
- 会议详情显示参会者、语言、录音/翻译授权、共享策略和材料状态。
- 创建区使用同一 Material 3 表单提供可选预约时间；即时会议使用 `add`，预约与日历卡使用 `event_outlined`，
  同步动作使用 `sync`，外部查看使用 `open_in_new` 或移动端 `content_copy`，不混用品牌外图标。
- 只有未来预约会议的主持人显示“企业日历”卡；卡片展示尚未同步、等待 Worker、已同步、失败四态和会议时长。
  Provider 未就绪时显示真实原因，不用本地日历事件或成功 toast 兜底；外部访客邀请与日历同步明确分开。
- Web 成功后可打开经服务端验证的 HTTPS Provider 链接；Flutter 在未引入受控外部跳转依赖前只复制该链接。
  客户端不接收 service-account 凭据、guest token、明文 outbox payload 或可覆盖的 Provider event ID。
- 会中布局支持画面优先、字幕优先、并排和移动端浮动字幕。
- 共享控制使用 `screen_share_outlined`；主持人强制停止显示共享者、generation 和影响说明。
- OCR 未启用或失败时保留原共享画面，不显示空白翻译层。
- “共享内容翻译”使用与现有会议卡片一致的 Material 3 卡片、`translate` 图标、状态 Chip、译文语言和
  原图/译图/双语选择。默认未开启；启用、应用设置和关闭均显示明确 busy 状态，不使用 toast 冒充服务端结果。
- `pending` 时说明只显示原共享；`not_configured/failed` 必须显示原因并明确“原共享画面和会议字幕继续可用”。
  Web 与 Flutter 均按视频 contain 后的真实内容矩形叠加块，letterbox、横屏和缩放不把坐标直接映射到整个容器。
- 双语块先原文后译文，译图只显示译文；原图模式不渲染 overlay。布局仅消费当前 participant/share generation/run 的
  服务端响应，旧 revision、跨目标或 participant 发送的数据包静默拒绝。访客与无活动共享时不显示入口。
- Web 访客页只显示品牌、邀请状态、设备检查、字幕和共享能力，不显示企业侧栏、tenant selector 或成员资料。
- 访客邀请只接受 fragment，地址清除失败显示无效；没有 guest session 时字幕和共享入口禁用并显示“尚未就绪”。
- 麦克风检查必须由用户点击，检查完成立即停止 track；Web 共享也必须由用户点击，浏览器返回实际共享来源后才申请
  租约，取得 grant 前不得向 RTC 发布。用户拒绝或来源不可识别时停止临时 track 且不建立租约。
- `ENT-MTG-005` 成员 Web 代码候选已经开放与现有 Material 3 风格一致的共享卡片、实际来源/质量/generation 状态、
  画面、开始/暂停/恢复/停止控件。观看端无有效当前代际轨道时显示“等待当前代际的视频轨道”，不复用迟到画面；
  撤销返回 `pending` 时显示“正在停止共享”并禁止重复开始，不得改写为已停止。访客共享仍保持未开放。
- 成员与访客在入会前可选择中文或英文字幕；连接后以服务端 grant 的 translation 状态为准。字幕卡只展示服务端定向 final 事件、说话人姓名和原文/译文标签，不生成示例文本。
- “请求译音”与字幕语言分开保存；定向 TTS 未就绪时必须说明“只保存偏好”，不能用一条全局音轨冒充个人译音。
- 会议结束后才显示会后材料入口；只有有权角色可以结束、生成修订、修正本次 speaker label、更新待办和发布。
  客户端只消费服务端冻结逐字稿，不以当前字幕缓存或示例内容补齐缺失材料。
- 材料标题显示 revision、源片段数量、draft/published 与 `processing|not_configured|ready|failed` 复核状态。
  未配置或失败时仍可查看逐字稿，但不显示伪造摘要、负责人、截止时间或成功徽标；发布按钮只在复核 ready 时启用。
- 每条结论和待办显示“片段 N”证据锚点；说话人修正明确标注“仅本次会议”，不污染成员目录。Web 与 Flutter
  统一使用 `article_outlined`、`subject_outlined`、`summarize_outlined`、`task_alt_outlined` 和 `publish_outlined`。

### 8.5 客户与线索

- 默认只展示业务所需字段，号码脱敏；授权、禁拨和撤回放在同一详情页。
- 导入向导先校验格式，再显示新增/更新/重复/错误计数，确认后才提交 job。
- 撤回授权后，页面立即显示对全部待任务的阻断影响。

### 8.6 知识与术语

- source、version、解析状态、发布状态和生效范围分列展示。
- 草稿、审核、发布和停用使用明确状态机；发布后只读查看快照。
- 术语包同时标注 ASR、翻译和 Agent 使用范围。
- `knowledge:read` 用户不显示发布按钮；直接调用仍由服务端拒绝。

### 8.7 数据分析

- 顶部筛选统一为时间、国家、业务线、语言和版本。
- 指标卡只展示 4 个核心指标，其余通过趋势和下钻表展示。
- 营销、客服、会议和成本不混合分母；每个图表显示统计口径。
- 无真实样本时显示“暂无数据”，不绘制虚假趋势。
- 当前 `ENT-UI-008` 只开放明确 session ID 的质量、Provider、usage/ledger 与 trace 下钻；业务聚合和货币价格接口未交付时展示 not_ready/not_configured，不渲染占位趋势或客户端估价。

### 8.8 合规与审计

- 策略版本、授权证据、操作事件和导出记录使用四个 Tab。
- 审计表显示时间、actor、操作、资源、结果、策略/知识版本和 trace ID。
- 导出需选择目的、范围和保留时间；任务完成后显示对象到期时间。
- 审计员只有只读和受控导出，不显示修改策略入口。
- 事件列表默认缩略 actor/resource 标识，详情才展示完整 trace；导出按钮仅向 `audit:export` 显示。
- 创建导出使用二次确认对话框，强制选择目的、半开时间范围和保留期限；processing/failed/expired 使用服务端 job 状态，下载前显示完整性校验过程，不展示对象 key 或存储凭据。

### 8.9 企业设置

- 二级导航：成员与角色、套餐与权益、区域与数据、Provider、保存期限、API 凭证。
- 成员列表显示姓名、邮箱、角色、状态、最后活跃和操作；角色编辑说明实际 scopes。
- `homeRegion` 只读；“申请迁移”进入受控任务，不能直接下拉修改。
- Provider 配置页只显示 capability 和脱敏 fingerprint，不回显密钥。

## 9. Flutter 企业入口

移动端不复制完整 Web 控制台，底部导航建议为：

```text
工作台 | 会议 | 接管 | 告警 | 我的
```

- “会议”只向有 `meeting:read` 的成员显示，“接管”只向有 `support:takeover` 的成员显示；隐藏入口不替代服务端 guard。
- 工作台只展示个人待办、会议、告警和用量，不提供批量导入和复杂策略编辑。
- 企业入口使用独立壳与 Material Icons outlined/filled 图标对，不把个人同传、Call Link 或 AI 代打直接映射为企业成功。
- 当前工作台和告警只显示 tenant/route/scope/Provider 服务端真值；企业会议列表与接管队列 API 未闭合前显示“尚未就绪”。
- 无会话、会话过期、401、离线、成员/租户/region/cell/route 不一致时不进入或恢复缓存工作区。
- 紧急接管和强制停止共享仍需服务端 scope，离线状态不提供乐观成功。
- iOS/Android 会议内使用与 Web 相同的 `mobile_screen_share_outlined` / `stop_screen_share_outlined` 图标语义和 Material 3 卡片；
  状态固定为未共享、等待系统确认、共享中、他人共享中、停止中和未就绪，不用绿色 toast 替代真实租约状态。
- 自动/流畅/高清通过带 `high_quality_outlined` 的单选表单呈现；开始后锁定画质选择。当前角色不允许、平台桥未配置、
  他人占用或撤销 pending 时禁用开始并显示原因。等待态统一提示在系统授权界面确认，不在共享前显示成功。
- iOS 当前通过系统广播选择器确认；Android 先显示通知权限和 MediaProjection 系统授权，授权后常驻低优先级前台通知。
  通知沿用 `screen_share` / `stop_screen_share` Material 图标，标题说明正在共享手机屏幕，正文明确“不包含系统音频”，
  停止操作始终可见。两端当前交付开始/停止和有权主持人的远端强停；暂停/恢复和系统音频在对应后续任务完成前
  不显示移动端入口。
- Web/Flutter 仅在服务端 context 含 `screen_share:stop`、用户已加入当前会议且当前 active/paused share 属于他人时
  显示珊瑚色“强制停止共享”。确认框必须展示目标 participant、generation 和“撤销旧发布权限”的影响；确认后
  disabled 防重复提交。服务端返回 revocation pending 时继续显示“停止中”，不恢复按钮、不显示成功 toast。
- Web 未占用共享时，在画质选择旁显示“共享系统音频”复选框和能力说明；用户勾选不等于成功，只有浏览器真实返回
  独立音轨且服务端 entitlement/grant 一致后，状态摘要才显示“含系统音频”。浏览器不支持时显示可行动错误，不回退为
  静默无声的成功状态。
- 远端系统音频使用 `volume_up_outlined` 语义、状态文字和原生 audio controls，自动播放被浏览器阻止时仍可手动播放；
  共享者只显示“已独立发布，本机不回放”，不创建本地 audio 播放节点。等待远端音轨时使用 `volume_off_outlined`，
  与视频等待态和当前 generation identity 一致。
- iOS/Android 不显示系统音频开关，通知继续明确“不包含系统音频”；真实 ReplayKit app-audio 或 Android
  AudioPlaybackCapture 管线和真机门禁完成前，不因 Web 已实现而扩大移动端能力声明。
- Web/Flutter 入会后显示“会议视图”布局组，统一使用 Material `dashboard_customize_outlined`、`slideshow_outlined`、
  `view_sidebar_outlined`、`subtitles_outlined`。画面优先、并排、字幕优先是同一组单选状态，Web 用 `aria-pressed`，
  Flutter 用 `ChoiceChip`；图标和文字都可见，不以颜色作为唯一选中提示。
- 并排只在 Web `>=960px`、Flutter 可用宽度 `>=840` 且文字缩放 `<=1.5` 时启用；其余自动纵向。Web 手机按钮在
  760px 以下三列、极窄宽度再单列；Flutter 使用 Wrap。横屏低高度限制画面与字幕区高度并允许字幕内部滚动，停止、
  麦克风和离会操作仍在正常文档流，不用 overlay 遮挡。
- 远端画面空缺、暂停或尚未订阅时显示深色“正在等待共享画面”占位；Web/Flutter renderer 必须保留 SDK adaptive
  registration，不能为了复用普通 video/Image 组件丢失可见性和尺寸反馈。
- 会议 ended 后，Flutter 会议卡使用与 Web 相同的材料状态、证据和 Material 图标；生成请求允许较长有界超时，
  但超时或 Provider 未配置只显示服务端降级原因，不从本地字幕拼接纪要。结束会议前必须先离开当前 Room。

## 10. 响应式与无障碍

- `>= 1280px`：完整侧栏和宽屏内容网格；已实现页面最多四列真值卡片，业务三栏在对应业务页交付后启用。
- `960–1279px`：完整侧栏；内容网格按页面断点收敛，横向数据区保留自身滚动，不推动页面宽度。
- `600–959px`：72px 折叠侧栏，租户切换移到顶部栏；页面卡片收敛为两列或一列，600px 登录页已切为单栏。
- `< 600px`：主导航变为底部可横向滚动入口并保留图标和文字；顶部栏只保留租户与主题，页面动作、表单和卡片单列重排。
- 主题选择提供“跟随系统/浅色/深色”，保存在浏览器本地偏好中；跟随系统时监听 `prefers-color-scheme`，不改变服务端 tenant 或账号配置。
- 横向表格和设置导航使用带名称的可聚焦 region；键盘用户可进入后滚动查看，表格提供隐藏 caption。
- 壳提供“跳至主要内容”，路由切换后把焦点移到页面主区域；焦点环不得被卡片 overflow 裁切。
- 正文与背景对比度满足 WCAG AA；键盘焦点使用 2px Primary 外框。
- 支持 200% 缩放、动态字体、`prefers-reduced-motion`、`prefers-contrast: more` 和 forced colors；状态动画不作为唯一反馈。
- 禁止用全局 `overflow-x: hidden` 掩盖溢出；真正需要横向空间的表格/导航必须在自身容器滚动。

## 11. 权限与页面状态验收矩阵

每个页面至少验证：

1. 有 scope、有数据、ready。
2. 有 scope、empty。
3. 有 scope、Provider `not_configured`。
4. 有 scope、`degraded`。
5. 无 scope、直接访问 URL。
6. 资源跨租户或不存在。
7. 版本冲突。
8. 异步 processing、失败和重试。
9. entitlement/预算不足。
10. 深色模式、窄屏和键盘操作。

前端快照和 E2E 只验证展示逻辑；越权拒绝必须继续由角色×scope×资源 API 测试覆盖。

## 12. 原型与实现边界

设计评审原型应包含工作台、外呼活动、客服坐席台、企业会议、知识、审计和成员设置，并使用同一导航、颜色、圆角和 Material Icons。原型数据必须标注“设计示例”。

`ENT-CORE-003` 负责真实 Web 壳、登录会话、路由和生产构建，`ENT-UI-001` 负责生产令牌与 Material Icons 注册表，两项现已进入 `ready_for_acceptance`。`ENT-UI-002` 已实现 active membership 切换、共享 scope 真值、九角色导航和直接/嵌套路由 guard；`ENT-UI-003` 已实现 loading、empty、not_ready、degraded、forbidden、conflict、processing、failed 八态注册表、ARIA 语义、trace ID 与行动入口。`ENT-UI-009` 已形成响应式、主题、动态字号和键盘语义代码候选；`ENT-UI-010` 已定义三浏览器引擎、角色×路由、五档宽度、双主题、键盘、axe、视觉和 bundle/遥测门禁；`ENT-UI-011` 已形成重新校验企业上下文、scope-aware 五入口和失败闭合的 Flutter 代码候选；`ENT-UI-012` 已形成 AuthProvider 隔离、fragment 凭据清理、设备检查和明确 not_ready 的 Web 访客壳。后四项及 MTG-001..011 因未运行完整 migration、浏览器/Flutter test、token/CAS/evidence 攻击、设备权限、动态字体、键盘、axe、视觉回归、真实 Provider 或真机矩阵，仍保持 `in_progress`。本文、未执行的自动化定义、静态原型和静态检查本身仍不能作为生产验收证据。
