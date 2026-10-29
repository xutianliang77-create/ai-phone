# 1.0 手机业务与订阅控制（本地候选）

此服务只处理 Apple 账号、设备注册、订阅权益、本机短许可和不含正文的设备统计。ASR、翻译、TTS、OCR、记录及内容导出在手机；Worker 没有模型、音频 WebSocket、处理 API 或历史队列入口。当前只是 SOURCE/HOST 候选，没有部署或真实 Apple/设备资格。

## 商业与授权

- 唯一新商品为 Apple 自动续期月订阅：中国商店人民币10元/月，一周 introductory free trial。先由用户确认 Apple 订阅，合格者才试用；不另发本地/后台7天试用。实际商品与优惠资格尚待核验。
- StoreKit 原生桥检查真实商品类型、币种、价格、月周期与优惠，再打开系统购买界面。先准备系统语言资源。原生已验证交易经注册设备私钥绑定到账号后发送控制面；未收到持久化回执不 finish。监听未完成交易并在账号与网络可用时重试同步；等待 Apple 审批或交易未结算期间不允许重复购买。Apple 拒绝请求时可能没有交易通知，用户确认已拒绝后才可核验已有交易并清除等待标记，不会自动购买；误判的旧请求仍可能随后获批。
- 签名交易的 price 为 milliunits，10元是10000；UI和商品契约的 minor CNY 为1000。期限以 Apple 验证时间为准，不按手机日历、固定30天或使用分钟计算。
- 原始交易链固定归属一个账号；缺 appAccountToken 的历史恢复必须有原生当前权益证明。旧商品/旧合法购买的实际兼容资格另行核对，不恢复无证据的测试余额。
- 新许可前核对 Apple 的订阅状态。API只读 GET，固定 Apple 域名、无跟随重定向、最多一次有界重连；与登录密钥、许可签名密钥分开。状态缓存最多60秒；只有 Apple 已签名且状态新鲜的宽限期可用，未知状态及普通扣费重试不给宽限。取消续订保留已验证有效期，退款/撤销不复活旧权益。
- 验证签名与固定根证书后检查证书链撤销状态：仅向固定 Apple OCSP 域名发证书状态请求，设置超时和大小上限，校验签名、证书绑定、用途与响应时效；未知、过期或不可用均不发放新权益。缓存不超过60秒及 OCSP 响应截止。实际 Apple 证书、网络和 Cloudflare 线上运行仍待验证。
- 最长30分钟设备许可，截短到订阅、登录和批准的QA窗口更早截止。ES256、公钥固定在App，私钥仅服务端；请求为已注册设备私钥签名，包含用途、owner、deployment、启动nonce、请求nonce和版本。
- 原生按单调时钟和**原请求发送点**计时；重试回包不重新起算30分钟。续签替换同一逻辑许可的版本，失败不延长旧截止；过期期间停止业务，再收到合法原请求回执也保留其原计时锚点。
- 正常结束一次本机会话不会注销仍有效的会员短许可。到期、退出/切账号时保存仅含元数据的签名停止统计；统计为手机报告、按许可/版本幂等，不收费，也不声称是服务端直接观测或物理模型停机证据。旧版本停止收据不能关闭新版本。统计补传失败不阻止合法订阅继续核验授权。

## 入口

| 路径 | 用途 |
| --- | --- |
| `/auth/deployment` | 新 deployment、on_device 和 v10-device-license-v1 身份 |
| `/auth/apple/request`、`/auth/apple/login`、`/auth/logout` | 复用纯 Apple 账号基础 |
| `/account/me`、`/account/consents`、`/account/export`、`/account/delete` | 仅控制面元数据与注销；注销丢包可定向读取既有回执 |
| `/billing/products`、`/billing/entitlement`、`/billing/ledger` | 新月订阅元数据、期限权益与事件 |
| `/billing/subscription/sync`、`/billing/apple/notifications` | 验签交易/通知与唯一权益效果 |
| `/v10/device/configuration`、`/challenge`、`/register` | 组件契约和 App Attest 注册 |
| `/v10/device/acquire`、`/renew`、`/resolve` | 签发/替换/原请求恢复或取消墓碑 |
| `/v10/device/close` | 仅手机统计回传；不扣分钟 |
| `/privacy`、`/terms`、`/support`、`/permissions`、`/providers` | 与App同源文档草案，批准后才能公开 |

正文、图片、音频、提示词、模型路径及旧处理端点不属于本契约。旧 `/usage/balance`、`/translate`、`/realtime/sessions`、`/v10/control/*` 和 `/voice-presets` 不可用。

## 配置和故障边界

没有真实SKU、三种独立签名用途、IAP根证书、匹配的App Attest和明确准入时保持关闭。QA还要求绝对有界窗口与测试owner白名单；不能靠匹配的源码哈希取消QA时间边界。部署身份必须为新的 `wujie-v10-device-*`，不恢复旧资源。

App 原生 Info 配置为 `WujieExecutionMode`、`WujiePublicDeploymentId`、`WujieAppAttestEnvironment`、`WujieV10LicenseKeys`（kid→base64 x963公钥）及 `WujieV10SubscriptionProductId`。它们必须和 Dart/Worker 的同一候选相符；本地测试密钥和 fixture SKU 不得晋级。

系统资源由iOS管理；仅真实installed可就绪。识别实现需要iOS26；自动模式共用一次采音，由中英两个SpeechTranscriber候选及VAD/模型时间轴裁决。缺置信度、接近分数或缺少一条实际完成水印时不猜测；两秒内缺证据则停止。不绕过系统并行资源限制。自动模式已接入，真实置信度可用性、质量、延迟与能耗仍未实机签收，不能据此放行正式发布。

新账号注销请求会登记独立的 1.0 撤销任务，只重试该账号、该次请求的 Apple 撤销事件，租约和次数均有界，不扫描或重启旧财务队列。撤销成功进入 `needs_finalization`，不是账号清除完成；缺 Apple 凭据或多次失败分别进入人工处置状态。账号身份清除、必要账务保留范围、重新注册后的订阅归属和完成通知仍未闭环，正式发布前必须完成。定时触发器和 `0012` 迁移属于待批准部署，不因本地代码存在而视作线上启用。

## 本地证据

本轮证据位于工作区 `artifacts/v10-on-device-p1-p2-20261027/`。Vitest 使用 SQLite/合成证书；Swift守卫使用真实 CryptoKit 与合成签名；`local-worker-runtime.mjs` 运行精确 Worker 本地入口、临时D1和强制模拟Apple出站，并拒绝其他出站。其设备登记为明确的 synthetic seed，不是实际 App Attest。

迁移仅在临时本地库运行。现有账号/事务基础兼容表仍在，但新服务不销售分钟、不调用余额授额或预占。OCSP 使用锁定的 PKI.js 3.4.0 和 asn1js 3.0.6；构建必须使用 `scripts/build-worker.mjs` 的 browser/module 解析，普通 Node/CJS 打包在 workerd 会失败。没有部署或安装远端服务。

真实商品配置、证书/密钥、关闭部署、手机资源准备、沙盒购买、安装、完整实测和发布仍须后续精确授权。未执行的步骤不算本地通过的延伸。
