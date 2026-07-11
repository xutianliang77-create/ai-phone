# ai phone 真人说话人分离门禁协议

版本：v1.0
日期：2026-07-11

## 1. 目标

用有明确说话人真值的真人录音验证 `diar_streaming_sortformer_4spk-v2.1`。无 RTTM 的会议录音只能作为 shadow 稳定性证据，不能计算 DER，也不能决定 Gateway 是否开启。

所有 Beelink 持久文件统一放在：

```text
/data/models/translation-model-eval/eval/speaker/human-gate-v1/
```

## 2. 录音要求

- 录音前获得所有参与人的明确同意，仅保存匿名编号 `speaker_1` 到 `speaker_4`。
- 手机固定放在桌面中央，不在录音中移动；关闭系统降噪增强或后期剪辑。
- 原始录音可为 M4A/WAV；门禁输入统一转换为 24 kHz、单声道、PCM16 WAV。
- 每个场景开头保留 1 秒静音并拍手一次，结尾保留 1 秒静音。
- RTTM 必须按实际发声时间标注；笑声、语气词和抢话也要标注，重叠区间允许多行同时存在。
- 每个质量场景至少录制两次；不得把一段录音复制循环后当成质量语料。

## 3. 场景矩阵

| ID | 人数 | 时长 | 内容 | 门禁重点 |
| --- | ---: | ---: | --- | --- |
| `human_2spk_quiet` | 2 | 5 分钟 | 普通中文问答，每人至少 20 轮 | 基础 DER、标签稳定 |
| `human_2spk_fast` | 2 | 3 分钟 | 0.5 至 1.2 秒短句快速交替 | evidence latency、快速切换 |
| `human_2spk_overlap` | 2 | 3 分钟 | 至少 20 次 0.3 至 1 秒抢话 | overlap、主 speaker |
| `human_2spk_bilingual` | 2 | 4 分钟 | 一人中文、一人英文，再交换语言 | 中英域外稳定性 |
| `human_2spk_noise` | 2 | 4 分钟 | 电视或会议背景声下交谈 | 噪声 DER、误检 |
| `human_4spk_meeting` | 4 | 8 分钟 | 四人会议、轮流发言和少量抢话 | 四槽位、长会话漂移 |

## 4. 推荐台词结构

普通问答应覆盖姓名、数字、时间、地址、产品术语和自然口语。快速切换场景每人交替读下面类型的短句，不能反复读同一句：

```text
speaker_1：今天下午三点开会。
speaker_2：会议室在几楼？
speaker_1：请把地址发给我。
speaker_2：订单号是 A-120。
speaker_1：我们需要确认交付时间。
speaker_2：明天下午可以完成。
```

双语场景先由 `speaker_1` 说中文、`speaker_2` 说英文，录音中段交换语言，验证标签跟随声纹而不是语言。

## 5. RTTM 格式

每行格式：

```text
SPEAKER <recording_id> 1 <start_seconds> <duration_seconds> <NA> <NA> <speaker_id> <NA> <NA>
```

示例：

```text
SPEAKER human_2spk_overlap 1 1.240 2.180 <NA> <NA> speaker_1 <NA> <NA>
SPEAKER human_2spk_overlap 1 2.900 1.100 <NA> <NA> speaker_2 <NA> <NA>
```

第二行与第一行在 `2.900-3.420` 秒重叠，这就是有效的 overlap 真值。

## 6. 数据目录

```text
human-gate-v1/
  human_2spk_quiet/
    audio.wav
    reference.rttm
    suite.json
    predictions.json
    report.json
  human_2spk_fast/
  human_2spk_overlap/
  human_2spk_bilingual/
  human_2spk_noise/
  human_4spk_meeting/
```

不得在文件名、RTTM、日志或导出中写参与人的真实姓名。

## 7. 转换与评分

将原始录音转换为 24 kHz PCM16 后上传 `/data`。RTTM 转 suite：

```bash
python /data/models/translation-model-eval/tools/rttm_to_speaker_suite.py \
  --audio /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/audio.wav \
  --rttm /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/reference.rttm \
  --case-id human_2spk_quiet \
  --output /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/suite.json
```

调用 8022 shadow：

```bash
python /data/models/translation-model-eval/tools/stream_speaker_service_eval.py \
  --base-url http://127.0.0.1:8022 \
  --api-key "$SPEAKER_SERVICE_API_KEY" \
  --audio /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/audio.wav \
  --output /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/predictions.json \
  --frame-ms 80 \
  --max-speakers 2
```

正式评分：

```bash
python /data/models/translation-model-eval/tools/evaluate_speaker_predictions.py \
  --suite /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/suite.json \
  --predictions /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/predictions.json \
  --output /data/models/translation-model-eval/eval/speaker/human-gate-v1/human_2spk_quiet/report.json \
  --max-der 0.15 \
  --max-latency-ms 1200
```

## 8. 验收阈值

| 指标 | 安静双人 | 噪声/重叠 | 四人 |
| --- | ---: | ---: | ---: |
| raw DER | `<=15%` | `<=25%` | `<=25%` |
| evidence latency P95 | `<=1200ms` | `<=1500ms` | `<=1500ms` |
| 额外 speaker 槽位 | `0` | `0` | `0` |
| 服务错误或重启 | `0` | `0` | `0` |

双语场景还要求交换语言前后 speaker ID 保持跟随真人；不得把语言变化误判为说话人变化。

全部场景通过后，才允许在测试 Gateway 设置 `SPEAKER_PROVIDER=http`，随后执行 iPhone 字幕、历史重命名、纪要和导出验收。任何一个质量场景失败时 Gateway 继续保持 `off`。
