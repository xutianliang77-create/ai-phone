# Enterprise Tenant Admission and Fairness Runbook

状态：代码候选运行手册；真实共享 Cell 容量验收未执行

## 1. 边界

Tenant Admission 负责共享 Cell 的总并发、租户并发、速率窗口、有限队列和加权公平顺序。它不替代：

- Entitlement：租户购买的能力和上限。
- Usage budget/ledger：执行前 hold 与真实用量结算。
- Release Control：租户灰度、kill switch 和 Provider circuit。
- Worker dispatch/marketing task/screen share：业务状态、generation 和外部副作用真值。

最终准入上限取 entitlement 与平台 tenant limit 的较小值；任何一层拒绝都不能创建后续副作用。

## 2. 数据和角色

`0055` 建立 Cell policy/state、Cell-Tenant state 和 tenant admission request。tenant request 只保存 capability、
resource/idempotency/hash、units、虚拟完成时间和 lease，不保存客户正文。所有表 forced RLS；运行时只能调用
tenant-bound reserve/renew/release/active 函数，不能直接访问表。

Admission 管理角色使用独立 `ENTERPRISE_ADMISSION_DATABASE_URL` 和 operator ID；API readiness 使用不同的只读
`ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL`，只执行无 tenant 明细的 `cell_admission_readiness`。迁移后由数据库管理员
只向管理角色授权以下三个管理函数，不能授权表、tenant runtime 或 PUBLIC；API 环境不得持有 operator URL/ID：

```sql
GRANT EXECUTE ON FUNCTION enterprise.configure_cell_admission_policy(
  text,text,integer,integer,integer,integer,integer,integer,
  integer,text,bigint,text,timestamptz
) TO <admission_role>;
GRANT EXECUTE ON FUNCTION enterprise.configure_tenant_admission_weight(
  text,uuid,text,integer,bigint,text,timestamptz
) TO <admission_role>;
GRANT EXECUTE ON FUNCTION enterprise.cell_admission_status(text,text,text),
  enterprise.reconcile_cell_admission(text,text,text,timestamptz)
  TO <admission_role>;
```

## 3. 配置和启动

从 `infra/enterprise-admission/policy.example.json` 复制候选文件，替换真实 commit/image，并为每个 Cell 同时配置
`translation_runtime`、`voice_agent_runtime`、`marketing_pstn`、`screen_share`。配置不得填写未经容量测试的
宣传数字；初始值来自隔离 staging 阶梯/soak 证据。

```bash
npm run enterprise:admission -- apply
npm run enterprise:admission -- status
npm run dev:enterprise-admission
```

apply 使用 expectedVersion CAS；权重只在该租户 active/queued 均为0时改变。status 先过期并重算计数，再返回
Cell/capability 汇总，不返回 tenant ID、客户内容、数据库 URL 或凭据。

## 4. 公平算法

每个请求在 tenant transaction 中以稳定 idempotency/hash 入有限队列，虚拟完成时间为
`max(cell.virtualTime, tenant.lastFinish) + units / weight`。Cell state 行锁串行化准入，候选按虚拟完成时间、
入队时间、tenant 和 request ID 稳定排序；只在 Cell 总量、租户有效上限和速率窗口均允许时 admit。

大租户达到自己的并发或速率后不会阻塞其他仍符合条件的租户；队列满时有界拒绝，不生成无界内存队列。
Worker Dispatch、Marketing PSTN 和 Screen Share 在业务副作用前复核 active admission，heartbeat/renew 延长租约，
结束、取消、撤销和已知失败同事务 release。崩溃或未知结果由 lease 到期和 reconcile Worker 收敛。

## 5. 故障操作

- Policy 缺失/disabled：新副作用 `not_ready`，既有会话按自己的 lease 安全结束。
- DB/Admission 函数不可用：不回退内存 semaphore、Redis 或客户端计数。
- Counter 漂移：停止新放量，运行 reconcile/status；禁止手工直接改 active/queued。
- Queue 超阈值：检查 Provider/Worker/Cell 容量，必要时按租户 kill 新副作用，不删除队列伪造恢复。
- 租户迁移：任何 queued/admitted request 都阻断 Cell 迁移；终态 admission 属于全局运行控制表，不随 tenant 复制。
- 候选/Policy 漂移：release readiness 保持 not_ready，重新生成绑定当前 commit/image 的 policy 文件并 CAS apply。

## 6. 验收边界

正式验收至少需要两个真实租户、25/50/100混合会话、小租户突发与大租户持续、四种 capability、权重1/2/4、
队列满/TTL、速率窗口边界、Worker/PSTN/Screen Share 崩溃、未知 Provider 结果、计数 reconcile、Cell 迁移阻断、
120分钟70%目标利用率 soak。必须证明无重复副作用/结算、无OOM/无界队列，且小租户 SLO 在批准范围内。
