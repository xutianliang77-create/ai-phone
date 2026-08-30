# 无界AI企业版正式发布清单

状态：未批准；所有项目必须由候选 manifest 和外部证据证明

## 候选身份与材料

- [ ] release ID、version、Git commit 和 image digest 唯一且一致。
- [ ] 服务说明、发布说明、SLA、隐私/数据处理、管理员手册、运维手册均已批准并锁定 hash。
- [ ] 数据库两套 migration manifest、API/Worker/Web/Flutter 构建身份与候选一致。
- [ ] 产品、工程、安全、隐私、运维和法务审批来自不同职责主体。

## 验收证据

- [ ] A0 工程和控制面。
- [ ] A1 企业会议、租户/RBAC、实时翻译和屏幕共享。
- [ ] A2 客服、知识、工具、人工接管和质检。
- [ ] A3 合规外呼、活动、PSTN、Agent、Outcome、CRM 和账务。
- [ ] H1 故障注入、取消、恢复、长稳和容量。
- [ ] H2 安全、隐私、跨租户攻击、密钥和独立 reviewer。
- [ ] H3 PostgreSQL、Cell、跨故障域自动切换、不可变 WAL/PITR 和实测 SLA。

## 运行与回滚

- [ ] Provider 未配置、超时、部分响应和未知结果均明确降级，不伪造成功。
- [ ] tenant 灰度、kill switch、告警、值班、客户通知和回滚决策人已确认。
- [ ] rollback 不丢最新数据，旧 route/Worker/writer 永久失败闭合。
- [ ] 用量、账本、审计、授权、禁拨、对象和生命周期 count/hash 对账完成。

任何一项未完成时 manifest 保持 `not_ready`，不得以口头批准或历史其他候选证据代替。
