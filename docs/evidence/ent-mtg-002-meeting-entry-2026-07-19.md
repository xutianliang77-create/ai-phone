# ENT-MTG-002 创建与入会实现证据

日期：2026-07-19
分支：`codex/enterprise-edition`
状态：`in_progress`（代码候选和静态门禁完成，动态测试与真实环境验收按指令暂缓）

## 1. 本批交付

- 新增 Meeting 列表、详情、创建、访客邀请、成员入会和访客入会 API；成员路径继续要求 active membership、RBAC scope 与签名 route document，公开访客路径只从已认证的加密邀请派生 tenant context。
- 创建在单一 PostgreSQL tenant transaction 内写入 Meeting、host participant、communication binding、audit 和 outbox；`tenant + creation key + request hash` 支持安全重放并拒绝同 key 异请求。
- 访客邀请增加 `tenant + meeting + invitation key` 唯一约束和 request hash；相同请求重放返回同一 participant 并重新签发短期邀请，不重复创建访客。
- 邀请 token 使用 AES-256-GCM、独立 AAD 和最短32字节 secret，绑定 tenant/meeting/participant/guest role/issuedAt/expiresAt/tokenId；缺密钥明确 `not_ready`。
- LiveKit grant 绑定 tenant/meeting/communication session/participant/role，TTL 为60至300秒，只允许指定 room 的麦克风发布和订阅，明确禁止 data、camera、screen share；Provider、URL、Key 或 Secret 不完整时不签发。
- Web 成员页支持创建、列表、访客邀请复制、入会、静音和离开；公开访客页在 fragment 清除后用内存邀请换票。Flutter 企业页支持 tenant-scoped 列表和成员入会。三条入口均使用企业专用媒体客户端，不复用个人 Call Link。
- LiveKit Web SDK 改为入会时动态加载；发布门禁分别限制初始 JavaScript 512KiB、全部按需 JavaScript 1MiB 和 CSS 96KiB。
- enterprise migration manifest 从21段增至22段；`0022` 同时规范历史 Meeting policy，并增加创建/邀请幂等字段和约束。

## 2. 权限与失败闭合边界

- owner/admin/meeting_host/member 可按服务端 scope 和资源归属入会；auditor 不获得成员入会授权。
- scheduled Meeting 只有 host 可在预约时间前15分钟内转为 provisioning；其他身份收到未开始/不可入会，不由客户端乐观放行。
- guest invitation 必须对应数据库中同 meeting 的 guest participant，token 的 tenant、meeting 或 participant 任一不符即拒绝。
- tenant route/cell/epoch、communication binding、policy、entitlement、invite secret 或 LiveKit 配置缺失时返回 `not_ready`，不生成调试 token、不回退 SQLite/JSON、不伪造 Provider 成功。
- RTC token 及邀请 token 不写 audit details、日志、storage 或 UI；审计只记录 participant、role、status/reason。

## 3. 已执行静态门禁

以下命令通过：

```text
npm run typecheck -w @translation/contracts
npm run typecheck -w @translation/api-server
npm run typecheck -w @translation/enterprise-web
npm run typecheck:e2e -w @translation/enterprise-web
npm run build -w @translation/enterprise-web
npm run check:bundle -w @translation/enterprise-web
npm run lint
npm run check:lines
git diff --check
flutter analyze lib/src/features/enterprise
```

生产 Web 静态构建结果：初始 JavaScript 362760 bytes、全部 JavaScript 831985 bytes、CSS 43035 bytes，bundle 门禁通过。Flutter 企业模块分析为 `No issues found`；Flutter 同时提示 LiveKit/flutter_webrtc 尚不支持 iOS Swift Package Manager，该提示不是本批真机构建通过证据。

## 4. 明确未执行和未通过

按当前指令未运行 Vitest、API/Node 全量回归、Flutter test、Playwright、浏览器权限/axe/视觉矩阵、PostgreSQL migration/RLS/并发/恢复测试或真实 LiveKit 四人会议。因此：

- `ENT-MTG-002` 保持 `in_progress`，不能声明 AC-MTG-001..005、A1、A2、H2、H3 或企业生产门禁通过。
- 当前 manifest 为公共31段、enterprise 22段；既有31+16、31+20或31+21签名 cutover/restore 证据均不能用于本提交。
- SQLite/JSON 仍仅用于本地开发和封闭演示；本批没有接触生产 App、Beelink、真机或外部 Provider。

## 5. 恢复测试后的优先矩阵

1. API：create/invite 同 key 重放100次、异 hash 冲突、原子回滚和 outbox/audit 唯一性。
2. 安全：九角色、跨租户 meeting/participant、伪造 tenantId/route、invite 篡改/过期/跨 meeting、RTC capability/JWT claims。
3. PostgreSQL：`0022` up/down-forward、普通角色 forced RLS、并发邀请与成员加入、API/Worker 重启恢复。
4. 客户端：Web 成员/访客权限拒绝、fragment 清除、浏览器麦克风拒绝/重连/弱网；Flutter 横竖屏、动态字体、真机音频与后台切换。
5. 真实环境：隔离 LiveKit tenant room、host/member/guest 四人身份与音轨、Provider readiness、staging 31+22 migration/count/hash/cutover/restore。
