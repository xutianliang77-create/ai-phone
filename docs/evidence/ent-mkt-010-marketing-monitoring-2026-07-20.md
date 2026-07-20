# ENT-MKT-010 实时监控实现与静态门禁证据

日期：2026-07-20
任务：`ENT-MKT-010`
基线提交：`701b6154cf57a210e8555d561de678286dc89255`
证据等级：代码候选与静态门禁；不是 PostgreSQL、流式传输、真实通话或企业生产放行证据

## 1. 本批交付

- 新增 Campaign 汇总和单通话监控共享契约。服务端返回 dispatch/task/Marketing Agent 状态、脱敏 Lead hint、
  确定性关注原因、Provider 接受/接听延迟、证据新鲜度和失败码。
- 新增 PostgreSQL-only Monitoring Repository/runtime/API，不增加第二套通话状态表。汇总以 forced-RLS
  `marketing_pstn_dispatches` 为根，沿 tenant-first FK 关联 task、Lead、Agent run 和最新 turn。
- 单通话详情先验证 dispatch 同时属于当前 tenant 和 Campaign，再通过公共 Repository 白名单读取同一
  `communicationSessionId` 的最终 revision 字幕和 Provider operation；最多返回200条字幕、100条 Agent turn 和
  200条 Provider operation。
- 两个 GET API 都要求 active membership、`campaign:read` 和签名 route document。legacy/SQLite runtime 不回退
  fixture，明确返回 `enterprise_postgres_required`。
- Enterprise Web 在 Campaign 卡片增加默认折叠的只读监控面板，复用既有 Material Icons、颜色 token、圆角和
  `StatusPanel`。面板仅在展开时按5秒刷新，关闭后停止请求；详情显示字幕、Agent turn、风险和 Provider 证据。
- transport 固定返回 `mode=snapshot`、`streamStatus=not_configured` 和
  `marketing_monitor_realtime_stream_not_configured`。页面明确标注“5秒服务端证据快照、非流式”，不把轮询冒充
  Realtime Gateway 成功。

## 2. 安全、隐私与一致性边界

1. tenant、actor、role 和 route 都来自已验证上下文；路径只接受 UUID，跨 tenant/Campaign/dispatch 统一不可见。
2. 公共字幕和 Provider operation 查询强制包含 `scope_type=tenant`、当前 `scope_id` 和同一通信会话；映射层再次校验
   字幕 scope，页面不读取浏览器缓存或示例数据。
3. 列表只显示服务端保存的 `phone_hint`，不返回 PSTN 原始号码、Provider secret、runtime ticket、prompt 或客户文本 hash。
4. 汇总和单行使用同一组确定性规则：unknown/failed、Agent failed、最新 turn failure、handoff、最新风险信号、
   活跃状态超过15秒未更新、告知超过10秒未交付。无证据时显示“无样本”，不推导情绪、意图或成功。
5. 本任务只有读入口，不包含拨号、静音、挂断、转接、接管或 Outcome 命令。真实人工接管属于 `ENT-MKT-011`，
   Outcome/后续动作属于 `ENT-MKT-012`。

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 全 workspace typecheck | 通过 |
| 全 workspace build | 通过；Vite 仍报告既有 entry chunk 大于500 kB提示，不是构建失败；监控面板独立 chunk 8543 B |
| Enterprise Web E2E TypeScript | 通过 |
| lint / 350行文件规模 | 通过；本批最大受检 TypeScript 文件349行 |
| Enterprise Web bundle 静态扫描 | 通过；12 files，entry JS 523219 B，全部 JS 1012280 B，CSS 90231 B |
| migration loader | 通过；本任务无新 migration，仍为46段有序；最新 `0046_enterprise_marketing_agent`；checksum `e365e30179a979f0305e3aeea0843716d50b8bcdae34bac502339f707403e2d6` |
| `git diff --check` | 通过 |
| Enterprise Web `--release` gate | 按设计拒绝（exit 1）：未注入 release version/commit，且提交前工作树不干净；未记为通过 |

按本批既定边界，没有运行 Vitest、API/Repository、migration、forced-RLS、Playwright、真实 PostgreSQL、
PSTN/Marketing Agent/ASR/TTS、Realtime Gateway、100路负载、Flutter 或真机测试。静态 build 和 migration loader 只证明
代码可构建与迁移清单可装载，不替代真实数据库或流式验收。

## 4. 未通过项与后续

- `AC-ENT-0043` 未通过；`ENT-MKT-010` 保持 `in_progress`。
- 尚无 owner/admin/marketing manager/member/auditor 与拒绝角色、跨租户/跨 Campaign/旧 route、最终 revision、风险分类、
  100路刷新、快速切换/关闭和陈旧响应浏览器矩阵证据。
- 尚无真实 PostgreSQL forced-RLS、PSTN/Agent 通话、字幕时序、故障恢复或 staging 31+46 cutover/restore 新签名证据。
- 尚无 WSS/SSE/Realtime Gateway 事件源、断线重连、游标补偿或端到端延迟证据；因此不得把当前快照称为实时流。
- SQLite/JSON 仍仅用于本地开发和封闭演示，不承载 Enterprise Monitoring runtime，也不构成企业生产门禁。
- 下一开发项为 `ENT-MKT-011` 真实人工接管。
