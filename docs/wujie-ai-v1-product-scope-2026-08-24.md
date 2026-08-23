# 无界AI V1 产品范围冻结

日期：2026-08-24

状态：第一批产品化基线

目标：国内 iOS 受邀私测；公开商用发布另设独立发布门

## 1. V1 核心闭环

V1 只把以下能力做成同一个可追溯、可回滚、可真机验收的候选版本：

1. 同传：稳定可读原文、译文、可选朗读、暂停/恢复/结束、断线恢复。
2. 聆听/会议：Qwen 流式文本、保守段后 revision、匿名说话人、时间戳、纪要和待办。
3. 记录：`raw / optimized / translated` 三层全文、搜索、说话人、时间戳和四格式分享。
4. 扫描：普通文本、菜单、票据、铭牌和密集表格；数字、型号、厂商和拉丁实体保护。
5. 我的：账号、隐私、版本、声音、数据导出/注销和用户可理解的服务诊断。

Call Link 只作为 Beta。PSTN、AI Calling Agent、Air780、企业版、Android 独立评测、支付、
跨主机 HA/PITR 和新 ASR 赛马不进入本批发布门。代码可以保留，但必须由 feature flag 隔离，
不得阻塞核心同传。

## 2. 冻结运行链

- 在线 ASR：`Qwen/Qwen3-ASR-1.7B`。
- 声学前端：`nvidia/Frame_VAD_Multilingual_MarbleNet_v2.0`；RMS 只允许显式降级。
- 翻译：`tencent/Hy-MT2-1.8B`。
- 朗读：`VoxCPM2`。
- 实时匿名说话人：`nvidia/diar_streaming_sortformer_4spk-v2.1`。
- LLM：只做受控 revision；失败保留 ASR raw。

Speaker、TTS 和 LLM 失败时允许核心字幕链降级；ASR 或翻译不可用时禁止新建在线会话。
`/health/release-ready` 必须对所有已声明能力做真实探测，不得只检查环境变量。

## 3. 证据层级

每项分别记录：

1. `code_ready`：代码和自动化通过。
2. `deployed`：指定镜像、配置和模型已启动，真实请求通过。
3. `device_accepted`：指定 App build 与同一服务器候选完成真机验收。
4. `release_accepted`：容量、安全、隐私、监控、回滚和发布配置全部通过。

任何一层都不能代替下一层。模型隔离评测不能直接计为生产部署或真机验收。

## 4. 第一批硬门

- 候选 manifest 同时包含 commit、tree、dirty、source diff、image、config、model 和 mobile 指纹。
- Gateway、容器总健康和模型服务健康结论一致。
- 真实 ASR → MT → TTS 请求与独立 Speaker 请求通过。
- 结束/flush 100 次，尾段原文和译文保存率均不低于 99%。
- 30 分钟、至少 100 段长会话，无丢帧、重复结算、迟到反写和残留 hold。
- 当前 iPhone build 的 bundle、版本、API/Gateway 地址和候选 manifest 一致。

## 5. 禁止事项

- 不清理、覆盖、暂存或提交 `outputs/`。
- 不把现有 227 个 tracked WIP 一次性提交。
- 不把测试密钥、私有 env、号码、语音或 PCM 写入 Git。
- 不写死 Beelink/Tailscale 地址；运行地址通过 env 或验收参数注入。
- 未留回滚点不得重启、替换或部署 Beelink 服务。
- 未通过同一候选的端到端门，不得宣称“生产通过”。
