# LiveKit 与当前接入安全审计

版本：v1.0
日期：2026-07-17
范围：LiveKit Server、SIP、Agents、Node/Flutter SDK、当前产品接入和自托管部署。

## 1. 总体判断

LiveKit 可以作为产品媒体和 Agent 调度底座，但不能按默认权限和示例部署直接
上线。当前项目存在数个需要在接入 SIP/Agent 前关闭的 P0 风险。

本审计不是第三方渗透测试，也不替代上线前的 SAST、SCA、镜像扫描和外部安全测试。

## 2. 已确认的安全基础

- JWT 只允许 HS256，校验 issuer、签名、有效期并带 1 分钟时钟容差。
- Room、SIP 和 Agent 服务按 grant 检查权限。
- LiveKit webhook 使用短期 JWT + body SHA-256 校验。
- TURN 对私网、loopback、multicast 等 peer 默认拒绝，可配置 allow/deny CIDR。
- Flutter SDK 支持媒体轨和数据通道 E2EE。
- LiveKit 对 metadata、attributes 和 data blob 有大小限制。
- 当前产品 Node 生产依赖 `npm audit --omit=dev` 为 0 个已知漏洞。
- GitHub API 未发现 `livekit/livekit`、`livekit/sip`、`livekit/agents`
  已发布的仓库级 Security Advisory。

## 3. P0 发现

### SEC-LK-001 客户端可伪造字幕和状态

当前 token 只设置 `canPublish=true`，没有设置 `canPublishData=false`。LiveKit
源码中 `canPublishData` 未设置时继承 `canPublish`，因此 host/guest 可以向
data channel 发布消息。

Flutter 当前处理 `DataReceivedEvent` 时只解析 payload，没有验证：

- topic 是否为 `translation.captions`
- sender participant identity
- sender kind/role
- server event signature

影响：房间中的恶意 Guest 可以伪造字幕、Worker 状态、降级提示或 TTS ready。

修复：

1. 使用 `livekit-server-sdk` 的 `AccessToken` 生成 token，停止手写 JWT。
2. host/guest/worker token 显式 `canPublishData=false`。
3. host/guest 只允许 `canPublishSources=["microphone"]`。
4. Worker TTS 只允许发布指定 audio source/track naming。
5. App/Web 只接受可信 server-injected data，校验 topic 和 sender。
6. 对关键控制事件增加 API 签名或仅通过 HTTPS/Event Stream 下发。

### SEC-LK-002 房间 token 过期时间过长

当前默认 `CALL_ROOM_TOKEN_TTL_SECONDS=3600`。LiveKit 官方说明自托管 token
无法实时吊销，移除 participant 后旧 token 在过期前仍可能重连。

修复：

- 入房 token 默认 120 秒，最大 300 秒。
- token 只用于首次连接；重连由 SDK 当前连接完成。
- 分享链接换取一次性 Guest join ticket，再签发 LiveKit token。
- Guest ticket 绑定 call、角色、nonce、设备摘要和使用次数。
- End/踢人后 API 禁止再次签发，并主动 RemoveParticipant。

### SEC-LK-003 部署凭据和镜像不可复现

当前已渲染 `livekit.yaml` 被 `.gitignore` 排除，但文件权限为 `0644`，且 Compose
使用 `livekit/livekit-server:latest`。

修复：

- 凭据文件权限 `0600`，容器通过只读 secret mount 读取。
- 发布环境使用 Secret Manager/KMS，不把 secret 渲染进普通 YAML。
- LiveKit、SIP、Redis、Caddy 和 Agent 镜像固定版本和 digest。
- 如果当前凭据曾被复制到工单、聊天或日志，发布前轮换。
- CI 增加 secret scan 和镜像 SBOM。

### SEC-LK-004 公共入口缺少明确资源上限

当前 API CORS 为任意 origin；Gateway `WebSocketServer` 未设置 `maxPayload`；
未看到统一 API/room-token 限流。

修复：

- API CORS 使用 App/Web 域名 allowlist。
- Gateway `maxPayload` 设为协议可接受值，建议 128 KiB。
- 限制每个音频帧、每秒消息数、session 音频积压和总连接数。
- room-token、join、OTP、PSTN、Agent start 按账号/IP/设备限流。
- 反向代理限制 header、body、连接和请求速率。

### SEC-LK-005 开发认证配置不能进入发布

Beelink 部署脚本当前生成 `NODE_ENV=development`、测试自动账号和固定测试码。
这适合内测，但不能复用为生产发布文件。

修复：

- production deploy 单独模板，强制 `NODE_ENV=production`。
- `API_TEST_AUTO_ACCOUNT=false`，移除固定测试码。
- release readiness 不通过时 Compose 不启动公网服务。

## 4. SIP 专项

LiveKit SIP 需要公网开放 5060/5061 和 RTP UDP 端口。源码中的 outbound SIP TLS
会验证证书链，但因为 SIP 常使用 IP 地址，当前不验证服务端 hostname。

