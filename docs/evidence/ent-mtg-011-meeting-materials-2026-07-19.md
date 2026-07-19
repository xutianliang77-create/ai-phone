# ENT-MTG-011 会后材料实现证据

日期：2026-07-19
状态：`in_progress`
证据边界：代码候选与静态门禁；测试、数据库和真实环境验收暂缓

## 1. 本次范围

- 新增 `0025_enterprise_meeting_materials` up/down migration。
- 新增材料契约、PostgreSQL Repository/runtime、API route 和 OpenAI-compatible 复核 Adapter。
- 新增 ended meeting 收敛、首次入会激活和结束后 translation Worker 写入 fence。
- 新增 Web/Flutter 服务端材料读取、生成、复核状态、证据、材料内修名、待办状态和人工发布界面。
- 更新功能、技术、UI、开发任务/计划、验收计划、设计索引和 PostgreSQL 说明。

## 2. 数据与一致性不变量

- 逐字稿不直接复制按 target fan-out 的 `meeting_translation_events`；以 source participant、track、segment 为键选择
  latest revision，再校验并合并重复目标副本。
- run 固化规范化 source count/hash、request hash、provider fingerprint、retention、revision 和 version。
- 同 tenant/meeting/idempotency key 的重放恢复原 run；不同 request hash 冲突。
- Provider 在事务外执行；最终事务重新锁定并校验 run version、source count/hash 和当前 run evidence。
- 结论和待办必须至少引用一个当前 material segment；冻结 segment、translation、结论和 evidence 不可更新/删除。
- speaker label 只更新本次材料；action status 使用 CAS；发布同事务写 artifact、audit 和 outbox。

## 3. Provider 与安全边界

- 默认不启用复核 Provider；未配置为 `not_configured`，健康检查/超时/协议/Schema 失败为 `failed`。
- 降级时仅返回服务端冻结逐字稿，不生成摘要、待办、负责人、截止时间或假成功状态。
- owner 只在当前会议 participant 名称唯一精确匹配且证据包含该名称时绑定。
- due 只在证据包含 Provider 原值且能严格解析时绑定。
- 所有新表使用 tenant-first 复合 FK 与 forced RLS；API 从可信 tenant context、membership 和 scope guard 授权。
- ended meeting 后 translation Worker accept/publish 拒绝迟到事件；活动共享存在时禁止结束会议。

## 4. 静态门禁

以下静态门禁通过：

- contracts、LLM、API、Enterprise Web 和 Web E2E TypeScript typecheck。
- API 与 Enterprise Web production build；Web bundle 静态检查通过，入口 JS 409,938 bytes，全部 JS 879,199 bytes，CSS 52,434 bytes。
- Flutter analyze：`No issues found`。
- 全仓 350 行文件规模与 `git diff --check` 通过。
- migration loader 静态装载25段，末段为 `0025_enterprise_meeting_materials`，up/down 均非空。
- 变更 diff 未发现私钥、真实 API key 或密码字面量；`.env.example` 的 Provider 默认值保持 `off`。

提交 ID 和远端同步状态记录在项目进度日志及本次 Git 提交中。

## 5. 明确未执行

- 未运行 Node、API、Repository、migration、Playwright 或 Flutter test。
- 未执行 `0025` forward/down、forced-RLS、双租户、并发发布或恢复演练。
- 未调用真实 OpenAI-compatible Provider，未验证超时、限流、畸形输出或 hallucination 攻击矩阵。
- 未运行浏览器、真机、LiveKit、外部导出 Adapter、对象存储或数据保留物理清理验收。
- 未构建/安装生产 App，未操作 Beelink 或真机。

因此本证据不满足 A1/H3，也不表示企业试点或生产门禁通过；`ENT-MTG-011` 保持 `in_progress`。
