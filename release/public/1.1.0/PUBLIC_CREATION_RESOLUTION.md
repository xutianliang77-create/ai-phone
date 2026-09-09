# 未决公有创建：服务端处置合同（第82批）

这是原API的开发接口；第83批已接原手机内联操作和终态回执保存，见[MOBILE_PUBLIC_CREATION.md](MOBILE_PUBLIC_CREATION.md)。HOST/Widget通过不表示生产启用、真机或完整恢复验收。

## 接口和安全边界

三个POST端点：`/realtime/creation-requests/query`、`/cancel`、`/expire`。必须使用原账号认证、HTTPS（测试允许真实loopback）、原Idempotency-Key，body仅包含`request`（原创建body）和`nonce`。不接受调用方选择owner/部署/sessionId，也不允许伪造时间、费用或“未使用”证明。

响应包含contractVersion、ownerId、deploymentId、推导sessionId、nonce、原body的规范JSON SHA256、state、safeToReplace、canRetire和可选expiresAt。无供应商密钥、Token、原译文。手机接入时须精确核对所有绑定，不可只看HTTP200或safeToReplace一个字段。

| state | 含义 | 可直接换新键 |
| --- | --- | --- |
| not_found | 此刻无对应记录，但请求仍可能迟到 | 否，先明确cancel并取得作废回执 |
| prepared / issued | 已准备或发行、尚未开始 | 否，可重试原键或明确cancel |
| expired_pending | 已到服务器期限，尚未持久化过期处置 | 否，明确expire或cancel |
| cancelled / expired | 请求已作废、无法再以旧键创建 | 精确回执持久化后，允许下一次明确新开始；不自动开始 |
| reconciliation_required | 已运行、有输出/调用/用量/结算，或记录关系不完整 | 否，走原停止/保存/结算与对账 |

query只读，不创造资格、不调用模型、不自动释放预占。缺可信公有启动装配时默认503；PostgreSQL新路径仍503，不把内存锁用作分布式保护。

## 原子性和费用含义

cancel/expire与原创建共用作用域锁；原会话锁和同步快照事务内检查证据、标记failed、撤销已有准入、释放原用户额度预占并写永久请求标记。失败整体回滚；重复请求不新增结算。撤销先于创建时也持久保留原键，迟到创建返回410。

任何运行记录、模型attempt、原译文、非零消耗、最终结算或异常预占关系都会拒绝这里的释放。过期使用已发行Token的已有期限；未发行准备记录采用服务器createdAt后300秒，不采用手机时钟，不续Token。

这仅处置未开始会话的用户额度预占，不调用供应商退款或预算撤销，不清除潜在供应商连接成本，也不声称费用为零。真实供应商预算/费用对账仍需独立来源和授权。

## 存储和回滚

原publicCreationBindings索引保留原裸hash，新增`cancelled:<hash>`或`expired:<hash>`。公有部署遇到已有JSON损坏、不可读或索引不合法会拒绝空库恢复；不得删文件/索引以恢复运行。正常新部署的缺文件初始化仍允许，因此没有灾难丢盘后防重放保证。

包含新作废标记的快照不能直接交给只支持裸hash的旧公有候选；不得清理标记来兼容旧代码。部署/回滚前需选择支持该索引的已验候选，或safe_stop并保留完整快照。冻结私有1.0不是公有数据回滚目标。本轮未部署，不需要操作现网或手机。

第83批手机显式查询/撤销/过期入口及回执落盘HOST通过；公有无损重连、多Gateway和PostgreSQL恢复仍待验，未因此扩大本入口的处置权限。
