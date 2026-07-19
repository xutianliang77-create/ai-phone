# ENT-MKT-008 PSTN dispatch 实现与静态门禁证据

日期：2026-07-19
任务：`ENT-MKT-008`
基线提交：`1b1b800e6292dd86dbb8f4b836906a4f5199ff57`
证据等级：代码候选与静态门禁；不是 PostgreSQL、PSTN Provider 或生产放行证据

## 1. 本批交付

- 新增共享 PSTN dispatch/readiness/webhook 契约，以及 Campaign 只读 dispatch 状态 API。
- 新增 `0045_enterprise_marketing_pstn_dispatch` up/down migration：forced-RLS dispatch、tenant-first 复合 FK、
  不可变 identity、受控状态机，以及必须引用 dispatch evidence 的 marketing task 转换 trigger。
- 新增 PostgreSQL PSTN Repository/runtime，以 `prepare transaction -> Provider -> finalize transaction` 隔离数据库锁和
  外部网络；prepare 创建 scoped communication session/binding、无明文号码 Outbox 和稳定 Provider 幂等键。
- Provider 明确接受后以 `marketing:pstn:settle:<dispatchId>` 首次结算固定60秒 hold，并推进 task/binding/Outbox；
  重放不再次结算。超时、断连及可重试 HTTP 错误进入 `unknown/reconciliation_required`，lease reaper 不盲目重拨。
- 新增 HTTPS PSTN Bridge Adapter 和 HMAC enterprise webhook；Bridge 透传 tenant/region/cell/route/task/generation metadata，
  Provider event context 不完整时失败闭合，不降为普通 agent call webhook。
- Enterprise Web 使用既有 Material Icons、品牌 token 和 Scheduler 面板样式展示 Provider readiness、dispatch 计数与60秒
  结算规则；面板按需加载，不提供手工拨号或模拟成功。
- Primary cutover 关键表清单加入 `enterprise.marketing_pstn_dispatches`，当前动态 manifest 基线变为公共31段、企业45段、
  119张业务表；旧签名切换证据必须在 staging 重建。

## 2. 安全与一致性边界

1. 内部入口同时要求 `INTERNAL_API_SECRET`、签名 route document、当前 tenant/cell/route epoch、claim token 和 generation。
2. Provider 前重读 approval、active Lead/link、Consent、Suppression、Country Policy/当地窗口、有效 entitlement 和至少15秒
   剩余 lease；客户端不能提交号码或 Provider。
3. 手机号只由 tenant keyring 在事务提交后的 Provider 请求内存中解密，不进入 Outbox、审计、状态 API 或 Web。
4. Bridge URL 只允许 HTTPS；Provider 请求超时上限10秒，webhook secret 至少32字节。Provider、Bridge token、webhook secret、号码 keyring 或持久
   idempotency 保证任一缺失均明确 `not_ready`。
5. webhook 对完整规范 body 做 HMAC-SHA256，以 tenant+source+event ID 的 Inbox 去重，并重读 route/generation/call fence；
   旧路由、旧代际、跨租户、篡改和不完整 enterprise context 均拒绝。
6. dispatch 与 task/binding 状态在同一 tenant transaction 内推进；task transition 失败会回滚 dispatch，不留下分裂状态。

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 全 workspace typecheck | 通过 |
| 全 workspace build | 通过；Vite 仍报告既有单 chunk 大于500 kB提示，不是构建失败 |
| Enterprise Web e2e TypeScript | 通过 |
| lint / 350行文件规模 | 通过 |
| Enterprise Web bundle 静态扫描 | 通过；10 files，entry JS 522024 B，全部 JS 994175 B，CSS 85571 B |
| migration loader | 通过；45段有序；最新 `0045_enterprise_marketing_pstn_dispatch`；checksum `580d3a173a49e4d82533128d778840b78e373c6584798c13e3f5cbc4878ded4f` |
| `git diff --check` | 通过 |

测试定义覆盖稳定 scoped identity/Provider 幂等 readiness、webhook HMAC/篡改、Bridge enterprise context 完整性和独立
签名 sink；迁移/管理员静态清单也已更新。但按本批既定边界，没有运行 Vitest、API/Repository、migration、forced-RLS、
Playwright、真实 PostgreSQL、真实 PSTN/Provider、LiveKit、Flutter 或真机测试。

## 4. 未通过项与后续

- `AC-ENT-0041` 未通过；`ENT-MKT-008` 保持 `blocked`。
- 尚无 `0045` 空库 up/down/forward、普通角色 forced-RLS、双租户、50并发、Provider 响应丢失对账或浏览器矩阵证据。
- 尚无真实 PSTN sandbox/号码、Provider 持久幂等查询、Bridge 部署、账务抽样或通话状态回调证据。
- SQLite 仍仅用于本地开发/封闭演示，不构成企业生产门禁。
- 下一开发项为 `ENT-MKT-009` Marketing Agent；真实 PSTN 与 PostgreSQL 验收仍需按 `AC-ENT-0041` 独立执行。
