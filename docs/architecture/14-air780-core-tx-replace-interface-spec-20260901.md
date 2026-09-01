# Air780EHV CORE TX Replace 接口与验收规格

状态：`DESIGN_FROZEN / PUBLIC_API_UNSUPPORTED / VENDOR_CORE_REQUIRED / DEVICE_NOT_IMPLEMENTED`

## 1. 目标

在同一真实 VoLTE 通话和同一 `communicationSessionId/callGeneration` 内实现：

1. 物理 MIC 到 cellular TX 的数字路由被明确阻断；
2. 本地 MIC 如有需要仍可独立采集，但不得进入蜂窝上行；
3. 只有获准的 PCM（翻译 TTS、Voice Agent TTS 或人工接管）进入 cellular TX；
4. underrun、worker/Gateway死亡、USB断开、旧generation或route异常时保持 `ERROR_MUTED`，
   不得自动回退到物理 MIC；
5. 每次状态变化返回由CORE实际路由状态生成的receipt，而不是Lua层回显请求参数；
6. 电话下行提取在TX replace期间继续工作。

## 2. 已证伪的替代方案

- `exaudio.mic_vol(0)`：ES8311寄存器可非零探针后写0并读回0，但两通真实电话启动低噪不变；
- `cc.extern_source + cc.input`：公开定义是向录音/上行通道“附加”第三方源，不是替换源；
- 连续写零PCM：外部源和首块input可成功ACK，但不阻断默认cellular TX；
- 调整connected时序、record/source顺序或100→200ms节拍：主机测试通过、真实低噪不变；
- `cc.record(true)`：同步返回成功，但真实通话没有record callback/AUDIO_DOWNLINK。

因此禁止再以Lua布尔返回、codec volume读回、创建source成功、主观听感或零PCM写入量宣称
`TX_REPLACE_PROVEN`。

## 3. 公开CORE现状与缺口

当前公开 `cc` Lua导出只有：
`init/dial/accept/hangUp/lastNum/quality/on/record/extern_source/input`。公开音频请求合同把外部文件、TTS和stream定义为
`is_add_record=1` 时“附加到录音通道”。公开结构存在 `extern_record_source` 和
`luat_audio_request_record_pause()`，但没有以下受支持能力：

- 独立关闭 physical capture while keeping external record source active；
- cellular TX source select：`PHYSICAL_MIC / EXTERNAL_ONLY / MUTED`；
- 查询Modem/DSP实际生效route；
- route epoch/call epoch；
- underrun时禁止native MIC fallback；
- TX replace状态变更receipt；
- TX replace与downlink extraction并行保证。

Air780EHV官方资料声明不支持C-SDK开发，因此公开LuatOS仓库只能用于接口审计，不能作为
该型号可交付CORE的自行构建依据。实现必须由合宙在Air780EHV对应BSP/Modem audio path中完成。

## 4. 最小CORE C接口

名称可以由供应商调整，但语义不得弱化：

```c
typedef enum {
    LUAT_CC_TX_NATIVE_MIC = 0,
    LUAT_CC_TX_MUTED = 1,
    LUAT_CC_TX_EXTERNAL_ONLY = 2,
    LUAT_CC_TX_ERROR_MUTED = 3,
} luat_cc_tx_route_t;

typedef struct {
    uint32_t call_epoch;
    uint32_t route_epoch;
    uint32_t generation;
    uint32_t sample_rate;
    uint32_t applied_at_ms;
    uint32_t queue_free_bytes;
    luat_cc_tx_route_t requested_route;
    luat_cc_tx_route_t applied_route;
    uint8_t bits_per_sample;
    uint8_t channels;
    uint8_t physical_mic_blocked;
    uint8_t external_injection_enabled;
    uint8_t native_fallback_disabled;
    uint8_t downlink_extraction_active;
    uint8_t fault_latched;
    int32_t result_code;
    uint8_t core_build_digest[32];
    uint8_t state_digest[32];
} luat_cc_tx_route_receipt_t;

int luat_cc_tx_replace_capability(luat_cc_tx_route_receipt_t *receipt);

int luat_cc_tx_replace_begin(
    uint32_t generation,
    uint32_t sample_rate,
    uint8_t bits_per_sample,
    uint8_t channels,
    luat_cc_tx_route_receipt_t *receipt);

int luat_cc_tx_replace_write(
    uint32_t generation,
    uint32_t media_sequence,
    const void *pcm,
    uint32_t pcm_bytes,
    luat_cc_tx_route_receipt_t *receipt);

int luat_cc_tx_replace_mute(
    uint32_t generation,
    luat_cc_tx_route_receipt_t *receipt);

int luat_cc_tx_replace_restore_native(
    uint32_t generation,
    uint8_t local_user_confirmed,
    luat_cc_tx_route_receipt_t *receipt);

int luat_cc_tx_replace_query(luat_cc_tx_route_receipt_t *receipt);
```

### 强制语义

- `begin()` 成功必须表示 `applied_route=EXTERNAL_ONLY`、`physical_mic_blocked=1`、
  `external_injection_enabled=1`、`native_fallback_disabled=1`，且这些字段来自实际route readback；
