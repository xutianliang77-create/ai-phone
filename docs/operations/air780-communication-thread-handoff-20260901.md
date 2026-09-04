# 无界AI Air780 通讯模块线程交接

更新时间：2026-09-01 11:50（Asia/Shanghai）

状态：`THREAD_CLOSED / CONTROL_PATH_PARTIAL / MEDIA_PATH_FAILED / VENDOR_CORE_BLOCKED`

## 1. 唯一生产仓库与Git状态

- 生产仓库：`/Users/xutianliang/Downloads/ai phone`
- 当前分支：`codex/optimization-m2-flexible-subtitles`
- 当前HEAD：`0422d2fc166a9ea5772fbab2259cfa632ec6d548`
- upstream：`origin/codex/optimization-m2-flexible-subtitles`
- upstream相对HEAD：behind 0 / ahead 9
- 本线程没有commit或push。
- 工作树包含既有及本线程叠加的Air firmware、bundle、测试、架构文档WIP；不得reset、checkout、
  clean、覆盖或批量暂存。
- `outputs/`包含用户历史证据及本线程bundle/evidence，必须保留。
- `PROGRESS_LOG.md`被`.gitignore`忽略，但已持续更新，恢复工作时必须先读顶部。

恢复第一步：

```bash
cd '/Users/xutianliang/Downloads/ai phone'
git status --short
git rev-parse HEAD
git rev-list --left-right --count '@{upstream}...HEAD'
git diff --check
sed -n '1,420p' PROGRESS_LOG.md
```

## 2. 当前部署与后台状态

线程收尾fresh snapshot：

```text
Air780 firmware:       001.007.000
Gateway ready:         true
HELLO/heartbeat:       observed
device DB status:      ready
heartbeat age:         about 0.19 s
active lease:          0
unfinished call:       0
LiveKit Air room:      absent
audio queue:           0
TTS queue:             0
VUART invalid frames:  0
serial recovery:       idle
```

- Air780物理连接在Windows；COM3是用户VUART，COM4/COM5是模块日志端口。
- Windows bridge保持运行：COM3/115200、DTR on，数据路径仍是既有TCP配置；Luatools已关闭。
- Beelink单一`ai-phone-wujie-ai`应用容器保持运行，本线程没有重启容器。
- 所有维护SSH ControlMaster均已关闭。
- 以上仍是收尾时快照；未来动作前必须重新实时探测。

## 3. 本线程完成的代码/合同

### 3.1 VUART与Gateway纯软件闭环

- VUART v1 binary envelope、Node/Lua golden vectors、command ingress/replay guard已存在并保持。
- commandId重复副作用恰好一次；相同ID不同payload冲突；旧fence/generation拒绝。
- 6,400-byte/200-ms device chunk在Gateway重切10×640-byte/20-ms frame；板端buffer未改。
- 队列、gap/drop/duplicate/out-of-order/backpressure、旧generation清理已有测试。
- Carrier状态与LiveKit participant状态分离；joined不能提升carrier connected。
- Windows真实bridge使用COM3/115200/DTR on；热恢复不需要重启整个无界AI容器。

### 3.2 production firmware 001.007.000

主要文件：

- `firmware/air780-livekit-bridge/production/main.lua`
- `firmware/air780-livekit-bridge/vuart_v1_cc.lua`
- `firmware/air780-livekit-bridge/vuart_v1_uplink.lua`
- `firmware/air780-livekit-bridge/vuart_v1_mic_guard.lua`
- `firmware/air780-livekit-bridge/PROD_FLASH_MANIFEST.tsv`
- `firmware/air780-livekit-bridge/PROD_USB_FLASH_MANIFEST.tsv`

已实现：

- V2048及`cc.extern_source/cc.input`存在性门禁；
- ES8311 MIC非零探针后写0并读回0，失败时不进入READY；
- `CONNECTED/SPEECH_START`不提前对Gateway上报connected；
- 只有`AUDIO_START→record→external source→首块零PCM ACK`后上报connected；
- record-before-source；source失败时record回滚；
- duplicate AUDIO_START副作用一次；
- 16k 6,400-byte/200-ms或8k 3,200-byte/200-ms静音节拍；
- partial/zero write按`free_len`计算10–200ms有界重试；
- 每3秒`vuart_v1_media cc/source`结构化SoC日志，不含号码/文本/PCM；
- VUART v1 payload/golden vectors未因诊断字段被偷偷修改。

最终USB bundle：

```text
outputs/air780-livekit-tts/windows-bundles/VUARTV1_PROD_USB_001007000
file count: 12
manifest SHA-256:
b53441909069f130e1d5c485dbefc6faf37d4663bc0f655512ce86543380bcaf
```

关键hash：

```text
main.lua:
ea91ca10ba0c34a3e79f6d367db7c8581426e86174c5be269219303b5dfb54eb

vuart_v1_cc.lua:
aab52f92c972f6396c68dfb508afb2267460ccb9899562f7b0e76f2c5bbe4323

vuart_v1_uplink.lua:
0ead648ae9d29f3314470472034d6d711e2e9aee0d0bc8ea56989f936fd7465c
```

