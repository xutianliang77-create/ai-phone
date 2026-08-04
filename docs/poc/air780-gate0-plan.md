# Air780EHV Gate 0A 采集 / Gate 0B VoLTE 上行注入

状态：`Gate 0A PASS / Gate 0B BLOCKED_UNVERIFIED`
日期：2026-08-04

本文件是硬件 Gate 0 子计划。完整 Gate 0–7 执行顺序、逐项用例、证据等级和
运行模板见：

- `docs/acceptance/air780-full-test-and-acceptance-plan-20260803.md`
- `docs/acceptance/air780-test-case-matrix-20260803.csv`
- `docs/acceptance/air780-test-run-template.md`

## 结论

Gate 0 已按硬件现实拆分：

- Gate 0A 已通过：Air8780V4/Air780EHV、V2046-113 CORE、诊断脚本 007
  (`audio_v2`) 已在真实 VoLTE 中取得双向 16 kHz PCM；每路固定
  6,400 bytes/200 ms，COUNT_ONLY 59.542 秒和原始 VUART 15.359 秒均无
  sequence gap。
- Gate 0B 仍未验证：当前不能宣称 Air780EHV 已支持无界AI连续实时译音注入。
- Air780EHV 示例出现 `cc.extern_source()` + RAW `zbuff`，说明存在裸 PCM
  调用形态，但现有证据只证明一次性内存文件源；没有证明连续拼接、clear、打断、
  来去电生命周期、远端可懂度和 30 分钟稳定运行。
- 因此必须取得 Gate 0B 数字路径或模拟音频桥路径的实测结论，才能进入生产
  App/Worker/Agent
  主链开发。

完整冻结资产、Windows 证据和当前 Beelink USB 只读快照见
`docs/poc/air8780v4-v2046-113-hardware-baseline-20260804.md`。

官方参考：

- <https://docs.openluat.com/osapi/core/cc/>
- <https://docs.openluat.com/air780ehv/luatos/app/volte/audio_play_to_call/>

## Gate 0B-D：量产固件连续数字 PCM

当前 CORE 与 Lua 资产已锁定；Gate 0B-D 仍需补齐：

1. `cc.extern_source()` 连续 PCM 上行的缓冲区所有权、`EXT_SRC_DONE`、
   refill/underrun/clear 语义。
2. 有限 RAW zbuff 可复现 PoC，禁止用整文件播放或模块内置 TTS 代替。
3. 8/16 kHz PCM16LE mono 连续拼接、远端可懂度和端到端延迟。
4. 呼入/呼出、接通前后、对端挂断、USB/VUART 重连时的生命周期。
5. 30 分钟长稳、真实打断、旧 generation 清理和原声泄漏 0。

## Gate 0B-C：ESP32-S3 + ES8388 模拟音频桥

如果数字路径缺少可复现 PoC 或长稳证据，转模拟音频桥。该路径仍需验证：

- Air 模拟音频引脚电平、隔离、阻抗、增益、回声、底噪和双向串扰。
- 8/16 kHz 重采样、AEC/NS 的唯一责任点，避免重复处理。
- 电源、USB、温升、弱信号、VoLTE 编解码和批量一致性。
- 成本/BOM、产测、固件升级和故障恢复。

## 不可缩减的验收矩阵

| 项目 | 输入/动作 | 必须保存的证据 | 通过条件 |
| --- | --- | --- | --- |
| 格式 | 8/16 kHz PCM16LE mono | 原始输入、对端录音、参数 | 采样率/通道/字节序一致 |
| 频响 | 1 kHz、扫频 | 输入与对端 WAV、频谱 | 无明显截断/错速/爆音 |
| 人声 | 中英、数字、静音 | 双端录音、时间线 | 可懂、无重复旧缓冲 |
| 长稳 | 连续 30 分钟 | RSS/队列/丢帧/温度 | 无线性增长、无卡死 |
| 生命周期 | 500 次 start/stop | 每次 command/event | 无重复拨号、无残留播放 |
| 打断 | TTS 中途 clear | generation/queue 时间线 | 旧音频不继续回流 |
| 重连 | 拔插 USB/VUART | lease/fence/event | 旧 fence 永久失效 |
| 状态 | 振铃/接通/挂断 | 模块事件与对端证据 | 模块事件为权威且对账一致 |

## 当前软件证据

- 板端真实回调为每路 6,400 bytes/200 ms。主机接入 LiveKit 时必须在 Beelink
  侧重切为 10 × 640-byte/20-ms 帧；不得修改已稳定的板端缓冲。
- VUART v1 host codec 已实现：magic/version/type/flags/sequence/timestamp/
  payload length/CRC32，音频固定 20 ms。
- 模拟设备已验证 commandId 幂等、stale fence 拒绝和 carrier event 权威状态。
- LiveKit guest 模拟适配已验证 `autoSubscribe=false`，只发布 Air 电话下行，
  只订阅精确目标 TTS track。
- VUART v1 是生产目标合同；诊断脚本 007 的 `WJAI/1` 文本头是硬件证据协议，
  两者不能冒充已经完成跨语言生产协议互通。
- 模拟软件证据不是完整真实 LiveKit 验收；Gate 0A 的真实采集证据也不能替代
  Gate 0B 注入证据。

## Gate 决策

- `PASS_0A_CAPTURE`：已取得，仅证明真实双向 PCM 采集。
- `PASS_0B_DIGITAL`：数字注入全矩阵通过，可进入真实数字桥 Phase B。
- `PASS_0B_BRIDGE`：模拟音频桥全矩阵通过，可进入模拟桥 Phase B。
- `FAIL_0B`：两条注入路径均不通过，停止电话产品化，不修改生产主链掩盖
  硬件阻塞。