风险控制：

- SIP 信令优先 TLS 1.2+，媒体优先 SRTP `REQUIRE`。
- 5060/5061 和 RTP 仅允许已知 SIP provider/SBC IP 段。
- 使用 SBC 隐藏内部 SIP、做拓扑隐藏、限速、ACL 和异常呼叫阻断。
- trunk 使用强 digest 凭据，凭据按 provider 独立。
- 设置最大并发、单号码频率、最大通话时长和国际/高资费号码策略。
- 对 INVITE、DTMF、transfer、REFER 和 webhook 做审计。
- 不把 SIP/RTP 直接暴露在 Beelink 家庭网络作为生产方案。

## 5. LiveKit 上游源码硬化项

### 5.1 认证错误可能写入原始 token

当前 LiveKit server 源码在签名校验失败时构造包含原始 token 的错误，
`HandleError` 会记录并返回错误文本。

建议：

- 使用正式版本时先验证该行为是否已修复。
- 未修复则维护最小补丁：错误只返回固定 `invalid token`。
- 代理和日志层继续对 `Authorization`、`access_token` 和 JWT 形态脱敏。

### 5.2 SIP TLS 不校验 hostname

这是上游为 SIP IP 地址场景做的明确权衡，不等于完全关闭证书校验。我们仍需用
provider IP allowlist、SBC 和可选证书 pinning 补足端点身份。

### 5.3 E2EE 的产品边界

服务器端翻译/Agent 必须读取音频，因此不能承诺“服务器无法解密”的完整 E2EE。

可提供两种产品模式：

| 模式 | 加密边界 |
| --- | --- |
| 云端 AI | TLS + DTLS-SRTP；受信 Worker 可访问音频 |
| 隐私/端侧 | 端侧 ASR/翻译/TTS；可启用完整 E2EE，不经过云端 AI |

如果使用 E2EE 且 Worker 加入密钥，则只能表述为“SFU 不可见，受信 AI Worker
可解密”，密钥必须由业务 API 独立分发。

## 6. 依赖扫描结果

### 6.1 当前产品

- `livekit-server-sdk 2.16.0`
- `@livekit/rtc-node 0.13.30`
- `ws 8.21.0`
- 生产依赖 audit：0。

### 6.2 LiveKit 源码快照

- `livekit/livekit` 使用本机 Go 1.26.0 扫描时命中 16 个可达的标准库漏洞，
  修复版本最高要求 Go 1.26.5。该结果主要说明构建工具链必须固定补丁版本，
  不能据此断言最新官方镜像仍受影响。
- `livekit/sip` 的完整 source scan 因本机缺少 `soxr/opusfile` 原生库未完成。
- `livekit/agents-js` 当前仓库锁文件 audit 命中 1 critical、7 high、
  15 moderate、1 low；包括旧 `protobufjs` 和 `ws`。接入时必须使用经过
  独立 audit 的发布版本和锁文件，不能直接复制仓库 main 的依赖树。
- `livekit/node-sdks` 命中一个 examples/Next.js 间接 PostCSS 项，不在核心
  server SDK 路径。

## 7. 安全目标架构

```text
Internet
  |
WAF / Rate Limit / TLS
  |
Public API + LiveKit Signal
  |
Private Service Network
  +-- API / Agent Dispatch
  +-- Worker Pool
  +-- Model Gateway
  +-- PostgreSQL / Redis
  |
SBC / SIP Firewall
  |
LiveKit SIP <-> Trunk Provider
```

管理 API、数据库、Redis、模型服务和内部 Worker API 不允许公网直达。

## 8. 发布安全门禁

- [ ] room token 最小权限和短 TTL。
- [ ] App/Web 验证 data sender/topic。
- [ ] Guest one-time ticket、人数限制和限流。
- [ ] SIP provider IP allowlist、TLS/SRTP 和并发上限。
- [ ] 所有镜像固定 digest。
- [ ] secret 权限、轮换和泄漏扫描。
- [ ] npm/pnpm/go/Python/容器扫描无未接受的 high/critical。
- [ ] API/Gateway body、payload、速率和连接上限。
- [ ] 内部调用从共享 secret 迁移到 service identity 或 audience JWT。
- [ ] 录音、声音克隆、Agent 授权和接管审计通过。
- [ ] 外部渗透测试覆盖 token、WebRTC、SIP、webhook 和 Agent tools。

## 9. 官方参考

- https://docs.livekit.io/home/server/generating-tokens
- https://docs.livekit.io/transport/encryption/
- https://docs.livekit.io/transport/self-hosting/
- https://docs.livekit.io/transport/self-hosting/ports-firewall/
- https://docs.livekit.io/transport/self-hosting/sip-server/
- https://github.com/livekit/livekit
- https://github.com/livekit/sip
- https://github.com/livekit/agents
- https://github.com/livekit/agents-js
