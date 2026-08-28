# 无界AI V1 产品化状态

校准时间：2026-08-24 03:07 CST

目标：国内 iOS `core_translation` 受邀私测。本文替代旧矩阵中的单列“已完成”口径；
历史文档继续保留，但不得覆盖本文和 `PROGRESS_LOG.md` 的较新证据。

## 2026-08-27 增量状态

- Code：`cf9da79` 已补齐候选部署身份闭环。部署只接受干净 checkout；构建后写入
  candidate/commit/tree/image/config 指纹和不含密钥的 manifest；`status` 要求 Gateway 身份与 manifest
  逐字段一致。`bash -n`、定向 9 项及完整 scripts `104 files / 383 tests` 通过。
- Runtime 诊断：已恢复 Qwen3-ASR-1.7B + MarbleNet、Hy-MT2、VoxCPM2 与 CPU Sortformer；旧
  `d4f154b` 容器上的真实尾句 smoke `1/1`、诊断尾句 `10/10` 和双说话人 `2 speakers / 2 turns`
  通过。尾句 10 轮结束延迟 P50 `317 ms`、P95/最大 `334 ms`；双说话人边界确认 `800 ms`，
  103 帧零丢帧。
- 上述 Runtime 结果只证明冻结模型组合与旧容器可工作。V1 合同仍因旧 Gateway 未暴露 traceable
  runtime identity 判定 `sessionReady=false / releaseReady=false`，不得记为最终候选通过。
- 最终隔离候选仍被私有 `release/domestic/release.env` 缺失硬门阻断；现有 2026-07-21 私有 env
  不具备当前 SMS、诊断告警、支付签名、公开 HTTPS/Redis 等真实配置，不能用占位值补齐。
- 正式 100 次尾句、30 分钟/100 段、最新 iOS 安装和 Call Link 真人媒体仍未运行。HEAD 已变为
  `cf9da79`，因此 `d236e13` iOS build 只保留历史证据，后续必须从最新干净 HEAD 重建。

### 2026-08-27 13:51 runtime acceptance 更新

- 已从干净`cf9da79`/tree `4ee1417`构建隔离候选
  `wujie-core-cf9da794f8fc-20260827T0530Z`；image=
  `sha256:6769c672c4d34325aadccad1d161c502cea3298e868aa6d42aae30a6498dbbbc`，config=
  `909dd1bfc60c40fe3fc388106069d03ed9015c794becb49588255f98918b952b`，container restart/OOM=`0/false`。
- 候选属于`isolated_runtime_acceptance`且`releaseAuthorized=false`。它复用既有私有core密钥，但仍是
  `NODE_ENV=development / API_TEST_AUTO_ACCOUNT=true`；不得把V1 runtime probe中的`releaseReady=true`
  解释成商业发布环境通过。
- V1 runtime contract在100轮前后均逐字段通过：API/Gateway/Qwen+MarbleNet/Hy-MT2/VoxCPM2/Sortformer
  全部`ok=true`，Gateway五字段身份`traceable=true`。
- 候选smoke1=`1/1`，结束回填`316 ms`。随后从iteration 1独立运行正式runtime尾句门：`100/100`通过、
  100个唯一session、100条原文和100条译文、错误/降级flush=`0/0`；P50=`298 ms`、P95=`316 ms`、
  最大=`348 ms`。完整证据SHA=`4c7579007eae6e8685611ec339eb4d68092106ad895d4a284b29d8ccbecfdd9a`。
- 首次启动因旧env要求LLM prewarm且18081/1234未运行而失败闭合；失败证据已保留。按V1合同和实时主线策略，
  acceptance候选显式关闭`LLM_REFINEMENT_ENABLED/LLM_REVIEW_ENABLED`后稳定运行，没有额外加载11GB LLM。
- 下一门现在是30分钟/至少100段长稳；之后才重建最新iOS candidate。商业发布仍被真实release.env、依赖安全
  （本次最终镜像npm audit为5 high/11 moderate）、SMS/告警/公开入口和Call Link真人媒体阻断。

### 2026-08-28 10:55 runtime acceptance 最终状态

- 产品candidate升级为`a4ed4d7`：修复1800秒硬上限与长稳门假阳性，隔离验收配置签发2100秒会话；image=
  `sha256:80a8b3a4f1eefd027a50f9fc04f54e0128e51da037209eecbc446f27effbf471`，config=
  `dcc561ca07e99bd879fb895aa2713812e44590a67fc976d71e6b0e0c78c53f33`，restart/OOM=`0/false`。
