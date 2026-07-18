# ENT-MTG-001 Meeting 聚合代码候选证据

日期：2026-07-19
状态：`in_progress`，仅代码与静态门禁候选，不是企业生产验收证据

## 本批范围

- 新增 Meeting、Participant、Artifact 领域契约及显式状态机。
- 新增 enterprise migration `0021_enterprise_meeting_aggregates`，约束会议状态、时间、参与者身份、Artifact 发布状态及恢复索引。
- 新增 tenant-scoped PostgreSQL Repository 与 Enterprise Repository runtime adapter。
- 恢复聚合读取同时返回 participant、artifact 和唯一 communication binding；缺 binding 保持缺失，不补造 ready 状态。
- Meeting 状态更新使用版本 CAS，并拒绝非法转换和倒退时间。

## 已执行静态门禁

- `npm run typecheck -w @translation/api-server`
- `npm run lint`
- `npm run check:lines`
- `git diff --check`

以上命令在本任务提交前执行并通过；本文件中的结论不替代后续动态验收。

## 明确未执行

按本轮“测试先略过”要求，未运行 unit/API/Node 全量测试，也未执行 PostgreSQL migration、up/down、forced RLS、双租户攻击、CAS 并发、API/Worker 重启恢复或容量测试。

`ENT-MTG-002` 创建/入会 API、成员与访客 token、RTC/Provider、审计/outbox 原子副作用尚未实现。因此本批不能满足 AC-MTG-001..005、A1、H2、H3 或企业生产门禁。

## 数据与灾备边界

当前代码 manifest 为公共 31 段、enterprise 21 段。`ENT-DATA-009` 的历史 31+16 签名证据以及后续 31+20 描述均不能用于当前 commit；staging 必须基于 31+21 重新生成 migration、count/hash、cutover 和 restore 证据。
