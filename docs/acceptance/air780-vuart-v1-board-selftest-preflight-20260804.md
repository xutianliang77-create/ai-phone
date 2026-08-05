# Air780 VUART v1 板端 Golden Self-test 预审

日期：2026-08-04
状态：`H3_NODE_LUA_GOLDEN_TARGET_PASS / V2048-113 / 2026-08-05`

## 1. 目标与非目标

本批把已冻结的生产 VUART v1 session/command codec 和 golden vectors 组成可启动的
LuatOS 板端自检包。历史 H2 已在冻结 CORE `V2046-113` 通过；当前 H3 新增独立
`AUDIO_UPLINK` golden vector，目标是在 production candidate CORE `V2048-113` 上重新
执行两个 self-test，证明目标 Lua/crypto runtime 与 Node 冻结字节完全一致。

这个包不实现生产 command loop、replay ledger、电话副作用或媒体桥，不打开用户
VUART，也不包含诊断 007 的 `WJAI/1` 文本协议。真机 golden PASS 仍不能提升
Gate 0B、PSTN 回灌或端到端电话状态。

## 2. 自检包

入口：`firmware/air780-livekit-bridge/main.lua`

固定文件清单和 SHA-256：
`firmware/air780-livekit-bridge/SELFTEST_MANIFEST.sha256`

包中八个 Lua 文件合计 49,416 bytes；连同 manifest 为 50,108 bytes，低于历史
Luatools 报告的 512 KB 脚本区。默认扩展库仍必须由 Luatools 添加；其中
`air153C_wtd` 与当前诊断 007 使用的 GPIO24 看门狗方案相同。

启动行为：

1. 初始化并每 10 秒喂 GPIO24 外部看门狗；
2. 运行 session payload/envelope golden self-test；
3. 运行 HELLO/HEARTBEAT/DIAL/HANGUP/DTMF/ACK/ERROR golden self-test；
4. 任一 suite 抛错或没有返回 `ok=true` 时输出 FAIL；只有两个 suite 都通过才输出
   `FINAL PASS`；
5. 不打开 if06，不拨号、不接听、不挂断、不发送 DTMF、不改变 COUNT_ONLY，也不执行
   音频注入。

预期 SoC log 标记：

```text
vuart_v1_selftest BEGIN WUJIE_AIR_VUART_V1_SELFTEST 001.001.000 ...
vuart_v1_selftest SESSION PASS air780.vuart.session-payload.v1
vuart_v1_selftest COMMAND PASS air780.vuart.command-payload.v1
vuart_v1_selftest FINAL PASS
```

## 3. TDD 与主机侧结果

首次合同测试按预期因缺少 `main.lua` 报 `ENOENT`；加入 runtime 后进入行为红灯，测试
发现实现通过通用 `run_suite` 包装 `pcall`，而初始断言错误地绑定为直接调用。断言改为
验证 `pcall(operation)` 及两个 suite 都进入包装器，没有减少失败隔离要求。随后增加
manifest 测试，第二次预期红灯为缺少 `SELFTEST_MANIFEST.sha256`。

当前定向测试：

```text
services/air-device-gateway/src/device/vuart-v1-lua-codec-contract.test.ts
13 tests PASS
```

最终无硬件回归：Air Device Gateway `15 files / 116 tests`、contracts
`8 files / 25 tests`、API Server `135 files / 471 tests` 全绿；全 workspace
TypeScript typecheck、文件大小门禁、manifest 复算和 tracked/相关 untracked
whitespace 检查均通过。既有 `outputs/` 未读取、未修改、未纳入检查目标。

该主机结果覆盖源码边界、两个 suite 引用、诊断文本隔离和所有 bundle 文件哈希；目标
LuatOS 执行证据已在 2026-08-05 按第 6 节补齐。

## 4. 冻结资产与回滚入口

2026-08-04 本机重新复算：

| 资产 | SHA-256 |
| --- | --- |
| `LuatOS-SoC_V2046_Air780EHV_113.soc` | `61450d271b83611ff4b0c1c6a930b4c2e7ee77cde0ef95ad88ef431a9cb40b1a` |
| Windows `Luatools_v3.exe` | `6991ef696b915a5315929a176144150a520c68176649ffd391804c31229d81cc` |
| 诊断 007 `main.lua` | `2399245b9bc3bc6a5ee9326b3592fa4221cd75ae8f124fca7a316b0009d3e525` |