- 新candidate的V1 contract、smoke1、从0独立100轮均通过；100轮P50/P95/max=`300/426/696ms`，100/100译文闭环。
- 最终30分钟使用Beelink本地持久runner完成：server/client duration=`1819829/1819803ms`，sent/received=
  `22705/22705`，266段全部有译文，drop/event error=`0/0`，end reason=`client_request`，frame/translation
  coverage=`1.0/1.0`。
- 原runner因把flush=`empty`误判失败而exit 2；合同源码明确`empty`仅在没有未解决segment且audio/provider flush成功时产生。
  evaluator提交`3064fd3`新增`completed|lossless empty`通过、`degraded/unresolved`拒绝的测试，scripts=
  `104 files / 386 tests`。原始exit 2和raw JSON不改，独立adjudication将本门判为`passed_adjudicated`。
- post-long V1 contract继续6/6通过，candidate日志中429/provider unavailable/backpressure drop/critical exit/finalization
  failure均为0；旧cf9 candidate已stop并保留容器/目录/镜像作回滚。
- 最终runtime acceptance总证据SHA=
  `1f26643d84ed3d4ee13a9ddf3446459a1798d5b58adbcda88dd3718e519b33e1`。它仍明确
  `releaseAuthorized=false`；商业发布与Device E2E不能由runtime门替代。

## 状态口径

| 层级 | 完成定义 |
| --- | --- |
| Code | 代码、自动化、静态合同和独立提交通过 |
| Runtime | 指定镜像、配置、模型 fingerprint 和真实请求通过 |
| Device E2E | 指定 App candidate 与同一 Runtime 完成真机旅程 |
| Release | 可靠性、容量、公开入口、隐私、发布配置和回滚全部通过 |

任一层不能替代下一层。隔离模型评测、HTTP 200、历史真机截图或旧候选不能证明当前候选完成。

## 当前矩阵

| 能力 | Code | Runtime | Device E2E | Release | 当前证据/缺口 |
| --- | --- | --- | --- | --- | --- |
| V1 产品范围与延期边界 | accepted | 不适用 | 不适用 | accepted | `core_translation` 保留同传、聆听、Call Link Beta、记录、扫描、输入朗读；PSTN/Agent/支付/实名声纹隐藏 |
| WIP 拆分与提交边界 | accepted | 不适用 | 不适用 | conditional | 485个非outputs WIP文件已拆为43个功能提交并全量回归；旧依赖diff由安全基线替代并保留可恢复stash，文档随本批收口后工作树仅保留outputs |
| 模型选择与 active routing | accepted | accepted_runtime_candidate | pending | pending | traceable acceptance候选实装Qwen1.7+MarbleNet/Hy-MT2/VoxCPM2/Sortformer；100轮前后身份不漂移 |
| Gateway 活依赖 readiness | accepted | accepted_runtime_candidate | pending | pending | V1合同前后均6/6服务通过，100轮中provider_unavailable/429均为0 |
| Gateway runtime identity | accepted | accepted_runtime_candidate | pending | pending | candidate/commit/tree/image/config与0600 manifest一致，traceable=true；商业release env仍独立未过 |
| 依赖安全与可重复安装 | accepted | passed_local | 不适用 | pending | 已采用验证过的安全lockfile并补齐直接依赖；npm ci/audit=0、dependency gate ready、LiveKit compatibility通过；当前HEAD镜像尚未重建 |
| 同步 LLM 与实时主线隔离 | accepted | accepted_runtime_candidate | pending | pending | acceptance候选关闭LLM refinement/review，raw→Hy-MT2不等待；首次强制prewarm失败证据保留 |
| 结束/flush尾句 | accepted | passed_100_of_100 | p0_device_passed | pending | 实体iPhone最后一段已保存和翻译，end/finalize均200；本次相邻词差异按声学回放备注关闭，不影响flush通过 |
| Finalization outbox恢复 | accepted | 不适用 | installed_passed | pending | build 2026082802真实迁移旧v1任务：404仅1次、pending 0、quarantine保留7段；新会话332ms发起/434ms ready，连续301秒无重试 |
| 前台弱网重连 | accepted | 不适用 | previous_candidate_passed_build_2026082805 | pending | build2805同一session经8秒3421故障后先补传24帧/2.4秒，13.6秒漏传完整可见；当前HEAD已新增默认关闭能力，须重建后抽检 |
| 30分钟/100段长稳 | accepted_harness | passed_adjudicated | pending | pending | 30m19.829s、22705/22705帧、266/266译文、drop/error=0；lossless empty flush按合同独立裁决通过 |
| Qwen1.7 + MarbleNet | accepted_selection | passed_runtime_candidate | p0_device_passed_with_acoustic_note | pending | 实体iPhone 9/9 case有输出、1307帧零drop、VAD max 0.999；两条回放文本差异按用户决策为non-blocking/no-fix |
| Hy-MT2 | accepted | passed | pending | pending | 真实翻译与故障恢复通过；公开HTTPS/容量仍缺 |
| VoxCPM2 | accepted | passed | historical_device_only | pending | 真实HTTP首音频670ms、24k PCM16；当前候选真机朗读尚未验收 |
| Sortformer匿名说话人 | accepted_provisional | passed_before_stop | p0_natural_two_speaker_passed | pending | AliMeeting真实双人A→B→A：2人、2边界、speaker_1复用、19段unknown/overlap=0；合成音异常降级为声学备注。多人/快速轮换仍是独立门 |
| iOS core_translation产品面 | accepted | 不适用 | previous_candidate_p0_conditional | pending | build2805已完成实体同传、结束/记录、outbox、双人speaker和弱网；当前HEAD未构建安装，仍缺聆听与Call Link |
| iOS可追溯身份 | accepted | 不适用 | previous_build_installed_current_head_pending | pending | `wujie-ios-a462d50-core-2026082805`仍在iPhone；当前源码已前进43个WIP收口提交，必须生成新commit/tree/build/manifest候选 |
| 记录/扫描/VoiceOver | accepted_existing | API依赖 | current_history_passed | conditional | 当前candidate历史列表显示13:17会话/2分12秒/2人，详情11段且搜索命中尾句；扫描/VoiceOver沿用既有证据，仍需最终发布抽检 |
| Call Link Beta | code_ready | conditional | pending | pending | 核心profile保留入口；真人Host/Guest媒体与微信/Safari矩阵未完成 |
| 账号/隐私/注销 | code_ready | conditional | pending | pending | 首启同意、导出/注销代码存在；真实SMS和最终文案/渠道审核未完成 |
| 国内发布总门 | partial | not_ready | pending | not_ready | core profile已延期PSTN/Agent/Egress；仍缺release.env、公开服务身份、Call Link媒体等 |

