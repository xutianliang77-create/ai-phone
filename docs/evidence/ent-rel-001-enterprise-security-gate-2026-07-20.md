# ENT-REL-001 企业安全门禁证据

日期：2026-07-20 CST
任务：`ENT-REL-001`
验收：`AC-ENT-0050`
状态：`in_progress`，静态候选已形成，真实 H2/发布门禁未通过

## 1. 本批交付

- 新增 `infra/enterprise-security/security-gate-policy.json`，固定 P0/P1 阻断等级、21条高置信静态规则、
  六类渗透攻击、最少 case 数和168小时 evidence 有效期。规则 manifest 漂移或放宽阻断等级失败闭合。
- 新增 Git tracked/untracked 文本 SAST/密钥 scanner。SAST 覆盖动态执行、全局关闭 TLS、反射式 CORS、
  原始 HTML、child-process shell、Python shell/不校验证书/pickle；secret 覆盖私钥及 GitHub、Slack、
  OpenAI、AWS、Google 高置信 token。finding 只输出 path/line/line hash，不输出命中源码或 credential。
- 复用既有 production dependency audit 和精确 OpenTelemetry 例外。例外绑定 advisory、direct version、
  source mitigation、owner 和到期日；新增风险、版本/集合漂移或到期立即失败。
- 新增隔离 HTTP 渗透 runner、example plan、HMAC evidence verifier 和最终 release orchestrator。凭据仅从
  环境变量注入；artifact 只保存 response status/size/hash/duration，不保存请求或响应正文。
- CI 增加独立 `enterprise-security-static` job，执行静态扫描和 dependency audit。真实渗透 evidence 不在
  普通 PR CI 伪造，必须由锁定 candidate 的 test/staging 环境另行产生。
- 修复两项被新规则命中的共享边界：API CORS 从 `origin: true` 改为生产默认同源/精确 allowlist；
  Translation Worker 的固定 `@livekit/rtc-node` 改为 `import()`，不再通过 `new Function` 构造代码。
- 移除 iOS 主 release `Info.plist` 的 `NSAllowsArbitraryLoads=true`；保留 `NSAllowsLocalNetworking` 仅用于
  显式本地网络说明。Android debug/profile cleartext 只存在于非 release manifest，scanner 明确排除这些变体。

## 2. 渗透执行安全边界

- target environment 只允许 `test|staging`；localhost 以外必须 HTTPS 且 hostname 出现在
  `ENTERPRISE_SECURITY_ALLOWED_HOSTS`。`production`、URL credential、query/fragment/path base URL 均拒绝。
- runner 需要显式 `--acknowledge-isolated-target`，禁止自动跟随 redirect；认证、route、API key 和 cookie
  不允许以 literal header 写进 plan，只能引用环境变量。
- 六类最低攻击是 unauthenticated access、tenant context spoofing、cross-tenant access、role escalation、
  webhook signature/replay 和 payload limit。业务资源 ID 必须来自隔离 fixture，不能针对生产租户。
- evidence 以不少于32字符的独立 HMAC key 绑定 full commit SHA、target origin、runner version、plan hash、
  started/completed time、每个 attempt 和 finding。release verifier 要求 commit 精确相同、七天内、类别齐全、
  全部 case pass 且 P0/P1 为0。

## 3. 本轮静态结果

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| Node `--check` | pass | 八个新增 `.mjs` 入口、库与测试定义均通过语法检查 |
| 渗透 plan schema | pass | example 的6个 case/6类攻击通过 policy 校验；未发起 HTTP 请求 |
| 企业 SAST/密钥 | pass | 2607个文本文件、21条规则、P0=0、P1=0；50个含 NUL 的二进制文件跳过 |
| Dependency audit | accepted temporary exception | high=0、critical=0、low=0；14个 moderate 均属于 `GHSA-8988-4f7v-96qf` 精确例外，到期 `2026-08-31T23:59:59+08:00` |
| API Server typecheck | pass | CORS 配置和测试定义可类型检查 |
| Translation Worker typecheck | pass | 固定模块 `import()` 类型通过 |
| 真实 test/staging 渗透 | not_run | 未访问任何 HTTP target，未生成或验签真实 candidate evidence |
| 外部 SAST/DAST 与独立复核 | not_run | 当前自研规则是高置信前置门禁，不替代外部 scanner/reviewer |
| 密钥轮换/恢复 | not_run | 未操作真实 secret manager、旧 key 或备份 |

临时 dependency exception 不是“零漏洞”。本轮只能证明当前锁定依赖集合没有未接受的 low/high/critical，
不能证明所有依赖或业务逻辑不存在漏洞。

## 4. `AC-ENT-0050` 尚缺证据

1. 在冻结 commit 的隔离 test/staging 环境执行六类及 H2 扩展攻击，保存签名 evidence 与受控原始日志。
2. 由独立安全 reviewer 复核外部 SAST/DAST、tenant/RBAC/trace baggage、webhook、prompt/tool injection、
   日志脱敏和 Provider ingress/egress，并关闭所有 P0/P1 后复测。
3. 对 evidence signing、route/ticket、Provider webhook、对象存储和数据库凭据执行轮换、旧 key 拒绝、
   服务重启和备份恢复演练。
4. 在 clean committed candidate 上运行 `check:enterprise-security-release`，确保静态、dependency 和
   penetration 三项同时通过，再由发布 reviewer 签字。

因此 `ENT-REL-001` 保持 `in_progress`，不得标记 `ready_for_acceptance/accepted`，也不得宣称 H2 或企业
生产安全门禁通过。
