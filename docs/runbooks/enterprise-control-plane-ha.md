# Enterprise Control Plane HA Runbook

状态：代码候选运行手册；真实多故障域验收未执行

## 1. 不变量

- Tenant、Member、tenant job 和 route epoch 仍是 PostgreSQL 业务真值。
- `control_plane_pending_work` 只是 `tenant.provision` 的无 payload 恢复投影，不能直接完成或改写 tenant。
- 每个区域至少运行两个不同 worker ID、相同 commit/image 的控制面 Worker。
- Directory、control-plane、tenant、cell、migration 和 maintenance 使用不同最小权限连接。
- 控制面故障时禁止新开通和套餐变更；已经取得 route/Worker ticket 的区域会话继续安全结束。

## 2. 启动前

1. 锁定 commit、image digest、PostgreSQL 数据库身份和公共31段/enterprise54段 manifest。
2. 确认 `0054` 已验证，control-plane role 非 owner/superuser/BYPASSRLS，TLS 为 verify-full。
3. 为同区域配置至少两个唯一 worker ID、相同 region/build/image、独立进程和故障域。
   API 使用独立 observer ID 和只读 observer 数据库角色查询活性，不得与 Worker ID/写角色复用。
4. 配置 poll/batch/lease、期望副本数和批准的 provision backlog SLO。
5. 先启动一个实例并运行 status，再启动第二实例；候选不一致时禁止放量。

## 3. 正常运行

Worker 注册实例租约并周期 heartbeat；使用 `SKIP LOCKED` 领取 provision projection，在外部开通前通过 tenant
Repository 复核 job/actor/type/status。Provider 调用使用稳定 tenant ID；完成前再次续租，最后在 tenant
事务内 CAS tenant/job。实例或 work claim generation 丢失后进程必须退出，旧实例不能 finalize。

运行：

```bash
npm run dev:enterprise-control-plane
npm run enterprise:control-plane -- status
```

status 输出不得包含租户名称、用户、正文、凭据、数据库 URL 或 Provider 响应。
API observer 的 live snapshot 最多缓存1秒；实例 lease 过期后，新开通、重试、套餐变更和 release readiness
必须自动进入 not_ready，不得只相信启动时配置。

## 4. 滚动发布和排空

1. 确认其他同候选 active 副本数满足最小值。
2. 向目标进程发送 SIGTERM；它停止新 poll，将实例标为 draining，并完成/释放当前 claim。
3. 等待旧实例 lease 到期或 status 不再计入 active，再以新唯一 worker ID 启动。
4. 只有所有 active 实例都匹配新 commit/image、backlog 未超阈值后才继续下一实例。

不得复用仍有活动租约的 worker ID，也不得手工清空 generation 绕过 fencing。

## 5. 故障处置

- 单实例崩溃：其他实例不等待进程内状态；work lease 到期后以更高 generation 重领。
- 数据库不可用：停止新开通/套餐变更，保留区域会话安全结束；禁止退回 JSON/SQLite。
- provisioner 未知结果：不写完成；保留同 tenant ID 幂等重试，先查询区域实体再决定。
- 候选混跑：停止扩量，排空错误 candidate；不得把数量满足但 commit/image 不一致显示为 ready。
- backlog 超阈值：暂停新开通，检查数据库锁、Provider readiness 和实例容量；不删除 pending projection。
- 网络分区：只有持有数据库当前实例和 work lease 的一侧可继续；旧 generation 结果拒绝。

## 6. 验收边界

正式验收至少执行两个真实控制面进程并发 claim、API 在持久化后 kill -9、Worker 在 Provider 前/后和 finalize
前 kill -9、数据库连接中断、同 worker ID 竞争、候选漂移、backlog 告警、滚动排空，以及控制面全停期间的
进行中会议/客服/外呼安全结束。代码、单元测试或单机 status 不能替代这些证据。