`previously_passed` 只表示指定旧候选曾通过，不能作为当前运行态。`failed_interrupted` 保留完整失败证据，
不得删除或改写为通过。

## 已通过的当前代码门

- Realtime Gateway：53 files / 221 tests。
- Translation Worker：54 files / 218 tests。
- Flutter：471 tests，analyze 0。
- 全 workspace typecheck。
- 模型 selection readiness。
- 模型 routing readiness，且 active route 与独立 V1 runtime contract 一致。
- 可追溯 iOS Profile 构建、codesign、签名Info.plist和App聚合SHA方案。

## 当前发布阻塞

1. 从最新HEAD重建并安装`core_translation` iOS candidate，复核默认关闭的新能力，并完成聆听与Call Link真机门。
2. 配置私有0600 `release/domestic/release.env`；密钥不得提交，runtime acceptance env不得冒充商业发布env。
3. 完成Call Link真人双端媒体；PSTN/Agent/Egress继续延期，不阻塞core私测。
4. 公开商用发布另需正式域名、TLS、容量/成本、真实SMS、告警和渠道/隐私审核；不与私测完成混写。

## 下一次远端执行顺序

1. 实时探测SSH/GPU/容器/unit并建立新回滚快照。
2. 使用现有`core_translation`候选部署合同，关闭PSTN/Agent/Voice Agent/Air780扩展面。
3. 启动Qwen1.7/MarbleNet、Hy-MT2、VoxCPM2和CPU Sortformer，核对精确fingerprint。
4. 部署带runtime identity的traceable镜像；Gateway和总manifest逐字段一致。
5. 1次smoke → 100次尾句 → 30分钟/100段，中途任何外部stop则整门作废并保留证据。
6. 两门通过后重建最新iOS candidate，再进入安装和真机E2E。

### 2026-08-28 12:44 Device E2E增量

- iPhone Tailscale与candidate网络已实证通过：手机Safari访问3420 `/health`为HTTP 200；App随后成功创建会话并连接3421，
  3904帧上行、0 drop，说明安装候选的API/WebSocket连接成立。
- iPhone Mirroring不提供iPhone microphone/camera access（Apple官方限制），镜像会话实际为近静音：MarbleNet
  `2143 analyzed / 0 speech`、max probability `0.00386`、0段。该结果只证明UI与连接，不构成ASR媒体证据。
- 实体同传、固定参考音频、尾段flush、历史回填、真实双人speaker和弱网重连已经完成；聆听与Call Link仍待当前候选真机验收。
- 旧finalization outbox对不存在session每15秒404的问题已由commit `53786ce`修复并实装build `2026082802`：
  真实v1沙盒迁移后404仅1次，pending 0、quarantine保留7段，连续301秒无重试；新会话332ms发起、434ms ready。

### 2026-08-28 13:22 实体iPhone同传P0结果

