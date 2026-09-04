# 无界AI V1 WIP 清单与拆分计划

基线时间：2026-08-23 23:57 CST

分支：`codex/optimization-m2-flexible-subtitles`

HEAD：`801abb2eaedefdb0c1689d858356d5180b598445`

upstream ahead/behind：`0/0`

## 1. 当前规模

- tracked changed：227 个文件，`+13713 / -8098`。
- untracked：445 个文件。
- 合计状态路径：672。
- `outputs/`：194 个文件，只保留，不进入任何候选或提交。
- `package-lock.json`：9629 个变更行，必须与引入依赖的功能提交一起审计。

## 2. 全量归属

| 车道 | tracked | untracked | 合计 | 处理方式 |
| --- | ---: | ---: | ---: | --- |
| API Server | 69 | 111 | 180 | Call Link、Agent、Air780、Postgres 再细拆 |
| Mobile | 26 | 51 | 77 | 核心同传/记录/扫描与通话扩展分开 |
| Air780/固件 | 43 | 23 | 66 | 延期，不进入 V1 核心候选 |
| Translation Worker | 20 | 15 | 35 | Call Link/PSTN 与核心翻译分开 |
| Voice Agent Runtime | 10 | 22 | 32 | 延期，不进入 V1 核心候选 |
| Contracts | 11 | 11 | 22 | 按直接消费者随功能提交 |
| Infra | 7 | 8 | 15 | 核心容器与平台/HA 分开 |
| Model Services | 9 | 5 | 14 | ASR/VAD、MT、TTS、Speaker 分开 |
| Realtime Gateway | 11 | 2 | 13 | 连接门、时间戳/Speaker、readiness 分开 |
| Tooling | 9 | 3 | 12 | 跟随对应功能，不建混合工具提交 |
| Docs/Progress | 8 | 0 | 8 | 只记录对应证据 |
| Root/dependencies | 4 | 0 | 4 | 最后按依赖来源拆分 |
| Outputs | 0 | 194 | 194 | 永久排除 |

以上 672 条路径全部归入唯一车道；完整逐路径清单由
`scripts/generate_wujie_wip_inventory.mjs` 生成，避免手工遗漏。

## 3. 提交批次

1. `productization-truth`：V1 scope、运行合同、候选 manifest、活依赖 readiness。
2. `realtime-core`：连接、generation/turn/revision、flush、连续语音切段。
3. `asr-vad`：Qwen 1.7B、MarbleNet、stable-readable partial、时间戳。
4. `speaker`：Sortformer、边界拆分、unknown/count、可降级旁路。
5. `translation-tts`：Hy-MT2、VoxCPM2、顺序/取消与真实 smoke。
6. `mobile-core`：同传/聆听状态、长会话、记录和分享。
7. `scan`：版面降级和实体保护。
8. `call-link-beta`：Call Link、Worker、LiveKit 音轨；不混 PSTN。
9. `pstn-agent-air780`：全部延期车道，分别保留，不进入 V1 核心候选。
10. `data-platform`：PostgreSQL/Redis/HA/PITR 独立处理。

每一批必须在独立干净 checkout 回归；若需要从现有 WIP 提取，只拣选属于该车道的 patch，
不得用一次全量 `git add`。`PROGRESS_LOG.md` 单独追加，不得把其他任务的 WIP 混入功能提交。
