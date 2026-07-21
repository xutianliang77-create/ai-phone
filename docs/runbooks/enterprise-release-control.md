# Enterprise Release Control 值班手册

版本：v1.1
日期：2026-07-21
状态：本机 PostgreSQL 机制已验证；真实 Provider、SLO 和值班演练未执行

## 1. 适用范围

本手册只处理 `ENT-REL-004` 的 tenant + capability 灰度、kill switch 和
`closed -> open -> half_open -> closed/open` 熔断恢复。配额、并发、共享 Cell noisy-neighbor 和全局容量属于
`ENT-REL-007`；数据库主备切换属于 `ENT-REL-003`。

受控 capability：

- `meeting.screen_ocr`
- `support.agent`
- `support.write_tools`
- `marketing.pstn`

## 2. 前置条件

- 仅在隔离 test/staging 或已批准的生产变更窗口使用；不得把本手册当作本轮已执行证据。
- 使用受审计的 operator identity；`ENTERPRISE_RELEASE_CONTROL_INTERNAL_KEY` 和
  `ENTERPRISE_RELEASE_PROBE_KEY` 分开保管，禁止写入命令历史、工单正文或证据文件。
- 先确认 tenant UUID、capability、incident/change ID、当前 trace、on-call owner 和预计到期时间。
- 所有请求经正式 HTTPS 内部入口发送；示例中的 URL、token、UUID 均为占位符。

## 3. 读取当前状态

调用 `POST /internal/enterprise/release-controls/status`，body 只含：

```json
{
  "tenantId": "<tenant-uuid>",
  "capability": "support.agent"
}
```

请求必须携带 `Authorization: Bearer <release-control-key>` 和
`X-Enterprise-Operator-Id: operator:<on-call-id>`。记录不存在时返回 `not_configured + defaultDecision=deny`，
首次变更使用 `expectedVersion=0`；存在时抄录 version、owner、failureThreshold、rolloutExpiresAt 和状态。

## 4. 灰度开启和关闭

调用 `POST /internal/enterprise/release-controls/change`：

```json
{
  "tenantId": "<tenant-uuid>",
  "capability": "support.agent",
  "expectedVersion": 0,
  "action": "set_rollout",
  "enabled": true,
  "owner": "sre-oncall",
  "rolloutExpiresAt": "<future-iso-within-180-days>",
  "failureThreshold": 3,
  "reason": "<approved-change-or-incident-reference>",
  "operationId": "<new-uuid>"
}
```

关闭时改为 `enabled=false`，并使用刚读取的 version 和新的 operation ID。出现 `conflict` 时重新读取，禁止
盲目递增 version 或复用不同载荷。开启后验证目标租户能进入受控能力、未列入租户仍为
`enterprise_release_control_missing/disabled`，且其他 capability 不受影响。

## 5. 紧急 kill switch

1. 读取当前状态和 version。
2. 使用 `action=set_kill_switch, active=true` 提交变更；保留原 owner、到期和阈值，填写 incident reason。
3. 立即以普通 decision 请求确认 `kill_switch_active`，并验证目标租户新 dispatch/Provider 调用返回
   `enterprise_release_kill_switch_active`。
4. 验证另一测试租户和同租户其他 capability 仍可按各自控制运行。
5. 检查已受理 Provider 动作继续走幂等对账/结算/取消，安全结束和 disable 路径可用；不得把已有外呼记成未拨。
6. 保存控制事件 ID/operation ID、trace、开始/生效时间、影响范围和回滚 owner，不保存密钥或客户正文。

清除 kill 前必须确认故障根因、告警恢复、积压/对账完成和回滚批准。用新 version 提交
`action=set_kill_switch, active=false`；清除 kill 不会自动关闭 open circuit，也不会自动启用 rollout。

## 6. 熔断和恢复探针

- closed 下每个服务端 dispatch/Provider outcome 使用稳定 run/dispatch UUID。连续失败达到阈值自动 open；
  相同 operation ID 重放不重复计数。
- open 时普通 decision 必须拒绝。禁止用客户会话、真实线索或批量任务探测恢复。
- 复核 Provider readiness、告警、错误分类、对账和容量后，以当前 version 提交 `action=begin_probe`。
- half-open 的 decision 和 outcome 除 release-control key 外，必须携带
  `X-Enterprise-Release-Probe-Key`。只运行一个最小、隔离、不可产生客户风险的探针。
- 探针成功提交 `outcome=success, probe=true` 后应为 closed 且 failure count 归零；失败提交
  `outcome=failure, probe=true` 后立即 open。探针请求/结果各使用新的 UUID operation ID。

若状态/事件写入失败，视为恢复失败并保持业务关闭；不得只改客户端开关、环境变量或内存缓存绕过。

## 7. 证据和退出条件

本机机制回归可在已完成31+53 migration、已创建两个空测试 tenant 的隔离 PostgreSQL 上执行：

```bash
ENTERPRISE_TENANT_DATABASE_URL='postgresql://<tenant-role>@<host>/<db>' \
ENTERPRISE_RELEASE_ACCEPTANCE_TENANT_A='<tenant-a-uuid>' \
ENTERPRISE_RELEASE_ACCEPTANCE_TENANT_B='<tenant-b-uuid>' \
ENTERPRISE_RELEASE_ACCEPTANCE_MUTATION=true \
npm run enterprise:release-control-acceptance
```

确认开关表示允许命令在这两个空测试租户写入 release control/event 并最终打开测试 capability 的 kill switch；
不得指向生产租户。该命令必须验证普通角色非 superuser/非 `BYPASSRLS`、跨租户读0行/写SQLSTATE `42501`、同 operation
并发只计一次、open/probe/recovery/kill、事件 UPDATE SQLSTATE `55000` 和公共31段/enterprise 53段。
它不会调用真实 Provider，也不替代 kill SLO、告警或值班演练。

一次有效演练至少保留：candidate commit/image、31+53 manifest、tenant/capability、前后 version、operation IDs、
trace IDs、告警时间线、目标/对照租户结果、Provider/dispatch 计数、kill 生效延迟、probe 结果和独立 reviewer。
所有证据必须脱敏。只有 `AC-ENT-0053` 的真实 PostgreSQL forced-RLS、双租户、多实例、Provider 故障和 on-call
演练全部通过后，才能把本手册状态从“代码候选”升级为“已验证”。