## 4. 主机验证结果

```text
Air Device Gateway: 45 files / 243 tests PASS
Scripts:            1050 files / 3950 tests PASS
Final targeted:     30 files / 101 tests PASS
All workspace TypeScript typecheck: PASS
File-size gate:     PASS
Manifest/hash:      PASS
git diff --check:   PASS
```

`check:air780-livekit-tts-bridge`没有运行成功，因为它需要真实LiveKit/TTS地址和凭据并会创建room、
调用TTS；本地开发shell故意没有这些生产配置。本线程没有注入秘密或伪造通过。

## 5. 真实板端与电话证据

### 5.1 部署通过

- 用户在Windows手动完成语法检查与“仅下载脚本”。
- FlashToolCLI实际只烧`flexfile2/script.bin`；100%、TryDownload success、Burn OK、Burnbatch OK。
- CORE保持`LuatOS V2048 113 64bit`；fs/kv未清；未用USB BOOT。
- 板端日志：`MIC_INPUT_MUTED 9 0`、`READY ... 001.007.000 V2048`。
- 230条空闲`vuart_v1_media`日志连续输出，空闲record/source/input计数为0。
- Gateway无需重启即识别001.007，HELLO/heartbeat与协议计数正常。

部署证据：

```text
outputs/air780-livekit-tts/evidence/001007000-20260901/
```

### 5.2 generation 63真实电话失败

- 唯一DIAL，replayed=false；Host入房且`publishesAudio=false`；未发送TTS。
- carrier connected约28.015秒后由对端/运营商断开；没有第二次DIAL。
- 用户反馈启动低噪“同上次差不多”。
- connected事件证明record/source/首块零PCM调用至少同步返回成功，但低噪不变。
- 通话前、中、后`routedAudioChunks=94/publishedFrames=940`完全不增；Air780下行PCM仍未到Gateway。
- TTS、protocol、queue、outbox均干净；终态active lease/call为0。

证据：

```text
outputs/air780-livekit-tts/evidence/001007000-20260901/call-generation-63/
```

重要取证限制：通话结束后重开Luatools会复位模块，累计media计数清零；post-reboot全0不是通话
证据。以后必须通话前启动不复位的COM4采集，或先定义新VUART诊断frame。

## 6. 最终功能状态

```text
M1 App/Carrier control:      PARTIAL
真实单次DIAL/carrier状态:    PASS
真实挂断/终态数据库收口:     PASS（本通为远端/运营商断开）
VUART/heartbeat/recovery:    PASS
LiveKit Air入房:             PASS

M2 Air780 downlink PCM:      FAIL
App听到电话对方声音:         BLOCKED
ASR/翻译Worker电话下行:      BLOCKED

M3 TTS-only PSTN TX:         BLOCKED_VENDOR_CORE_API
physical MIC隔离:            NOT PROVEN
PSTN TX replacement:         NOT PROVEN
Gate 0B:                     BLOCKED_UNVERIFIED
产品端到端可用:              NO
```

## 7. 已证伪路线

不得继续把以下内容冒充TX Replace：

- `exaudio.mic_vol(0)`或ES8311寄存器读回0；
- `cc.extern_source`返回true；
- `cc.input`写入零PCM；
- connected延迟到AUDIO_START；
- record/source顺序变化；
- 100ms改200ms静音泵；
- 主观听起来暂时变安静。

官方文档和公开源码明确将external source定义为“附加到录音/上行通道”，没有physical MIC
source-select、TX replace、route readback或no-native-fallback保证。Air780EHV官方资料还声明该
型号不支持C-SDK开发，因此不能依靠公开仓库自行编译可交付CORE。

## 8. 后续唯一推荐路线（暂缓）

已冻结规格：

```text
docs/architecture/14-air780-core-tx-replace-interface-spec-20260901.md
```

状态：

```text
DESIGN_FROZEN
PUBLIC_API_UNSUPPORTED
VENDOR_CORE_REQUIRED
DEVICE_NOT_IMPLEMENTED
```

需要合宙提供精确Air780EHV/V2048-113定制CORE或正式新版本，具备：

- physical MIC block；
- `EXTERNAL_ONLY/MUTED/ERROR_MUTED/NATIVE` source-select；
- Modem/DSP实际route readback；
- call epoch、route epoch、generation-bound receipt；
- underrun/worker/USB故障时no-native-fallback；
- TX replace期间downlink extraction继续工作；
- CORE SHA-256、build manifest、symbol map、源码patch或可审计diff。

供应商接口与artifact到达前不要实现mock成功路径，不要继续盲拨。联系供应商、下载/刷写定制
CORE均需要用户新的精确授权。

## 9. 收尾边界

- 本线程没有commit或push。
- 没有清理、移动或删除用户原有WIP与`outputs/`。
- Air780保持001.007在线；bridge和单容器继续运行；无活动电话。
- 后续若暂不做CORE路线，本线程可长期保持关闭，不影响普通控制面和其他无界AI开发。
