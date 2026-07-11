# 在线同传真机测试文案与评价方案

## 目标

验证 iPhone 在线模式链路在真实播放语音下是否可产品化：

- App 创建在线 realtime session 成功。
- Qwen3-ASR 识别稳定，不再出现系统提示词泄漏。
- Hy-MT2 翻译方向正确，支持中英自动反向。
- 点击结束后 flush 尾音、保存历史、扣减用量、支持导出。
- 自动朗读开启时不打断下一句识别。

## 测试资产

- 文案数据：`data/realtime-online-eval/realtime-online-test-set-v1.jsonl`
- 生成脚本：`scripts/generate_realtime_online_eval_audio.mjs`
- 单条语音：`test-audio/realtime-online-eval-v1/m4a/*.m4a`
- P0 连续播放：`test-audio/realtime-online-eval-v1/p0-smoke.m4a`
- 全量回归：`test-audio/realtime-online-eval-v1/full-regression.m4a`
- 打分模板：`data/realtime-online-eval/realtime-online-evaluation-template.csv`

## 测试前设置

1. 手机加入 Tailscale。
2. App 登录测试账号。
3. 同传页选择：
   - 模式：在线
   - 源语言：自动识别
   - 目标语言：自动反向
   - 自动朗读译文：第一轮关闭，第二轮开启
4. 播放设备距离 iPhone 30 到 50 厘米，音量 60% 到 75%。
5. 确认服务健康：
   - `http://100.126.244.70:3110/health`
   - `http://100.126.244.70:3111/health`
   - `http://100.110.127.117:8021/health`

## 执行步骤

1. 播放 `p0-smoke.m4a`，App 点击“开始”。
2. 观察每一句是否出现原文和译文。
3. 音频结束后等待 3 秒，点击“结束”。
4. 打开历史详情，确认每条记录有原文和译文。
5. 导出 Markdown，确认内容无系统提示词。
6. 查看余额是否扣减。
7. 第二轮开启自动朗读译文，重复 P0 测试，重点观察朗读后下一句是否继续识别。
8. 如果 P0 通过，再播放 `full-regression.m4a`。

## 评价指标

总分 100 分：

- 链路稳定性 20 分：不闪退、不掉线、可结束保存、无空历史。
- ASR 识别 25 分：中文 CER、英文 WER、数字/专有名词、尾音 flush。
- 翻译质量 25 分：方向正确、语义准确、术语保留、无拒答。
- 延迟体验 15 分：首字幕、最终字幕、译文出现时间。
- 产品闭环 15 分：历史、导出、用量扣减、自动朗读。

## 通过标准

P0 必须满足：

- App 无闪退、无连接断开。
- P0 每条至少出现一个 `transcript.final` 和一个 `translation.final`。
- 不出现 `Verbatim ASR`、`Prefer these protected terms`、`Do not translate` 等提示词。
- 中文主要语义完整，关键数字/名称不丢失。
- 英文和中文快速切换时，翻译方向至少 8 成正确。
- 点击结束后历史记录非空，Markdown 导出非空。

建议量化阈值：

- 中文 CER：P0 平均不高于 0.12。
- 英文 WER：P0 平均不高于 0.18。
- 翻译人工评分：P0 平均不低于 4/5。
- 首个字幕延迟：不高于 2.5 秒。
- 最终译文延迟：说话停止后不高于 4 秒。
- 结束 flush：点击结束后 3 秒内保存尾句。

## 缺陷分级

- P0 阻塞：闪退、无法登录、无法建 session、无字幕、历史为空、提示词泄漏。
- P1 严重：连续两句以上无翻译、自动反向大面积错误、朗读后 ASR 中断。
- P2 普通：个别长句断句不好、术语翻译不稳定、延迟偶发偏高。
- P3 优化：措辞不够自然、标点不佳、轻微重复。

## 记录要求

每轮测试记录：

- App 版本/安装方式。
- 服务 Provider：Qwen3-ASR、Hy-MT2、VoxCPM2。
- 测试音频文件名。
- 是否开启自动朗读。
- 每条测试的 ASR、译文、延迟、评分、问题截图。
- Gateway 是否有 backpressure 日志。
- API session id、segmentCount、consumedSeconds。
