# 无界AI V1 产品化状态

校准时间：2026-08-24 03:07 CST

目标：国内 iOS `core_translation` 受邀私测。本文替代旧矩阵中的单列“已完成”口径；
历史文档继续保留，但不得覆盖本文和 `PROGRESS_LOG.md` 的较新证据。

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
| WIP 拆分与提交边界 | accepted | 不适用 | 不适用 | conditional | 672条路径已归属；产品化提交独立，既有大WIP仍需其他车道继续拆分 |
| 模型选择与 active routing | accepted | conditional | pending | pending | 静态选择/路由已统一为Qwen1.7+MarbleNet/Hy-MT2/VoxCPM2/Sortformer；当前远端被外部切回SenseVoice |
| Gateway 活依赖 readiness | accepted | previously_passed | pending | pending | ASR/MT阻断新会话，Speaker/TTS降级，真实Hy-MT2故障注入通过；当前容器停止 |
| Gateway runtime identity | accepted | pending | pending | pending | health/release gate已要求candidate/commit/tree/image/config；尚未部署带完整身份的最终镜像 |
| 同步 LLM 与实时主线隔离 | accepted | previously_passed | pending | pending | Realtime同步revision关闭，raw→Hy-MT2不等待；Agent prewarm独立10秒；需最终候选复验 |
| 结束/flush尾句 | accepted | failed_interrupted | pending | pending | 旧429容量竞态已修；第二轮前89次通过，随后被LAN任务显式停服，必须从0重跑100次 |
| 30分钟/100段长稳 | accepted_harness | not_run | not_run | pending | 可靠性工具已完成；必须在100次尾句完整通过后运行 |
| Qwen1.7 + MarbleNet | accepted_selection | previously_passed | pending | pending | 0.22/2048/1seq在共享GPU可启动；最终100次/长稳和真机尚缺 |
| Hy-MT2 | accepted | passed | pending | pending | 真实翻译与故障恢复通过；公开HTTPS/容量仍缺 |
| VoxCPM2 | accepted | passed | historical_device_only | pending | 真实HTTP首音频670ms、24k PCM16；当前候选真机朗读尚未验收 |
| Sortformer匿名说话人 | accepted_provisional | passed_before_stop | pending | pending | 真实双人两turn、boundary800ms通过；快速轮换/长稳仍是独立门，失败不得拖垮字幕 |
| iOS core_translation产品面 | accepted | 不适用 | build_only | pending | 未验收商业入口已隐藏；最新代码需重建最终candidate并安装 |
| iOS可追溯身份 | accepted | 不适用 | build_passed_not_installed | pending | 已证明签名Info.plist与manifest方案；最终candidate必须来自最新HEAD并重新构建 |
| 记录/扫描/VoiceOver | accepted_existing | API依赖 | historical_passed | conditional | 既有自动化/真机证据保留；最终candidate需做核心旅程抽检 |
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

1. 需要至少45分钟不被其他SSH任务停止的Beelink连续窗口。
2. 从0完成100次真实尾句；不得拼接前89次结果。
3. 完成30分钟、至少100段、零丢帧长稳。
4. 部署包含完整runtime identity的最终core候选并生成总manifest。
5. 从最新HEAD重建并安装`core_translation` iOS candidate，完成同传、聆听、记录、扫描和结束真机抽检。
6. 配置私有0600 `release/domestic/release.env`；密钥不得提交。
7. 完成Call Link真人双端媒体；PSTN/Agent/Egress继续延期，不阻塞core私测。
8. 公开商用发布另需正式域名、TLS、容量/成本、真实SMS、告警和渠道/隐私审核；不与私测完成混写。

## 下一次远端执行顺序

1. 实时探测SSH/GPU/容器/unit并建立新回滚快照。
2. 使用现有`core_translation`候选部署合同，关闭PSTN/Agent/Voice Agent/Air780扩展面。
3. 启动Qwen1.7/MarbleNet、Hy-MT2、VoxCPM2和CPU Sortformer，核对精确fingerprint。
4. 部署带runtime identity的traceable镜像；Gateway和总manifest逐字段一致。
5. 1次smoke → 100次尾句 → 30分钟/100段，中途任何外部stop则整门作废并保留证据。
6. 两门通过后重建最新iOS candidate，再进入安装和真机E2E。