- 若只能“添加”外部源，必须返回 `UNSUPPORTED`，不能返回成功；
- `write()` 只接受当前call epoch与generation；duplicate可幂等，旧generation必须100%拒绝；
- queue underrun时保持数字静音或无上行，进入 `ERROR_MUTED`，绝不恢复MIC；
- `mute()` 必须保留MIC阻断，仅停止外部PCM；
- `restore_native()` 只允许本机当前用户明确确认后执行；
- hangup后清理当前call epoch，下一通默认native route，但旧generation写入继续拒绝；
- receipt的`state_digest`必须覆盖所有route字段、call/route epoch、generation、格式和CORE build；
- receipt digest用于证据关联，不等同于用户授权或密码学身份认证。

## 5. Lua层最小封装

供应商CORE完成后再暴露Lua；Lua不得自行推断成功：

```lua
local ok, receipt = cc.tx_replace("begin", {
    generation = generation,
    sample_rate = 16000,
    bits_per_sample = 16,
    channels = 1,
})

local ok, written, receipt = cc.tx_replace_input(
    generation, media_sequence, pcm, false)

local ok, receipt = cc.tx_replace("mute", {
    generation = generation,
})

local ok, receipt = cc.tx_replace("query", {})
```

Lua/Gateway只有在receipt同时满足以下字段时才允许上报`mediaSafeReady`：

```text
applied_route=EXTERNAL_ONLY
physical_mic_blocked=1
external_injection_enabled=1
native_fallback_disabled=1
fault_latched=0
call_epoch=current
generation=current
downlink_extraction_active=1
```

任何字段缺失、无法readback、route epoch变化或digest不一致都必须fail closed并请求唯一挂断。

## 6. 状态机

```text
IDLE
  -> ARMING
  -> EXTERNAL_ONLY_MUTED
  -> EXTERNAL_ONLY_INJECTING
  -> EXTERNAL_ONLY_MUTED
  -> RESTORING_NATIVE
  -> NATIVE

任意运行态故障
  -> ERROR_MUTED
  -> 只允许挂断或本机确认后的RESTORING_NATIVE
```

禁止路径：

```text
underrun/worker death/USB loss/reconnect
  -X-> NATIVE_MIC
```

## 7. VUART/Gateway合同

不得修改现有VUART v1 golden payload冒充兼容。CORE接口落地后新建显式版本，至少新增：

- `TX_ROUTE_COMMAND`：begin/mute/query/restore；
- `TX_ROUTE_RECEIPT`：上述固定字段与state digest；
- `TX_MEDIA_ACK`：generation、media sequence、written、queue free、route epoch；
- `TX_ROUTE_FAULT`：fault code、latched route、old-generation drops；
- `DOWNLINK_STATUS`：callback count、bytes、gap及与route epoch的绑定。

Node/Lua golden vectors、非法长度、CRC、旧generation、重复receipt、跨boot receipt和未知字段拒绝
必须先于板端运行。

## 8. 真实验收

只有以下全部通过才可写 `PSTN_TX_REPLACE_PROVEN`：

1. 精确CORE build、BSP、baseband、SIM、route、call epoch和generation绑定；
2. 外部扬声器向物理MIC播放MIC_MARKER，本地独立capture持续检测到；
3. 远端MIC_MARKER低于预冻结泄漏阈值；
4. 注入端写入与MIC_MARKER正交的TTS_MARKER，远端稳定检测；
5. 远端同时满足TTS_MARKER存在、MIC_MARKER为0；
6. 数字route receipt持续为EXTERNAL_ONLY，期间无route epoch异常；
7. TTS停止、queue underrun、Gateway/worker死亡、USB断开、重连时保持ERROR_MUTED；
8. 旧generation帧和旧receipt为0回流；
9. downlink extraction持续工作并进入Gateway/LiveKit；
10. 挂断后队列0、generation失效、route恢复健康；
11. 人工恢复必须在同一通话内由本机用户确认，且恢复顺序可复核；
12. 独立评审通过前最多写 `AIR780_TX_REPLACE_CANDIDATE/TX_REPLACE_PROBED`，不能写PASS。

## 9. 合宙供应商交付清单

请求合宙提供：

1. 基于精确Air780EHV V2048-113 64-bit的定制CORE或后续正式版本；
2. 实际Modem/DSP/codec route readback，而非Lua状态回显；
3. 上述等价C API、Lua binding、返回码和线程/生命周期说明；
4. physical MIC block与external-only injection同时成立的设计说明；
5. underrun/进程死亡/串口断开时no-native-fallback说明；
6. TX replace与电话下行record并行支持说明；
7. 源码patch或可审计diff、build manifest、CORE SHA-256、symbol map和版本绑定；
8. host单元测试、板端自测和一键恢复官方CORE的方法；
9. 明确是否支持三运营商VoLTE及8k/16k通话质量；
10. 若无法提供真实route readback或no-fallback保证，书面返回UNSUPPORTED。

在收到供应商接口、定制CORE及单独刷写授权前，本项目保持：

```text
CORE_TX_REPLACE = BLOCKED_VENDOR_CORE_API
PSTN_TX_REPLACE_PROVEN = false
GATE0B = BLOCKED_UNVERIFIED
```
