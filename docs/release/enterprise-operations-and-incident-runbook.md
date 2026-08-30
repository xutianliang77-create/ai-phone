# 无界AI企业版运维与事件响应手册

状态：未批准的候选运行手册

## 1. 发布前

1. 锁定候选 commit、镜像 digest、公共和 enterprise migration manifest。
2. 在隔离 staging 执行 A0–A3、H1–H3，并生成绑定候选身份的证据文件和 SHA-256。
3. 复核安全例外、密钥、Provider readiness、容量、告警、值班表、备份/WAL/PITR 和回滚点。
4. 完成产品、工程、安全、隐私、运维和法务审批后运行企业发布材料 checker。
5. checker 或 `/health/release-ready` 非 ready 时禁止进入生产灰度。

## 2. 灰度和监控

按批准的 tenant/capability allowlist 灰度，禁止全局内存 flag。观察控制面、API、RTC、Worker、
Provider、数据库、Outbox、账本和业务 SLI；错误率、延迟、审计或合规证据异常时停止扩量。

## 3. 熔断和回滚

租户能力熔断使用 PostgreSQL release control 真值。kill switch 只阻止目标 tenant/capability 的
新副作用，已经接受的 Provider operation 继续安全对账、结算和审计。回滚不能绕过 schema
兼容性、writer fence、route epoch 或 Worker generation；未知 Provider 结果用原幂等键重试查询。

## 4. 事件响应

1. 发现：记录时间、候选、区域、Cell、租户范围、capability 和脱敏 trace。
2. 控制：按最小粒度 kill、停止调度、撤回 ticket 或隔离 Provider，保留安全结束路径。
3. 取证：保存不可变审计、指标、配置 fingerprint 和 hash，不复制客户正文或凭据。
4. 修复：确定根因、回滚/前滚方案、数据和账本对账及迟到事件处理。
5. 通知：由法务/隐私按适用合同和法规批准范围、内容和时限。
6. 恢复：专用 probe 在第二凭据和双人复核下 half-open；通过后逐租户恢复。
7. 复盘：形成 owner、截止日期、预防门禁和独立 reviewer 结论。

## 5. 灾备

自动切换必须确认新 leader、旧主只读 fencing、旧 route/Worker 副作用拒绝和数据 hash。PITR 在隔离
目标恢复并核对 marker、tenant、session、ledger、audit、consent、suppression 和对象清单。没有
跨故障域实测时只报告机制候选，不报告生产 RPO/RTO。