- 实体iPhone session=`8c7cc5c1-952f-4286-a33a-7786b307780e`完成固定`p0-smoke.m4a`：9/9 case有字幕，
  自动切换拆成11段且译文11/11；1307帧、drop=0，MarbleNet max probability=0.999，candidate及6个端点保持健康。
- 尾段存在历史、end/finalize均HTTP 200，证明真机媒体和尾段完整性通过。本次`A-120→R 一二零`及尾句相邻词差异
  按用户决策归为声学回放备注，non-blocking/no-fix，不触发术语、提示词、LLM或模型调整。
- Sortformer最终人数2且边界4次，无provider error；`Nice to meet you`仍误标unknown/overlap。speaker回退仍待处理；
  旧outbox 404已由build 2026082802修复，弱网、聆听、Call Link仍是后续独立门。
- 13:27重新连接Mirroring完成历史UI核验：列表首项为本session（13:17、2分12秒、2人），详情明确`共11段`；搜索尾段
  唯一词命中1/11并显示原文/译文。当前candidate的记录列表、详情和尾段持久化均通过。
- 14:03安装build `2026082802`并完成旧outbox真机迁移门；总证据SHA=
  `ed91689c2a383f9e1bf30139bc11b705ead5e205be39dc39fa62548dc267ff99`。该P0已从阻塞项移除；剩余只保留
  speaker回退、弱网/聆听/Call Link门，两条声学文本差异不再列修复项。
- 14:35使用AliMeeting真实自然双人固定素材完成speaker门：19段按`speaker_1×6→speaker_2×5→speaker_1×8`，2人/
  2边界、unknown/overlap=0、A槽位复用、drop=0；证据SHA=
  `cfd5896a6f3f4e6798591943b310e91377a63822a8eaf3adde2a78bbd999a19e`。合成音unknown/overlap改为
  non-blocking/no-fix；当前core Device E2E剩余弱网、聆听和Call Link。
- 15:43 build `2026082804`证明同session重连和24帧/2.4秒补传成立，但真机顶部把12.0秒漏传信息截成省略号；其
  transport/buffer通过、gap visibility失败，修正后的证据SHA=`c8290a42d215cce979d44949412c87ad35fa7c904af7f39a0d31a6fcbc0a99c8`。
- 16:04 build `2026082805`完成最终弱网门：session `f91ed34e-cc52-4e02-a74d-06ab16e76bcd`在相同8秒3421故障后
  保持同一ID，先补传sequence 349–372共24帧/2.4秒，再从373继续；顶部完整显示
  `已恢复·补2.4秒·漏传13.6秒`，无省略号。结束/finalize=`200/200`、outbox pending=0、临时nft表已删除、六端点健康；
  证据SHA=`6a0fbc7c062e59eec59964a835a431ddd5bb34c47c8a3a0186884e4af8eb649b`。弱网门移入passed，当前core
  Device E2E只剩聆听与Call Link。

### 2026-08-28 17:17 既有 WIP 收口

- 从冻结基线的混合 WIP 中重新盘点出222个tracked修改和263个非`outputs/`新文件；按 Contracts、PostgreSQL、
  Provider Operation、Air780固件/设备/媒体、Call Link、Agent Work/ownership/delivery、Translation Worker、
  Voice Runtime、Mobile、ASR、Realtime、容器/部署工具分成43个功能提交。代码收口点=`319646a`；未push。
- 旧依赖WIP使用低于已验证安全分支的LiveKit/Fastify/RTC版本，没有直接提交。13个精确文件先保存为可恢复stash，随后采用
  已验证安全提交并只补FFI/WebSocket等源码直接依赖。`npm ci`、audit和dependency gate均为0漏洞，LiveKit
  compatibility通过。
- 行数门首次发现7个超过350行文件，没有调高阈值；通过delegate/transport/test/runtime/helper拆分后全部清零。
- 首轮根级测试唯一失败为typed translation control幂等重放偶发500。根因是首次outbox窗口使用路由时钟，重放使用
  持久化`operation.startedAt`；1ms漂移触发payload conflict。现统一使用持久时间真值，路由连续20轮及API
  `183 files / 665 tests`通过。
- 最终完整门：Node=`488 files / 1899 tests`、Flutter=`487/487`、ASR=`105/105`，全workspace typecheck、
  lint/350行、Flutter analyze、PostgreSQL cutover和secret字面扫描均通过。该结论是源码自动化，不代表当前HEAD已构建、
  部署、迁移或完成现场通话。
- `outputs/`始终未读取、修改、暂存或提交。当前iPhone仍是build `2026082805`，对应较早的`a462d50`；下一步必须从
  最新HEAD构建新的traceable core candidate，再继续聆听和Call Link真机门。
