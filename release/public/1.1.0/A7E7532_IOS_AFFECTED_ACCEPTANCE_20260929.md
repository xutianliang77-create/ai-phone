# iOS 2026092902 受影响功能验收签收

## 用户决定

2026-09-29 用户明确确认：“不用继续优化了，已经很好；push，测试通过”。本轮受影响静音回归按此签收，不再追加当前优化或声学测试。该决定不自动等同于完整项目发布、Android 验收或未执行的长测通过。

## 被测候选

- 产品源码：`a7e7532751f96292a29ff0f9fbc6584e95f754a5`。
- Git tree：`802eb432049cd147c40206fec8b917bcf49b1645`。
- iOS：`1.1.0 / 2026092902`，独立 public Bundle，`profile/full`。
- App 聚合 SHA-256：`6e66c6777071683b0669e5e8b0a270c81b2c2b9b505aecef46422cf6637c2e98`。
- Beelink 隔离 QA 镜像：`sha256:69cf64575e46eed8900f93893e9a26c1a9d96a35b421133ff8e6ab60f9f98a2d`。
- 模型配置：原 r3 Qwen Audio 3.1 流式 ASR＋腾讯 TMT；手机朗读关闭。本轮未改变 VAD、Sortformer 权重/参数、词库或计费规则。

本文件为后续文档提交，不改变以上已测产品源码与已安装/部署候选；不因记录签收而重新构建或部署。

## 实际结果

- 原固定音完整播放约 70.377 秒；用户确认手动结束，不是 App 自行中断。
- 服务端与手机历史均为 11 条原文、11 条译文，pending 0，正常结束，唯一结算 77 秒。
- ASR 1 次、翻译 11 次，均 confirmed，TTS 0；runtime/provider/meter uncertain 均为 false。
- 正文、语言、revision、匿名说话人、数值时间和消费秒数一致。原始 JSON 比对的 11 处差异仅为已定义的 `overlap:false` 与 `activeSpeakerIds:[]` 序列化省略；原始结果保留，按合同默认值规范化后无剩余差异。
- 会议长句完整保存；中英短问答都有相应译文，尾句原译文存在，出现两个匿名说话人标签。这不单独证明所有片段分人准确，也不把本轮未出现的 130ms 条件写为真机直接命中修复分支。
- 既有本地纠正规则本轮实际将 `Hi-MT2` 修正为 `Hy-MT2`，并保留原始文本；未新添固定台词规则。

## 保留的事实边界

- 计划的完整 20 秒安静尾段未执行；不伪造为通过，也不再以此要求追加本轮测试。
- 尾句仍有“测试点，结束”的语义标点，模型名称仍出现 `Grok-CPM2`，以及“我叫天亮”译为 `I call dawn` 的质量差异。用户已在当前体验下签收并要求停止优化；这些观察保留，不偷偷改写历史或掩盖为源码修复完成。
- 新候选的真实静音/朗读模型资格均已有独立证据；资格中的 Apple 文本语言观察为同源 Mac Native，不替代 iPhone 朗读、插话、蓝牙或长时间验收。本次手机仅测试朗读关闭。

## 证据与保留

外层工作区证据目录：`artifacts/closeout-regression/20260929-speaker-edge-fix/`。入口为 `DEVICE_ACCEPTANCE.md`、`device-acceptance.json`，原始文件包括 `passive-speaker-edge-silent-1-result.json`、`-end-proof.json`、`-comparison.json`、`-comparison-normalized.json` 和只含本轮的 Native 元数据。原始账号/设备/会话资料、密钥及手机历史不随本文件推送。

集中回归证据仍为 1922 项通过、1 项专用 PostgreSQL 环境测试跳过；不重复运行，也不把跳过计入通过。旧候选、回滚容器、冻结 1.0 和用户 WIP 均保留。
