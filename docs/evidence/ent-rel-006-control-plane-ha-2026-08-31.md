# ENT-REL-006 SaaS 控制面高可用代码候选证据

日期：2026-08-31
状态：`in_progress` / 验收未执行

## 代码候选

- `0054_enterprise_control_plane_ha`：实例租约、provision 无 payload 投影、forced RLS、derived-row guard、
  instance/claim generation 和同步 trigger。
- 独立 control-plane PostgreSQL session 只允许两张控制表，使用独立 worker GUC、region 和 trace。
- 多实例 repository/worker：注册、heartbeat、drain、`SKIP LOCKED` claim、续租、释放、真实 tenant job 二次
  复核和 tenant/job 原子 finalize。
- PostgreSQL 创建/重试改为持久化后202；控制面配置缺失时创建和套餐变更503且不产生 tenant/账务副作用。
- status CLI 报告同区域、同 commit/image 的 active/draining 数、due backlog 和数据库计算的 oldest age；
  副本不足、候选混跑或 backlog 超阈值返回 not_ready。
- API 使用独立 observer ID 查询最多缓存1秒的同一数据库 live snapshot；开通、重试、套餐变更和 release
  readiness 不再只依赖静态配置。
- Cell 迁移计划明确排除全局 control-plane instance/pending projection；活动 provision claim 阻断租户迁移。

## 静态验证边界

本轮按用户要求不执行测试。已增加 migration、config、repository、route 和 platform readiness 测试定义；后续需
在依赖可用时执行。当前没有真实 PostgreSQL `0054` up/down/forward、普通 control-plane role forced-RLS、两个
进程并发、kill -9、网络分区、滚动排空、真实区域 provision 或控制面全停/区域会话自治证据。

因此本证据只证明实现范围和待验收契约，不证明 control-plane HA、企业试点、A4 或 production ready。
