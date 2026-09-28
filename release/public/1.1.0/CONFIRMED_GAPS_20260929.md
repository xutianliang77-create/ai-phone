# CO11-03/04/06/07/08：2804 已确认缺口的源码收口

本批从 `36dbb24dfa007fe0dac134471b6c33376b7f8de8` 增量修复。现役 2804/r3、双组合资格和失败的实体手机验收证据不修改、不升级为通过。没有新 App 包、部署、手机会话、供应商调用、改账或 push。

## 冻结 1.0 的复用核验

基线为 `898ee517e7aac00b03bc79ff2d0597dd00fdbf56`，不是早期实验代码。

| 现有实现 | 核验与本批用法 |
| --- | --- |
| `packages/speech-quality/src/turn-language-profile.ts` | 与冻结 1.0 的 Git blob 均为 `2334b255b9c853fd5cfdf50a46e30aadbaad3eab`。直接复用 `looksLikeProtectedTerm`，只在送给 Apple 文本语种观察的副本中屏蔽型号/缩写，不改 ASR 正文、词表、MT 原文或时间轴。 |
| `packages/llm/src/local-rules.ts` | 与冻结 1.0 的 Git blob 均为 `fa33b9ce5c8e4e5e84ecf077fa624cb513a2a488`。早已有 `HiMT2 → Hy-MT2` 等纠正规则，当前原 Refiner 在语言确定后仍调用。修复前术语句卡在 LID，未进入该路径；本批原 Provider 模拟回归已验证 rawText 保留、术语纠正及 rawTokenTimings 输出。不复制词表，不新增纠正特例或 LLM。 |
| 原词级说话人切分/时间轴 | 复用 token character offsets、真实词时刻、重叠/未知/保护词边界和原 SpeakerAware/Repair。新跨语种子句在进入这些原路径前保留各自精确时间，不凭字符比例分配音频、不创建 speaker 身份。 |
| 原静音标记清理 | 只能够识别 `<sil>` 等标记及纯标点，不能把环境低幅音中的真实汉字判成无语音。继续保护 `Okay/好/嗯` 等短答，不引入禁词或新 RMS 门槛。 |
| 原余额显示思想 | 私有 ticker 的 available + 本会话 hold 原路径不变。公共滚动 hold 的授权必须仍使用本会话 authorizedSeconds，只把显示值与执行许可分开。 |
| `SegmentDraft.copyWith` | 清译文同时清目标语言的问题在冻结 1.0 已存在，不能因“复用”把这个缺陷原样继续带入。最小修复显式新元数据保留，并防旧 revision 的失败覆盖新结果。 |

## 已修复的确定问题

1. **CO11-03/04 文本语种**：`zh/zh-Hans/zh-Hant` 按产品中文语种归并概率；仍保留 0.85、0.2、最少有效字符条件，不将日语或其他不支持语种重新归一到中英。不靠上一句、目标语言或用户语言对猜源语言。术语保护只用于观察副本，其 hash 与原文本 hash 分别绑定/取证，回传的 nonce/session/revision/hash 校验不变。
2. **CO11-03/06 跨语种合段**：供应商一个 final 内出现不同书写系统的完整句时，最多 8 个有界子句分别请求原手机文本 LID；同语向相邻句保留完整合段。只有有真实 token alignment、非重叠时间、独立语言证据时才路由不同子句。否则原文保留为 unknown，不拿整段主语言替代全部子句。原父草稿按已有空 final 撤回；子句独立 ID，经原 Provider、Sink、TTS generation 和结算路径。
3. **CO11-06 对齐兼容性**：Qwen word 与 sentence 仅空白排版不同时可以无损对齐，正文字符、标点和数字一律不补写，时间仍取供应商；真正文本不一致、非稳定 token 或无时间证据不伪造。保留说话人、重叠和安全续接原保护。
4. **CO11-07 失败结果元数据**：清空旧译文时保留这次失败明确返回的 targetLanguage/provider；没有新的替代值时清掉旧 model/latency。旧 recognition revision 的失败不改当前方向、译文或错误提示。
5. **CO11-08 账户显示**：公共提示使用 `min(account.remaining, account.available + ownAuthorized) - currentBillable`（再受显式时长上限约束），排除其他会话持有额度。是否继续执行仍只看 ownAuthorized；账户余额再大也不能覆盖缺失、失效或耗尽的本会话许可。不改价格、预占、扣费和供应商免费包策略。
6. **原诊断链补证**：已有 `PUBLIC_ASR_BOUNDARY_TRACE_ENABLED` 下记录无正文的 LID 判定/拒绝原因、投影 hash、词级对齐数及子句数；phone onset/boundary 只记录已接受 PCM 的样本水位。边界也可能是客户端时长切点，不把它误称为确定的 speech-stop。日志失败不得中断收音、语种响应或 End。

