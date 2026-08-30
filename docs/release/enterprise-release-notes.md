# 无界AI企业版候选发布说明

状态：未批准的候选模板

## 候选身份

每次候选发布必须在 `release/enterprise/release-materials.json` 中填写唯一 release ID、
语义版本、40位 Git commit 和 `sha256:` 镜像摘要。本文件不保存可变的“latest”指针。

## 本候选应说明的内容

- 新增或变更的企业功能及对应 `ENT-*` 任务。
- API、数据库 migration、通讯契约和 Provider Adapter 兼容性变化。
- 租户、角色、国家、区域、Cell、套餐或数据生命周期影响。
- Subscription lifecycle migration、Provider签名兼容性、欠费阻断、进行中安全排空、恢复新权益版本和账期对账影响。
- 已知限制、明确降级、未配置 Provider 和仍未通过的验收门。
- 升级顺序、数据库前向/回退边界、客户端最低版本及回滚条件。

## 禁止的发布表述

- 不得把 `implemented`、静态检查、mock、SQLite 或单节点证据写成 production ready。
- 不得在真实 SLA 批准和跨故障域演练前承诺可用性、RPO 或 RTO 数值。
- 不得把 Provider 请求已发送写成外部业务已完成。
- 不得隐去 dependency exception、未配置 Provider、法律适用范围或数据驻留限制。

## 变更摘要模板

正式候选在审批前应补充功能、数据、迁移、依赖、安全、隐私、监控、回滚和客户影响
九项摘要，并引用相应设计、任务、验收和签名证据文件。
