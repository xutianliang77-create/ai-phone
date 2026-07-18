# ENT-DATA-009 本地切换与恢复演练证据

日期：2026-07-18
环境：本机 Docker `postgres:16`（server `160014`）
代码基线：`bb58bc0` 加 ENT-DATA-009 工作区变更
结论：全量切换、writer fence、逻辑恢复和篡改检测机制通过；生产 H3 未通过

## 覆盖范围

- 源、目标、恢复库均从公共31段和 enterprise 16段 migration 建立。
- 清单覆盖 `ai_phone` 与 `enterprise` 的81张业务表，要求每张表存在主键。
- 8张关键表均包含记录：tenant、communication session、usage ledger、audit、contact
  consent、suppression、recording artifact、meeting artifact；对象引用及父记录同时存在。
- baseline 后向源/目标各追加同一 audit 水位记录，验证增量后二次全量对账。
- 所有 JSON evidence 以独立 HMAC 签名并以权限 `0600` 原子写入。

## 结果

| 阶段 | 结果 | 行数 | 全库 SHA-256 | 证据文件 SHA-256 |
| --- | --- | ---: | --- | --- |
| baseline | matched | 16 | `d5558b6b29ac6ce3fbefb0ea6800923d264b55a6b3cae6d90bb8fd19c2738216` | `5d4147eabeb48df2214d9441e16aec1b512d510eccad9aed6447869a1fe0e965` |
| cutover | matched | 17 | `1029d2ba6d65e88d081316e76116a6ca9d5e056bd66653b02db348134998fe1b` | `ab74a26ae611926a4c2059bd72c5df410aa4b078ac8340d1ac69f10f5b6804b5` |
| 反向切换/回滚 | matched | 17 | `1029d2ba6d65e88d081316e76116a6ca9d5e056bd66653b02db348134998fe1b` | `bb2f58d49494cfc67d65b9b0016539eac8ea0c78c93e4ec8797b3c366fd9f1a6` |
| restore | matched | 17 | `1029d2ba6d65e88d081316e76116a6ca9d5e056bd66653b02db348134998fe1b` | `9e6354ba42bfec2c260e7509017d37bf3bf83e492a97e36aacac4c50f210322c` |
| 单行篡改负测 | mismatch/exit 1 | 17 | target `69d3dfe9…` / restore `1029d2ba…` | `7b7f8250cb67fc44dec0b7baccd05534aa44b862e5af095fcc4b0451ce374b46` |

cutover writer fence 结果：源库 `default_transaction_read_only=on`，写探针被 SQLSTATE
`25006` 拒绝；`legacy_writer` 在源/目标可见会话均为0；目标默认可写且零行 UPDATE 探针成功。
源/目标第二次清单没有 missing、extra 或 mismatched table，migration 与 server version 一致。
随后以原目标为 source、原源为 target 生成独立 baseline，封锁原目标并恢复原源可写，
再次通过相同 writer fence 和全库 hash，形成反向切换/回滚机制证据；反向 baseline 文件
SHA-256 为 `060999ebbcacdbcb796e80f1a11f538baec53cd836960dc6c7ba6896c1db5a8f`。

恢复库由目标 custom-format `pg_dump` 在独立数据库中 `pg_restore`，随后设为默认只读；
恢复写探针被拒，旧 writer 会话为0，全库 hash 与目标一致。负测把目标
`enterprise.tenants.updated_at` 改动1秒，工具准确报告 `enterprise.tenants` mismatch 并非零退出，
随后已恢复原值。

## 证据边界

本演练的源、目标和恢复库位于同一 PostgreSQL 容器、同一 system identifier 和同一物理
故障域；备份是本机逻辑 dump，不是 off-host base backup/WAL，也没有自动 leader election、
网络分区、旧主物理隔离、PITR 时间点或 RPO/RTO 测量。因此它不能作为企业生产 H3、
`ENT-DATA-001` 完成或 `ENT-REL-003` 验收结论。正式验收必须在 staging 重新生成并保管
`environment=staging` 的签名 evidence，绑定候选 commit、image digest 和真实拓扑。