路径：

- CORE：`/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/v2046/official/`
- Windows Luatools：`/Users/xutianliang/Documents/ai音箱/firmware/tools/windows/`
- 007 回滚脚本：
  `/Users/xutianliang/Documents/ai音箱/firmware/air780ehv/phone-audio-gate0-diagnostic-007/main.lua`

官方 Luatools 当前要求 Windows 10 或更高版本，不支持 Mac/Linux：
<https://docs.openluat.com/common/Luatools/>。Air780EHV 官方流程要求选择正确 CORE、
脚本和默认 lib：<https://docs.openluat.com/air780ehv/luatos/common/download/>。

## 5. 真机执行门禁

当前 Air780 物理接在 Windows Luatools 主机，用户已授权脚本级刷写和测试；仍不得引入
第三方烧录器、Wine、Windows VM/USB passthrough 或 FOTA 绕过官方 Luatools，也不得
清 KV/FS、使用 USB BOOT 或在本自检阶段拨号。

执行顺序固定为：

1. 重新核对 USB、当前 V2048 Gate0B 版本、`audio_v2`、无活动通话和所有资产哈希；
2. 关闭所有 COM 句柄和探针；
3. 在 Luatools 对八个 Lua 文件执行目标 64-bit Lua 语法检查；
4. 选择已验证的 V2048-113 项目 CORE，但只点击“下载脚本”；
5. 保持“忽略脚本依赖性”“清除 KV”“清除 FS”“USB BOOT 下载”全部关闭；
6. 保存 Luatools 下载结果、SoC log 原文、起止时钟和包 manifest；
7. 只有 SESSION、COMMAND、FINAL 三个 PASS 同时出现且无重启循环，才记录
   `H3_NODE_LUA_GOLDEN_TARGET_PASS`；
8. 自检取证后立即下载 production `001.002.000` 九文件包并先做无通话
   HELLO/HEARTBEAT/capability 预检；只有整个 production 联调结束或中止时，才恢复冻结
   V2046-113/诊断007并重新确认 007/audio_v2/COUNT_ONLY=true。

任何语法、下载、启动或 suite 失败都停止，不改 CORE、不降到诊断 006、不放宽
golden vector，也不继续 Gate 0B。

## 6. H3 目标板执行结果

2026-08-05 在 Windows Luatools 选择已核验的 V2048-113 CORE 项目依赖，仅下载 H3
`001.001.000` 八文件脚本包。危险选项保持关闭，没有打开用户 VUART、拨号、接听或注入
音频。目标板 SoC trace 原文为：

```text
[2026-08-05 10:22:07.488][000000000.373] I/user.vuart_v1_selftest BEGIN WUJIE_AIR_VUART_V1_SELFTEST 001.001.000 V2048
[2026-08-05 10:22:07.696][000000000.934] I/user.vuart_v1_selftest SESSION PASS air780.vuart.session-payload.v1
[2026-08-05 10:22:07.700][000000000.935] I/user.vuart_v1_selftest COMMAND PASS air780.vuart.command-payload.v1
[2026-08-05 10:22:07.703][000000000.935] I/user.vuart_v1_selftest FINAL PASS
```

原始 Windows trace：108,746 bytes，最后写入
`2026-08-05T10:22:11.722+08:00`，SHA-256
`0d1089135345d2ba3eb3f60e8d8389a0193e73851cf31b8ba01da572d42d7b96`。脱敏摘录保存于
`outputs/air780-livekit-tts/air780-vuart-v1-h3-board-selftest-20260805.txt`。

结论：`H3_NODE_LUA_GOLDEN_TARGET_PASS`。该结论只证明冻结 session/command/
`AUDIO_UPLINK` golden vector 在 V2048-113 目标 Lua runtime 一致执行，不证明 production
VUART I/O、真实 LiveKit TTS→PSTN、远端可懂度或原声泄漏为 0。
