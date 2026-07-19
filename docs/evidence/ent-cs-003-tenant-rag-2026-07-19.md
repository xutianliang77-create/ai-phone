# ENT-CS-003 Tenant RAG 实现与静态门禁证据

日期：2026-07-19
分支：`codex/enterprise-edition`
任务状态：`in_progress`

## 1. 本批实现

- 新增共享客服 RAG request/response/evidence contract，区分 `grounded` 与 `no_evidence`；无证据时固定返回
  `state_uncertain_and_offer_handoff`，不生成无引用企业事实。
- 新增会话级 API `POST /enterprise/v1/support/sessions/:sessionId/rag`，强制 active membership、
  `support:read`、签名 tenant route 和服务端 TenantContext；body 不接受 tenantId。
- PostgreSQL runtime 只允许 `waiting`、`ai_active`、`handoff_requested`、`human_active` 会话检索；created、
  ended、failed 或不存在会话均失败闭合。
- 复用 `ENT-CORE-004` Knowledge Repository 的 tenant、locale、country、product、published revision、
  effective-time 过滤和稳定 `knowledgeVersionId:blockId` citation，不新增第二套检索真值或 schema。
- 命中只返回已发布 evidence；零命中返回中英文保守文案和转人工建议。该层不连接 LLM/embedding Provider，
  确定性文本检索不冒充向量 readiness。
- 不可变审计只记录检索维度、结果数和逐条 knowledge version/source/revision/block/content hash；完整 citation
  可由审计中的 knowledge version 与 block 无损重建，不记录 query、chunk content 或完整提示词。

## 2. 静态门禁结果

| 门禁 | 结果 |
| --- | --- |
| Contracts TypeScript build/typecheck | 通过 |
| API Server TypeScript build/typecheck | 通过 |
| 全 workspace TypeScript typecheck | 通过 |
| 根级 lint / 350 行文件规模 | 通过 |
| `git diff --check` | 通过 |
| migration/schema manifest | 无新增 migration；仍为28段、68张 tenant 表、29个主体字段、总表102张 |

## 3. 明确未执行

按要求未运行 Vitest、API、Repository、forced-RLS、双租户、并发或重启恢复测试；RAG 结果与无答案测试仅定义未执行。
未连接真实 PostgreSQL、embedding/LLM Provider、PSTN/Web/App Gateway、浏览器、真机或生产服务。

因此本批不证明 AC-CS-RAG-001..005、A2/H3 或企业生产门禁通过。恢复测试后需覆盖会话状态矩阵、无 scope/
route/tenant 攻击、published/未来/过期/冲突版本、跨租户诱导、引用审计完整性、召回质量、无答案转人工和
Support Agent 仅引用生成。
