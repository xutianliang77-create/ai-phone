# ENT-CS-004 Support Agent 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增 Support Agent run/turn 共享契约、六字段输出契约、Worker snapshot 和内部 turn/TTS API 契约。
- 新增 `0029_enterprise_support_agent` up/down migration：run/turn 使用 tenant-first 复合外键、forced RLS、
  幂等键、request/evidence/context hash、递增 sequence、单向状态 trigger 和终态不可变约束。
- 新增 OpenAI-compatible Provider Adapter：请求使用 strict JSON Schema、`enable_thinking=false`、确定性参数和
  有界超时；解析器拒绝额外字段、thinking、非空工具、无引用回答、引用越界和风险未转人工。
- 生成由 API 持有，按 prepare -> Provider -> complete 分段。prepare/complete 都重新校验 tenant ticket、lease、
  communication binding、policy、route epoch、generation 和当前 RAG evidence hash；Provider 不持有数据库事务。
- 无 evidence 不调用 LLM；Provider 未配置、超时、不可用或输出非法时返回确定性本地化 handoff/degraded，
  不伪造回答成功或外部工具成功。
- 上下文最多12轮、单轮1500字节，应用侧压缩到7000字节以内，为 PostgreSQL `jsonb::text` 的8000字节约束留出余量；
  turn 单独只保存客户文本 SHA-256。
- 新增独立 LiveKit Support Agent Worker cell。Worker 不持有 PostgreSQL 凭据；短期 dispatch ticket 到期前轮换并复核
  tenant/session/cell/route/generation 绑定，心跳或控制 fence 失败立即中断、清空音频、禁用 I/O 并无 drain 结束。
- TTS 播放前必须通过 API generation-bound authorize；只有未中断的完整 playout 才推进 delivered，取消后的旧语音
  不从队列恢复。handoff/end 话术交付后 Worker 主动退出；handoff 保留人工接管状态，end 收敛会话终态。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript typecheck / build | 通过 |
| API Server TypeScript typecheck / build | 通过 |
| Voice Agent Runtime TypeScript typecheck / build | 通过 |
| migration loader | 通过；29段，末段 `0029_enterprise_support_agent` |
| `0029` loader checksum | `7e5c82370e483c055437e59657c9b8e029bd1b4477f79ba3aea2fdff67063d1f` |
| 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |

## 3. 明确未执行

按要求未运行 Vitest、API、Repository、migration、forced-RLS、双租户、并发、重放、取消或重启恢复测试；
测试文件仅定义未执行。未连接真实 PostgreSQL、LLM/ASR/TTS Provider、LiveKit、PSTN/Web/App Channel、浏览器、真机、
生产 App、Beelink 或任何生产服务。

因此本批不证明 `AC-ENT-0025`、A2/H2/H3、企业试点或生产门禁通过。恢复测试后需覆盖 strict schema/thinking 注入、
引用边界、Provider 未配置/超时、上下文边界、同键重放/异 hash 冲突、forced-RLS/跨租户、ticket 轮换、lease/route/
generation 失效、取消与接管竞态、真实 TTS playout、Worker/API 重启恢复和人工接管闭环。