## 保存的真实候选证据与 HOST 验证

原失败会话 `public-9130e2f…` 保持 ended、唯一 78 秒、原 11 条文本/7 条译文；本批没有回填它。只读 PostgreSQL 又取回这条会话的 tokenTimings/rawText，连接强制 read-only，没有新查询以外的远端动作。

同源 Apple Native 在 **Mac HOST** 对这次已保存原文及词时间回放：

- `你叫什么名字？`、`我叫天亮。` 的中文总概率约 0.9978、0.9971，正确通过原质量门槛。
- 型号屏蔽后的技术句中文总概率约 0.999998；原文型号仍保留，由原 Refiner 完成已有纠正。
- 首段中文与英文分别是 **1200–4560 ms、7120–9960 ms**，沿真实 token 边界独立路由，没有用比例猜时间。
- 额外的 `可。` 仍为 unknown/不发 MT，不能据此说安静误识别已经消除。

集中 HOST 回归：214 文件、1903 项通过，1 个专用 PostgreSQL 环境项跳过；Flutter 全量 924 项通过。后续仅为两个新 if 分支补括号，受影响手机用例另复跑；最终静态分析、构建、双版本检查与源码摘要以外层 `artifacts/closeout-regression/20260929-confirmed-gaps/verification.json` 为准，不把不同批次的测试项重复累加。

原 Gateway loopback WS→API 内存链验证跨语种双子句落库、父段退役、End 期间 LID 回复、ASR 一条 attempt、MT 两次和唯一结算。不是新的 PG 写入测试，也不是新供应商资格或 DEVICE 证据。

## 仍未关闭；不得靠装包或调参数跳过

| 缺口 | 目前证据与下一步条件 |
| --- | --- |
| 安静尾部 `可。` | 用户确认无其他声源，低幅非零 PCM 已记录，但无该时段手机 VAD 逐帧判定/原始声学真值，不能区分声学噪音与模型臆测。本批不删除样本、不启用新阈值。原 CO11-04 的声学根因/质量签收仍开放。 |
| “最后一句测试点，结束以后” | 新读出的 rawText 和 token punctuation 已如此，Refiner operations 为空，后续未重写该标点。是进入下游前的识别/语义标点质量问题，不是 VAD 开关未生效；不能加入只会通过固定台词的替换规则。 |
| 说话人误分/unknown/overlap | 对齐和既有保守拒绝回归可验证，但没有当轮完整 phone speaker spans/逐帧真值。实际 Sortformer 判断准确率及端到端标签仍待 CO11-06/15，不能把有标签或有词时刻等同分人正确。 |
| 同一书写系统内换语言 | 本批只修实际发现的中英等跨书写系统完整句聚合；不宣称一个 final 中英法等同字母系统任意混说已逐句分离。也不从中文脚本猜日语。 |
| 新源码实际生效 | 当前手机/服务器仍是 36dbb24/2804。没有制作、部署或安装新候选，旧资格不能给新源码签收。 |

本批 SOURCE/HOST 证据不关闭整个 CO11-03/04/06/07/08，更不进入朗读/长测或发布。先保留上述具体质量缺口及对应证据条件，按原收尾门禁推进，不横向加功能。
