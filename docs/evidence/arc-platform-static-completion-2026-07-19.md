# ARC 平台开发静态完成审计

日期：2026-07-19
结论：开发计划内代码已收敛到 `ready_for_acceptance`；动态测试按用户要求暂缓，
因此不是 accepted、staging-ready 或 production-ready 证明。

## 1. 已闭合的代码范围

- Platform P0：版本/digest 固定门禁、Provider Adapter、最小权限、Guest one-time ticket、
  nonce 原子消费、可信消息、资源上限、Node/Flutter/Python 通信合同。
- SIP/Dispatch/Egress/Agent：LiveKit SIP outbound/inbound、单拨号门禁、webhook/退款/对账，
  Worker dispatch/prewarm/load/drain/lease/fence/recovery，录音同意、artifact runner，Assist、
  Autonomous runtime/tool gateway、接管与 consult；高风险 feature flag 继续默认关闭。
- 数据：31 段公共 migration、PostgreSQL primary UoW、command/reliable inbox、`SKIP LOCKED`
  outbox、全部生产 Repository runtime adapter、签名 import/audit 和 database identity 门禁。
- Speech：每 leg 有界 ingest、持久 ASR stream、两遍纠错、上下文/术语/稳定前缀、
  ASR/MT/TTS/LLM session-sticky fallback、echo-aware barge-in、backchannel 和有界 call-end drain。
- TTS：VoxCPM2 `generate_streaming()`、NDJSON chunk 合同、有界多订阅流、LiveKit 直出、
  generation/cancel/sequence/sample-rate 门禁，以及首音频后断流不重播前缀。
- P2：Ingress/SRT bridge、Patroni/etcd、WAL-G off-host backup/restore、真实混合流量/故障
  编排、RTC/ingest/pipeline timing、模型启动参数 fingerprint、Prometheus/OTel/Collector/dashboard。

## 2. 关键代码入口

- Provider fallback：`services/translation-worker/src/worker/provider-fallback-controller.ts`
  及 `services/translation-worker/src/providers/fallback-*.ts`。
- 真流式 TTS：`services/model-services/tts-service/app/voxcpm2_streaming.py`、
  `services/translation-worker/src/worker/tts-audio-stream.ts`、
  `services/translation-worker/src/worker/call-tts-synthesis-queue.ts`、
  `services/translation-worker/src/worker/livekit-tts-audio-sink.ts`。
- 有界结束：`services/translation-worker/src/worker/call-translation-worker.ts`；默认
  `CALL_PIPELINE_END_GRACE_MS=1500`，进入 runtime fingerprint。
- PostgreSQL：`services/api-server/src/infrastructure/storage/postgres-primary-runtime.ts`、
  `infra/postgres/migrations/001_*.sql` 至 `031_voice_agent_recording_consent.sql`。
- HA/PITR/负载：`scripts/lib/patroni_ha_provider*.mjs`、
  `scripts/lib/walg_backup_provider*.mjs`、`scripts/lib/platform_mixed_load*.mjs`。

## 3. 本轮静态检查

- `node scripts/check_postgres_primary_cutover.mjs --json`：`ready`，旧 Repository import `0`，
  直接 Snapshot import `0`。
- `git diff --check`：通过。
- 修改/新增的非测试源文件规模扫描：没有超过 350 行；相关边界文件最大值为 350 行。
- 生产源占位扫描只保留显式失败关闭的 `REALTIME_PROVIDER=tencent_trtc` 和平台不可用
  System ASR adapter；两者不属于本 LiveKit ARC 批次，不会静默回退 mock。

## 4. 未执行且不能伪装为完成的验收

- 未运行 unit、typecheck、lint、build、migration、部署、故障注入、真实 SIP、真机或负载测试。
- 正式 RTC threshold 继续保持 `calibration_required` / `null`。
- 真实 SIP/Agent/Egress/Ingress 仍需私有 token、Prometheus 和 owned auto-answer 白名单号码。
- 跨主机 HA/PITR 仍需第二数据库节点、3 个 DCS voter 和 off-host 对象存储。
- 25/50/100 并发、120 分钟 soak、真实模型流式音质/chunk 边界和 call-end 100 次尾句可靠性
  都是后续动态验收，不是剩余代码占位。

## 5. 回滚边界

- 清空各阶段 fallback endpoint 可恢复单 Provider；关闭 `CALL_FULL_DUPLEX_ENABLED` 回到半双工。
- 清空 `TTS_STREAM_ENDPOINT` 回到完整 PCM；模型服务可关闭
  `TTS_VOXCPM2_REQUIRE_STREAMING` 只用于兼容回滚，不作为正式流式发布配置。
- `API_STORAGE_DRIVER` 未显式选择 PostgreSQL时不切流；跨主机证据完成前保持
  `PLATFORM_MULTI_NODE_ENABLED=false`。
