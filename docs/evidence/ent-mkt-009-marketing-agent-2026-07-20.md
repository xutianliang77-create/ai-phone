# ENT-MKT-009 Marketing Agent 实现与静态门禁证据

日期：2026-07-20
任务：`ENT-MKT-009`
基线提交：`17ccb365c2b774d0d3ec84917e442a759103b88c`
证据等级：代码候选与静态门禁；不是 PostgreSQL、LLM/PSTN 通话或生产放行证据

## 1. 本批交付

- 新增共享 Marketing Agent profile/readiness/snapshot/turn 契约；profile 固化国家、locale、品牌、AI 身份、通话目的、
  产品、声音、Term Pack、Script Template、开场告知、资格问题、退订词、转人工词和结束语。
- 新增 `0046_enterprise_marketing_agent` up/down migration：forced-RLS profile/run/turn、tenant-first 复合 FK、草稿编辑
  guard、PSTN 同事务 run、disclosure/TTS/turn 状态机、task dispatch evidence 和 Agent opt-out suppression 约束。
- 新增完整 PostgreSQL profile/run/turn Repository 与 Enterprise Repository runtime adapter。PSTN prepare 在同一事务解析
  当前有效 published Term Pack/Script Template、创建不可变 Agent run；任一点失败时 dispatch/run/Outbox 整体回滚。
- 新增300..3600秒短期 HMAC runtime ticket，绑定 tenant、run、dispatch、task、communication session、dispatch
  generation 和 route epoch；runtime URL 只允许 HTTPS。snapshot、disclosure、turn、TTS 和 finalize 全部重读 fence。
- 新增严格 OpenAI-compatible JSON Adapter，关闭 thinking，不开放工具或外部动作。资格问题只能逐条使用下一个配置原文；
  answer/objection 必须引用本轮 tenant-scoped published knowledge；越界 citation、额外字段和受监管承诺性内容全部拒绝。
- 退订与转人工在 LLM 之前由服务端确定性识别。退订同事务追加不可变 suppression 并结束；转人工只记录
  `handoff_requested` 并停止 AI，真实坐席接管仍属于 `ENT-MKT-011`，未配置时明确说明不可转接。
- PSTN Bridge 现在严格要求 enterprise routing context 与 Agent runtime binding 成对出现，并向 HTTP/Fonoster 路径转发；
  个人呼叫仍可不带企业上下文。Bridge 不把 Agent ticket 混入普通状态 webhook 或 Web 响应。
- Enterprise Web 增加按需加载的同风格 Marketing Agent 面板，复用既有 Material Icons/token/StatusPanel，支持多国家/locale
  Profile 切换与草稿编辑；Provider/runtime 未就绪、无权限或已提交审批时不回退 fixture、不显示通话成功。
- Primary cutover 关键清单加入三张 Agent 表；动态 schema 基线更新为公共31段、enterprise 46段、122张业务表，旧签名
  cutover/restore 证据必须在 staging 重建。

## 2. 安全与一致性边界

1. 开场告知必须同时包含品牌、AI 身份和营销目的；disclosure 未 authorize+delivered 时不能创建 turn。
2. Profile 只允许 account actor 在 `draft/not_submitted` upsert，批准后不可修改或删除；country/locale 身份不可改写。
3. PSTN task 的 `dispatching -> dispatched` 同时要求 accepted dispatch 与 active disclosure-state Agent run，避免电话已派发但
   Agent 尚未准备完成。
4. Provider 在数据库事务外执行；turn complete 重验 run/profile/content/evidence hash。客户原文只保存 SHA-256，审计不写
   prompt、知识正文、ticket、号码或 Provider secret。
5. TTS 必须逐 turn authorize，只有真实 playout delivered 才推进；旧 ticket/generation/route、终态倒退和迟到交付拒绝。
6. 退订写入复用 tenant+phone advisory lock；数据库仅为固定 `system:enterprise-marketing-agent + contact_request` 放开
   tenant suppression，普通账号仍不能伪造 global source。
7. LLM Provider、签名 secret、HTTPS runtime、profile 或 published 内容任一缺失均 `not_ready`；无证据的事实回答、
   Provider 失败或人工接管未配置都以明确降级并停止，不生成预约、资料发送、Outcome 或外部成功。

## 3. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| 全 workspace typecheck | 通过 |
| 全 workspace build | 通过；Vite 仍报告既有 entry chunk 大于500 kB提示，不是构建失败 |
| Enterprise Web e2e TypeScript | 通过 |
| lint / 350行文件规模 | 通过 |
| Enterprise Web bundle 静态扫描 | 通过；11 files，entry JS 522618 B，全部 JS 1003136 B，CSS 86805 B |
| migration loader | 通过；46段有序；最新 `0046_enterprise_marketing_agent`；checksum `e365e30179a979f0305e3aeea0843716d50b8bcdae34bac502339f707403e2d6` |
| `git diff --check` | 通过 |
| Enterprise Web `--release` gate | 按设计拒绝：当前工作树未提交，且未注入 release version/commit；未记为通过 |

测试定义覆盖确定性退订/转人工、下一个资格问题、knowledge citation、禁承诺、Bridge 成对 binding、HTTPS runtime 和
46段 migration/admin 静态清单。但按本批既定边界，没有运行 Vitest、API/Repository、migration、forced-RLS、
Playwright、真实 PostgreSQL、真实 LLM/PSTN/ASR/TTS、LiveKit、Flutter 或真机测试。

## 4. 未通过项与后续

- `AC-ENT-0042` 未通过；`ENT-MKT-009` 保持 `in_progress`。
- 尚无 `0046` 空库 up/down/forward、普通角色 forced-RLS、双租户、并发 turn/退订、进程崩溃恢复或 staging 31+46
  cutover/restore 新签名证据。
- 尚无真实 Marketing Agent Provider、PSTN sandbox、ASR/TTS/媒体 Worker、通话 disclosure/中断、恶意提示、引用准确率、
  多语种切换或浏览器矩阵证据。
- SQLite/JSON 仍仅用于本地开发和封闭演示，不承载 Marketing Agent runtime，也不构成企业生产门禁。
- 下一开发项为 `ENT-MKT-010` 实时监控；真实人工接管为 `ENT-MKT-011`，Outcome/后续动作为 `ENT-MKT-012`。
