# Secret、镜像与 SBOM 生命周期

本文是 `ARC-SEC-005` 的发布合同。它不保存真实凭据，也不把本地 `.env`
当作生产 Secret 的真值源。

## 1. Secret 供应与落盘边界

- 生产真值源必须是受审计的外部 Secret Manager（云 Secret Manager、Vault
  或等价托管服务）。仓库、CI 变量明文、聊天记录和镜像层都不是 Secret
  真值源。
- 部署控制器按 workload 身份读取 Secret，并在目标机 tmpfs/private runtime
  目录物化为 owner-only 文件。允许模式为 `0400` 或 `0600`，父目录为
  `0700`；文件不得位于 Git 工作树。
- `infra/livekit-selfhost/.env` 只允许作为隔离 staging 的私有输入。渲染器会
  拒绝 group/other 可读的输入，并把输出目录收敛为 `0700`、全部文件收敛为
  `0600`。
- 渲染后的 `livekit.yaml`、`sip.yaml`、`egress.yaml`、`ingress.yaml` 和
  `release.env.snippet` 含敏感值，只能进入私有部署目录。Compose 对这些配置
  使用只读 mount；不得上传为 CI artifact。
- `release/domestic/release.env` 同样必须为 owner-only。生产门禁拒绝测试账号、
  debug OTP、query token、非 TLS Redis 和非分布式公网限流配置。

## 2. 镜像与 SBOM

- `infra/livekit-compatibility-profile.json` 是 LiveKit Server/SIP/Egress/Ingress
  的版本、目标平台、digest 和验证状态真值。
- 允许部署的镜像格式仅为 `repository:tag@sha256:<64 hex>`。`latest`、tag-only、
  未声明目标平台或未验证 digest 均阻断发布。
- `.github/workflows/supply-chain.yml` 对 Git 历史执行 secret scan，生成源码
  SPDX JSON SBOM，并对 compatibility profile 中已固定的每个镜像生成独立
  SBOM。Egress/Ingress 未补 tag/digest 时不会伪造产物，release compatibility
  gate 继续阻断它们。
- 所有第三方 GitHub Actions 使用 commit SHA 固定。SBOM 与扫描产物保留在 CI，
  release evidence 记录 workflow run、commit、镜像 digest 和产物 SHA-256。

## 3. 轮换清单

| Secret 组 | 典型键 | 常规周期 | 轮换方式 |
| --- | --- | --- | --- |
| 账号与内部 API | `AUTH_OTP_SECRET`、`INTERNAL_API_SECRET` | 90 天 | 双键校验窗口，客户端/worker 全部切换后撤销旧键 |
| 公共入口保护 | `PUBLIC_RATE_LIMIT_KEY_SECRET` | 90 天 | drain 公共入口，统一切换所有 API/Gateway 节点 |
| LiveKit | API key/secret、Dispatch ticket secret | 90 天 | 新 key 灰度、token TTL 后撤销旧 key |
| SIP/PSTN/Webhook | trunk 凭据、签名 secret | 90 天 | provider 双凭据或受控 drain，重放门禁后撤销旧值 |
| 模型服务 | ASR/MT/TTS/LLM API key | 90 天 | 新旧 key 重叠，健康与单会话 smoke 后撤销旧值 |
| 数据与观测 | PostgreSQL、Redis、OTel token | 90 天 | 新凭据连接池预热，切流后终止旧会话 |
| 计费与对象存储 | 支付 webhook、S3/KMS 凭据 | 90 天 | provider/KMS 原生轮换，账务和对象读写对账后撤销 |

发现泄漏、人员权限变更、供应商事件或签名校验异常时立即轮换，不等待常规周期。
每次轮换必须记录 owner、ticket、开始/完成时间、新版本、受影响 workload、
验证证据、旧凭据撤销时间和回滚窗口；记录中不得包含 Secret 值。

## 4. 回滚与退出条件

回滚只回滚 Secret 版本引用和 workload，不把旧 Secret 写回仓库。若新凭据验证
失败，在旧凭据尚未撤销的窗口内恢复旧版本引用；一旦确认泄漏，旧凭据不得作为
回滚目标。只有 secret scan、源码/镜像 SBOM、digest 校验、私有文件权限和轮换
证据全部齐备，`ARC-SEC-005` 才能从 `ready_for_acceptance` 进入 `accepted`。
