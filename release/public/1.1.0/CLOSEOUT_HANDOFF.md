# 无界 AI 1.1 非测试收尾与交付说明

## 同源短测结果：断句项未通过（2026-09-27 13:54）

用户实际完成54337a2/2026092701在线静音70秒固定音旅程。手机与服务端18条原译文、语言/revision/speaker及规范化时间轴全部一致，pending0、尾句完整；仅一笔78秒账本，ASR1/MT18 confirmed、TTS0，runtime/provider/meter uncertain均false。签名device-speaker选择与实际标签都已出现，不再只是模型ready；11条speaker1、1条speaker2、6条unknown不当作独立精度验收。

用户反馈“断句有问题，没有按照策略执行；其他的可以接受”。已在未改源代码上复现：同turn_3/speaker1且时间连续的“会议结束以后，我会整理会议纪要。”与“并在下班前发给大家确认。”仍分别释放。首段不匹配句尾续句规则而立即ready；1.0的listening+max_duration同ID修订未覆盖当前conversation云端final，不能把源码存在当作策略适配完成。修复回原CO11-04；未改业务源码/阈值/模型，未复活测试守卫，未开始长测或宣称整体验收通过。

本轮固定音/被动观察器已经结束，QA仍开放。证据为外层`artifacts/closeout-regression/20260927-ios-54337a2/RESULT.md`、`passive-quality-1-comparison.json`及`segmentation-replay.json`。后者是保存文本的确定性源码复现，使用合成1秒到达间隔，不伪装为原始ASR事件或真实到达时序。后续只修断句适配并复验受影响链，其他短程结果按原证据边界复用。

## 用户取消测试守卫（2026-09-27 13:32，最新运行策略）

用户明确要求取消守卫，现已停用原观察等待结束后自动关闭QA入口、以及测试超时终止公有App的本轮控制脚本。后续不得自动恢复这两项测试措施；观察器结束只停止观察/测试音，不改变在线入口。鉴权、客户余额、唯一结算、模型资格及产品5分钟无新语音结束规则保持。

现役仍是54337a2/2026092701及原3400233d镜像。隔离QA只将PLATFORM_ACCEPT_NEW_SESSIONS改为true，环境SHA3c5a1d14160a7e30ae2b5724b84b6f1a6888de146efa4e9309ed8999c8667b09；真实平台准入允许，API/Gateway ready，one-shot QA关闭。模型配置r2及资格/策略文件未改；没有模型调用、安装、改账或push。不声称语音/分人/长测通过，原Runner符号缺口保留。

原维护容器保留为`wujie-co11-qa-54026e7-app-pre-guard-cancel-20260927`，没有自动回维护任务。操作证据为外层`artifacts/closeout-regression/20260927-ios-54337a2/cancel-guard/result.json`；同目录guard-cancelled.json防止误启旧脚本。静音/朗读模型资格仍按原规则有效至北京时间9月28日02:25/02:28，不能把取消测试计时器解释为永久资格。下文“QA维护关闭”均属其历史时点。

## CO11-14 符号归档防遗漏修复（2026-09-27）

现役App/服务端仍为下节54337a2/2026092701，未新构建、安装、部署或push。本次只补原候选脚本的归档缺口：复制Runner及App.framework的dSYM前后核对所有架构UUID与文件摘要，生成Symbols/manifest.json；候选manifest写入前重新核对实际包及符号，并记录符号manifest的SHA。缺失、UUID不匹配、复制损坏、既存输出均拒绝，失败保留现场，不自动清理。

三个定向文件28项、shell语法与行数检查通过；现有真实重建包及其符号归档通过，原手机包与重建Runner符号明确拒绝。外层证据为`artifacts/closeout-regression/20260927-terms-speaker/symbol-archive-guard.json`及`20260926-concentrated-b367d89/co14-symbol-archive-*`。该结果只证明归档防护，不恢复原包缺失符号，也不是新的构建/真机/发布验收。原CO11-14材料与CO11-15质量/双人/长测仍未关闭。

## 两项前置真实收口（2026-09-27，现役检查点）

用户要求完成真实腾讯词库绑定/投递及手机说话人就绪，并另授权key77最小术语管理权限。本节覆盖下方源码阶段“尚未配置/部署”的旧状态，但不替代CO11-15质量验收。

- 主账号100017495461确认后创建独立CAM策略`WujieAITmtTermsMinimal20260927`/287794915，仅关联key77，增加4项查看和2项创建/新增术语操作，不改原策略，不加删除/付款/密钥管理。原API明确UnauthorizedOperation，关联后同凭据查询成功。
- 公共product词库两份：zh→en `3e6af67cb9d411f18bb32f3360e0816a`（10条），en→zh `36daf82eb9d511f18bb32f3360e0816a`（9条）。19对逐项回读与原目录相等，未上传个人词库。真实4次TextTranslate A/B证明词库效果：自动反向从automatic reverse改为auto reverse translation；simultaneous interpretation从同声传译改为同传。库在发布使用后不就地覆盖；更新应换ID、配置revision与资格。
- 手机同Bundle升级为2026092701/profile/full，源54337a274bae004b863817233dc212058aaa41f0/tree3fab904588c50dcee3116f51f3c001cc8f6e71fb；完整profile逐项核对，App摘要0bd1d302f76f592ec4a32ab6273494a6f4dd5ceeb0ddfe2cbe7849592c769cdf。初次启动被Locked拒绝，解锁后启动成功，PID28695末次仍在。不开麦的普通App预热日志记录1502ms等待超时，92220ms后模型ready，确认冷加载/就绪等待预算不匹配这一失败路径，不是模型文件缺失。记录名start_wait_timed_out也由预热调用触发，不能据此虚构本轮点击开始或已发diarization会话。预热/缓存修复已装机；新会话签名speaker选择和声学分人仍归后续质量项。
- 同源服务端镜像3400233d2f7c3fe56bfde3e4e433eab55f735fa5cdb3718a9cdb6bc69addc42b部署原隔离QA。独立密文配置revision2只新增上述TMT方向映射，原配置/凭据/TTS Volume+4不改。新静音/朗读资格均实跑8组原译文、零错误、各唯一29秒结算；静音TTS0，朗读26块545600字节。原Gateway日志确认两条链Qwen热词253字节、中英投递词库、日法不错误套用中英库。
- 当前Gateway signed_live_qualification ready，source/App/server一致；configSHA20aa84be67af97b1562c8b9c92df8cd2ac1adea3bd912dd84166ab0498049ff7，speaker capability available=true、连接0。新会话入口仍维护关闭；测试45秒保护仅用于内部资格探针，生产策略无会话时长上限。旧c8容器app-pre-54337a2和原密文配置保留回退。
- 手机没有执行采音、朗读/听音、双人分人、质量或长测。本轮只完成这两个前置门禁，不关闭整项CO11-06/15或正式发布。未push、未动私有1.0、其他项目服务或旧未决账务。临时资格容器已停止，两份临时Bearer已删除；本轮1GiB可重建iOS build已清理，签名App/模型/符号/完整日志保留。

证据：外层`artifacts/closeout-regression/20260927-terms-speaker/RESULT.json`、`verification.json`、`readiness-final.json`、`terminology-dispatch.json`及原记录器`terms-speaker-*`日志。双资格有效至2026-09-27T18:25/18:28Z，仅覆盖原四方向；到期需按原规则刷新，不改写为永久资格。

归档更正：本轮清理build前遗漏单独归档新包dSYM，不能把上文“符号保留”读成新包原生符号完整。已按同源/同参数重建：App.framework UUID8228BCF3-F2A6-6EBA-A30D-B0EB3A16F414一致并补档；Runner原UUID AB73E3B1-D65F-3119-B146-A369DCD02192与重建BDE0E6F0-278D-3DB7-8A4F-463671F4FA29不同，代码段摘要也不同，未强制改UUID或拿重建符号替原包。原包/运行实例未替换；完整重建物及配套符号另存为诊断证据，不冒充原设备验收包。此为CO11-14最终RC归档材料待办，不抹掉上述两项前置实证，也不宣称正式RC材料齐全。详见外层本轮symbols.json。

## CO11-03/04/06/07 源码回收口（2026-09-27，优先于下方历史）

按用户新决定：公共术语对所有账号的新会话默认启用，个人词库仍按账号隔离；本批业务配置默认开，明确保存的关闭值仍保留，身份、预算、资源就绪、供应商资格和维护门禁不绕过。

- CO11-03/07：复用1.0术语目录、现有个人词库、原创建/签发/授材和Provider。公有请求补termbaseId/domainLexiconPacks，准备时固定账号词表和目录版本，签名绑定摘要，Gateway核验后按实际方向筛选。Qwen实际session.update投递corpus.text软提示，不改识别文本；兼容Chat/Gemini使用原glossary路径。腾讯TMT补配置页的方向→术语库ID映射并投递TermRepoIDList，不伪造内联词表接口、不上传个人词库。未配置腾讯真实术语库时明确repository_not_configured，不能声称TMT已使用公共词表。500条支持上限已穿过真实API handler和有界material client的模拟回归。
- CO11-04：原SegmentAssembler仅补“把/将/让+宾语但缺谓语”暂存规则，合法Okay/短答和结束flush保留；不改手机/供应商VAD阈值。公共聊天MT只接收同方向、同说话人或同轮次、邻近时间的至多2段上下文；修订、换人、换方向、结束清除。普通TMT不支持上下文参数，不伪装已具备该能力。未做安静误识别或CER设备签收。
- CO11-06：源码确认旧单preparationId可被并发准备覆盖，并可重复加载CoreML。沿原插件改为共享加载缓存和逐请求取消，提前准备，不延长1.5秒开始等待、不强制ready、不换Sortformer权重/算力配置。新增非内容、最多32条的wujie-speaker-readiness.json，区分超时、模型缺失/损坏、CoreML失败、未提供能力、pending选择off等。上一轮实际off的精确原因仍缺现场证据，不能把本轮HOST修复冒充已查明旧会话或双人效果通过。
- 默认值：公共ASR/MT/TTS配置enabled、手机说话人及新配置对话朗读默认开启；显式关闭继续有效，空凭据仍显示未配置。旧“聆听”模式默认静音及用户保存偏好保留。冻结1.0及756b937静音/TTS增益/barge-in成果保持。
- 同步修复TMT取完凭据后清除整个请求超时的问题；已发送请求超时记uncertain，不盲重试、不重复模型调用。

集中回归工作树指纹`d059dded844b35d59dbd75a22a2e94ce44f485e9b5437f951e460a384ee7092d`：后端/共享合同382文件2555通过、2文件6项真实PG用例跳过；Flutter890通过；Dart机器格式分析无输出/退出0；Swift准备缓存4项离线检查和原生文件parse退出0；双版本40/40。Node全工作区build通过；其后仅按350行门禁拆出手机术语测试并定向复跑、补本文档，生产代码未变。首次build类型错误、旧默认夹具失败及其重跑均留原始记录，不累加测试数字。

证据在外层`artifacts/closeout-regression/20260926-concentrated-b367d89/co03040607-*.result.json`及对应日志；新回执为外层`plans/wujie-1.0-1.1/CO11_03_04_06_07_TERMS_READINESS_20260927.md`。这是SOURCE/HOST，不是iOS目标包、供应商资格或DEVICE通过。本轮没有模型调用、部署、安装、QA开窗、push或长测；上次c8/2026092605部署未被本轮代码更新。

后续仍按原门禁：先绑定腾讯真实公共术语库并核查准确方向/配置revision；再用同源候选做不开麦的手机就绪取证，确认选中的deviceProfile和实际证据；这些通过后才进行质量样本、双人时间轴及长测，不把问题移交为“继续点击开始”。

## 当前修复候选与质量复核（2026-09-26晚，优先于下方历史）

功能源码c8acd6734d1d77e863c6d55213e1ee80af23c4a2/tree2f9cda667236dd0f3b028224517471ae77c2c55f，iOS2026092605/profile/full已安装；服务端同源镜像fd042608ff11b8e7888434e5cb01a4f379824a41ab43d307bcdda262b2759522已部署原隔离QA。App摘要8f57224c7d5fdc7213fa22ad1d5bba987d33b07997c147c0fc6fe4722cbb8c93。原16b失败回执保留，不当作当前通过。

修复公有结束flush后不补存最新字幕的问题，复用1.0双快照方式并保留账号/代际/删除保护；同时只补Qwen协议拒绝原因及数值状态诊断，不放宽校验。原尾句失败复现现通过，Flutter885、Gateway1063、定向19/85（有交集）、同SDK Dart分析与双版本40/40通过。原Flutter分析LSP异常退出255和错误测试夹具的失败记录均保留。

同源静音/朗读真实资格各8组原译文/唯一29秒，静音TTS0、朗读26块545600字节。随后两轮手机/服务器14对14、19对19原译文一致，各唯一78/272秒；第二条含用户提前开始后的等待，非70秒固定音时长。第一轮有其他声源，排除质量签收。第二轮用户仍报告问题，独立检查确认：关键编号/模型术语误识别，正确人名/界面词被MT误译，长句分段，speaker实际请求off。包资源与ENABLE_DEVICE_SPEAKER=true均正确，不能把off解释成已进行模型分人或时间轴验收。

公有创建未投递原domainLexiconPacks/termbaseId，TMT适配器没有消费terminology，本次refinement.provider=off；相关1.0优化代码仍在，但不能说这条公有链完整生效。后续回CO11-03/04/06/07处理原缺口，再走CO11-15，不另建App、不换模型或按本次答案硬编码。旧ASR协议错误在3次隔离探针和2次手机短测均未再现，根因仍开，不能声称修复。

当前QA已回维护，config dc67838b611835f1686fbb18e8e3648833e7267e10a1f8c5cfe2f252a6605455，手机保留新包；旧16b回退app-pre-c8acd67保留。未push/合并，未改旧失败账本/历史14笔，未动私有1.0、丸子。CO11-15完整质量/长测/系统与正式发布均未通过。

外层证据：artifacts/closeout-regression/20260926-tail-asr-fix/RESULT.md、QUALITY_REVIEW.md、phone-comparison.json。候选和匹配符号在artifacts/releases/wujie-co11-qa-c8acd67-2026092605/。本段为交接，功能构建仍绑定c8提交，不把后续文档提交当构建源。

## 最终同源QA检查点（2026-09-26，优先于下方历史）

当前功能源码`16b4872425f092d6e141ebfb69051d3f6eb42d70`／tree `e75078460acead6cc93674fd99f945d9696571ee`，镜像`sha256:627163eccb862937fda8cadbc096cdf3f39be45605c0724badf88063309cfaef`。iOS2026092604/profile/full/独立public Bundle已签名并归档；App SHA `351addb61d7e83c7d41a9f995750a2d195138a452c12c14f7f7a8a6eb873dc38`，源码、模型资源、相对路径摘要及符号UUID一致。新App尚未安装。

工程门禁：API1270、Gateway1060、Worker255、Flutter879通过；Dart零问题、双版本40/40。真实隔离PG6项、Redis1项、Android原生编译与新跑Kotlin3项通过。API/手机/Worker未变生产输入逐文件核对复用原组，失败与重跑结果分别保存，数字不累加。用户原README、身份文件/实验脚本、冻结1.0未改或混入提交。

本轮另修复了运行中停止缺口：Gateway原入口无SIGTERM排空，容器同时停止API/Gateway。现沿原结束/持久确认链有界排空，API最后停；真实10秒音频后SIGTERM约900ms正常退出，收到结束且仅一笔11秒账本，换进程后记录与调用不变。观察器成功标签和启动探测时序错误保留失败回执，只读复核退出0，不为修报告重跑模型。不声称硬崩溃零丢失或跨进程Provider续译。

静音/朗读双快照均由该提交实际Qwen ASR＋腾讯MT/可选TTS会话签名：各8组原译文、一次29秒结算；静音TTS0，朗读26块545600字节/8完整输出段。只覆盖当前四方向，不外推其他配置已实测。原隔离QA已部署16b，Gateway依赖ready；回退容器`wujie-co11-qa-54026e7-app-pre-16b4872`保留B9。维护开关仍拒绝新会话，设备验收时再开窗；手机说话人资源在包内，服务端rollout尚待该验收窗口启用。

CO11-13当前工程门禁已过；CO11-14同源QA/资格准备完成但非完整RC；CO11-15受iPhone不可达阻断（CoreDevice与USB/网络枚举均已查）；CO11-16还缺Android正式包名/已有签名及后续双端实测；CO11-18未灰度/发布/启动72小时观察。安静/断句、真实分人、长测与系统交互必须用该RC完成，不能用本轮数字输入替代。

QA额度按用户原要求从55补到99999，走原账务事务并明确记为sandbox测试额度，非真实支付/退款；14笔旧遗留不改账。临时PG数据库/Redis、隧道和一次性账号Bearer文件已清理；有效QA环境、签名资格、回滚资产、最终包/符号及全部证据保留。本轮未push/合并，未操作私有1.0或丸子。

外层证据：`artifacts/closeout-regression/20260926-concentrated-b367d89/SUMMARY.json`；最终包：`artifacts/releases/wujie-co11-qa-16b4872-2026092604/`。源码和文档提交须区分，以下旧候选/旧测试状态只保留追溯意义。

## 当前集中阶段（2026-09-26，覆盖下方开发期暂停指令）

用户已明确按CO11-13→14→15→16→18推进，当前执行同源集中验证。API全量1270通过/5实库条件跳过，Gateway1054、Worker255、共享contracts176/speech-quality30/platform-security12通过（Redis条件跳过1），Flutter879通过，候选/身份/密钥卫生6文件43通过，双版本40/40；Dart分析在修正两条花括号提示后零问题。所有数字按报告组分别记录，不累加重跑。

随后使用当前源码、Beelink任务隔离PG的新临时库完成6项真实实库验证（原子attempt、10000条/100页、余额边界/竞争/故障回滚），独立Redis1000次竞争1项通过。原QA会话/hold/账本/attempt计数前后均11/10/8/62；无旧账改写、模型调用或设备操作。源码规模初次两文件超限、旧QA日志断言缺音频电平字段的失败证据均保留，已最小调整并复验。

Android原生编译已进入实际Gradle流程：离线缓存缺少既定依赖，在线重试仍在依赖下载中；这不是TARGET_BUILD_PASS。正式Android包名/签名材料仍未提供。CO11-13完整活动进程故障项、同源资格、真实声学和设备/发行仍不能由本节HOST/持久层结果替代。源码保护与后续候选只按原门禁进行，不预报RC或发布完成。

本轮证据位于外层`artifacts/closeout-regression/20260926-concentrated-b367d89/`：逐命令原生退出码、机器报告、日志及源码前后文件摘要。临时DB/Redis与隧道的精确归属和清理状态以外层PROGRESS_LOG最新节为准，不操作其他Beelink服务。

## 当前开发指令与未验证更新（2026-09-26，优先于下方历史成果）

CO11-12追加开发：Android独立public签名配置、完整本地profile、实际Dart/native源身份绑定、可追溯Release APK后置流程和未执行用例已写入原App及scripts目录。详见[Android交付说明](ANDROID_DELIVERY.md)。正式applicationId、已有keystore/alias尚待用户提供，未生成密钥或构建APK；当前仅`DEVELOPMENT_PREPARATION_COMPLETE / INPUT_PENDING / NOT_VALIDATED`。Android端侧说话人及真实离线资源不能借iOS证据，LAN私有CA也需同源阶段确认，不绕过TLS。

所有开发完成前不运行任何验证/测试，也不静态检查、编译打包、签发资格、部署或操作手机。当前工作树在已提交b367d89之后补了会话级静音/朗读资格选择、短答去重上下文、双QA门禁下的非内容音频电平和语义去向日志及诊断异常隔离；均未执行检查、未包含于旧候选。

CO11-02/03开发接线、CO11-14开发准备及CO11-04本轮源码更新已保存，统一标注待验证，不等于真实资格或验收完成。现场安静误识别/漏半句的声学根因仍未定；不盲改手机/供应商VAD、不删合法短答、不替换模型。下方历史HOST/构建结果只适用于各自当时版本，不覆盖这些新修改；旧操作脚本也不得因“继续”自行执行。

本次追加请求的源码已沿原模块保存，统一是**开发完成、待统一验证**，不是功能/设备/发布验收完成：

| 任务 | 本轮开发交付 |
| --- | --- |
| CO11-05 | 同一句PCM分片失败后，排队/迟到块不复播、不覆盖失败；失败诊断携带段/revision；字幕合并吸收取消播放 |
| CO11-06 | 旧空字幕不删新段；迟到说话人metadata不复活已吸收段；API拒绝旧原文revision的标签/时间轴覆盖；Sortformer参数不改 |
| CO11-07 | 复用原本地/扫描/输入/历史/导出/术语/手机规则纪要；旧历史快照不向新原文回填旧译文或抬高旧pipeline generation |
| CO11-08 | 公有usage tick仅用本会话可信authorizedSeconds，缺失/非法不借账户总余额；原账户锁、滚动hold、私有规则与计价不改 |
| CO11-09 | v2索引账本不可用时显式503，不能以未决投影伪造完整历史；旧数组排序/翻页比较一致；不迁移/改账 |
| CO11-10 | 可选Provider诊断异常不阻断已成功flush后的持久确认和结束；真实业务/存储/计量失败门禁仍保留 |
| CO11-11 | 原腾讯白名单Adapter取消前不取材料；终态回执相同事件有限重试，不重发模型；持久失败仍清理资源；旧1024记录限制显式保留 |
| CO11-13 | 只完成原集中验证清单与未执行回归用例准备；执行状态仍DEFERRED，不能标门禁通过 |

本组没有检查、测试、编译、签发、打包、模型调用、服务/数据库探针、部署、安装或push。源码仍是b367d89后的本地未提交工作树，不属于下方旧包/镜像。未动冻结1.0、用户原WIP、模型权重和14笔历史账务。恢复统一验证时先固定同源版本，按外层CO11-13既有清单执行，不抢先构建或启动手机旅程。

## 以下为历史交付，不是本轮通过回执

更新：2026-09-26。状态：`HOST_PASS / TARGET_BUILD_PASS / NOT_DEPLOYED / NOT_FORMAL_RC / NOT_RELEASED`。

最新功能候选源码为`9bdee68daa2aa392b23069e6ea8f94e333133146`，包含已推送的`7d7b581` Call Link边界修复及后续收口。API、Gateway、Worker集中回归和同源制品构建已完成；后续提交仅在本地保护，未再次push。运行中的服务/手机仍为旧e951519，不能把新源码或新包当作已部署。原Call Link真实双端验收仍缺，见[兼容交付说明](CALL_LINK_COMPATIBILITY.md)。

当前指令已更新为：按原顺序完成剩余任务，测试集中放在最后。非测试源码收口新增同会话授权续验、QA结束原因白名单日志、Android启动类绑定和iOS可迁移制品摘要；它们尚未进入现存e951519候选。测试、构建、部署、设备与发布分别登记，本文不是全项目通过证明；机器可读现场见 [closeout-snapshot.json](closeout-snapshot.json)。

集中回归另复现了CO11-09的真实缺陷：非Qwen实时ASR在第1025个完成段抛错。现复用Qwen已有的有界去重方式，最近1024条保留、超出只淘汰最早缓存；不更换Provider或新开会话。10000段、最近重放、已淘汰旧结果与新ACK不匹配的失败关闭均有合成回归。当前API全量1264通过/5条件跳过、Gateway更新后1037通过、Worker251通过、制品脚本31通过、双版本40/40；HOST结果仍不等于实机/正式RC通过。

## 1. 交付边界与三端职责

- 1.0 私有版保持冻结；不默认导入其账号、token、历史或余额。1.1 使用独立 public Bundle、身份与沙箱。
- 产品仅本地和在线两种模式。本地使用手机 Apple SpeechTranscriber／系统翻译／系统朗读及已有手机 VAD；本地自动语言和自动反向禁用。
- 选择在线后，手机负责唯一采音、音频会话、旁路 VAD／匿名说话人证据、字幕、播放、打断和停止；ASR／MT及开启时的TTS由公共模型处理。在线不偷偷改成本地或私有1.0。
- 服务器负责认证、部署/会话绑定、能力准入、配置和凭据保管、调用状态、历史同步、客户预占与唯一结算。手机不持有供应商密钥。
- 四家供应商按协议配置，不将当前Qwen＋腾讯组合写成产品唯一实现。实际支持由配置、协议能力、语种/Voice与真实资格共同决定。

## 2. 同源QA制品已生成，不是正式发布版

| 对象 | 已固定事实 | 不能外推的结论 |
| --- | --- | --- |
| 1.1 功能候选 | `9bdee68daa2aa392b23069e6ea8f94e333133146`，tree `3e186d3a35210bae42bee0eb4c2819204a32c9b6` | 隔离构建工作树干净；原开发工作树用户WIP保留、不混入候选 |
| 新iOS QA | `wujie-co11-qa-9bdee68-2026092601`，1.1.0/2026092601，`cn.qkxy.wujieai.public`，`profile/full` | 构建/签名/资源及7个实际本地define通过，尚未安装；不是商店Release或DEVICE_PASS |
| 新API/Gateway镜像 | 同源9bdee68；`sha256:dbb04dcbd4dfda49e69d282920887dd95b8dbfee59d3f818b8c75819ae214859`；6个关键编译文件与HOST一致 | 镜像已构建，未替换原隔离服务；无网络检查容器没有调用模型 |
| 数据库 | 隔离QA为schema047；原公有RC最后迁移记录为045 | 不能把隔离迁移/恢复证据当原公有库已升级 |
| 静音组合 | revision1，Qwen `qwen3-asr-flash-realtime` 16k＋腾讯TMT；已有真实四方向资格与短样本回执 | 原资格截至2026-09-26T15:21:17.794Z；本轮不续签，不证明永久可用或所有语种通过 |
| 朗读组合 | 同revision另加腾讯TTS，VoiceType101001、16k、Volume+4 | 配置存在，但该QA精确朗读组合尚缺live资格 |
| 诊断分支 | `32828a5`为一次性PCM捕获候选，已退出运行 | 不合并进正式RC，不用其样本冒充e951519整套正式验收 |

新App、manifest与匹配UUID的Runner/App调试符号已稳定归档到外层工作区`artifacts/releases/wujie-co11-qa-9bdee68-2026092601/`。App相对路径聚合SHA为`3d75b8f3c96204e0799843b767d06fbbc4aaff91dc047cf5bb10f7ddea25d10a`；原始报告及退出码在`artifacts/closeout-regression/20260926T0508-source-closeout/results.json`。这些制品/证据不在Git源码仓库中，不能声称已push。旧e951519服务/2026092510手机包仍是当前运行参考，旧包与回滚资产不移动。签名私钥、供应商凭据、原始录音和用户记录不纳入源码交付。

## 3. 客户余额与供应商费用

沿用原账户、hold、session fence、命令幂等和账本，不新建一套计费系统。

1. 客户在线使用取决于其无界AI服务器账户可用秒数；供应商免费包余额不是客户余额，不由手机查询或决定。
2. 可用量为剩余秒数减去有效预占；hold只是保留使用资格，不等于已扣款。原hold在同一账户锁和会话身份内滚动续额，未知余额不得扩大许可。
3. 普通客户没有产品单会话时长上限。开始/结束控制正常会话；连续300秒无新语音按原策略结束。QA单次45秒、开始等待窗口、录音上限不能混成客户规则。
4. 最终扣秒使用服务端可信`activeMs`，由原`normalizeMeasuredBillableSeconds`归一；当前按秒向上取整。不是音频样本秒数、ASR片段数、供应商token数或免费资源包额度。
5. `settle:<sessionId>`与原事务保障session、hold、账户和唯一usage账本一致。相同终结重试返回原结果，不创建替代收费会话。
6. 单段翻译失败可形成degraded结束；停止、水位、计量和持久化未确认则不能伪造已结束/已结算。供应商费用未知与客户计量未知分开处理。
7. attempt记录供应商确实报告的Request ID/usage及证据等级；缺失保持unknown，不能填0或直接换算为客户扣款。当前正式货币价格/商户接入不由本文新增或冻结。
8. 历史14笔未决记录已获用户明确作为测试遗留签收且不改账：13笔有停止水位但供应商回执不足，1笔缺可信停止。CO11-17关闭处置决定，不表示这些记录已结算；扣费、释放预占、退款、删除均未执行，不能凭新版本修复或hold过期补造回执。

源码依据：[客户终结](../../../services/api-server/src/modules/sessions/public-session-finalization.service.ts)、[秒数归一](../../../services/api-server/src/modules/sessions/session-usage-settlement.ts)、[预占续额](../../../services/api-server/src/modules/usage/postgres-usage-hold-renewal.ts)、[供应商调用](../../../services/api-server/src/modules/sessions/public-model-attempt.service.ts)。

## 4. 运行状态和配置故障的区分

现行配置流程见 [MODEL_CONFIGURATION_RUNBOOK.md](MODEL_CONFIGURATION_RUNBOOK.md)，数据库切换见 [POSTGRES_046_047_CUTOVER_SAFE_STOP.md](POSTGRES_046_047_CUTOVER_SAFE_STOP.md)。

| 状态/提示 | 含义与处理 | 不应采取的动作 |
| --- | --- | --- |
| “在线服务暂未开放” / `public_creation_not_ready` | 公有创建协调器未启用，先看部署开关与实际进程身份；当前QA两个开关均false | 不先归咎ASR/余额，不让用户反复点开始 |
| configured_not_verified | 配置字段齐备，尚不是可用性或质量证据 | 不直接写成QUALIFIED |
| 当前组合未资格化 | 核对静音/朗读各自hash、revision、部署、语言/Voice和live回执 | 不只延长时间戳或套用另一组合资格 |
| 余额不足 | 查客户可用秒数、有效hold与原账本 | 不查腾讯/阿里免费包来替代客户余额 |
| 原创建状态未确认 | 复用原开始/结束中的幂等查询/安全撤销链 | 不清库/清沙箱或要求客户管理技术性的创建状态 |
| ASR/MT/TTS错误 | 沿会话、attempt、首错和采样水位查具体阶段 | 不以新UUID盲重试，未知成本不记零 |

当前QA在线关闭是测试完成后的回退状态，不是模型配置故障结论。按最新指令，先完成非测试工作，再统一进行验证；准备阶段不开窗。服务开放策略、单次会话保护和诊断录音范围仍分别管理，既有脚本仍会回退关闭，本文没有修改这个运行行为。

## 5. 已知问题与未关闭门禁

| 原任务 | 确切缺口 | 当前处置 |
| --- | --- | --- |
| CO11-04 | 历史漏半句/安静误识别的同场声学归因仍未完成；最近样本有其他声源且只录11.28秒 | 排除出安静验收集，不能据此关闭质量问题或过滤合法Okay |
| CO11-02/10/13 | 同会话准入续验及live凭证最早到期边界已补源码 | 待集中回归；不改变旧JWT、模型或唯一账本，QA与已过期/撤销授权不能续期 |
| CO11-04/10/13 | 最近13秒结束的触发来源未确认；新增QA白名单阶段日志 | 原样本不能事后归因；新日志待后置回归，不把client_request当作人工点击证明 |
| CO11-05/06/15 | 新同源包的蓝牙插话、两人标签及时间轴等完整设备效果未签收 | 保留原756b937及后续修复；Sortformer不换成尚未胜出的Nemotron候选 |
| CO11-08/09/10/13 | API/PG独立进程持久化、竞争及10000 attempt已有证据；带原Gateway/Provider活动音频的完整重启/尾句链仍缺 | 不把Repository/合成进程通过升级成真实音频恢复通过 |
| CO11-14 | 新同源iOS/镜像及稳定归档已完成；双组合资格/实际Adapter与正式RC仍待核定 | 保持NOT_FORMAL_RC；当前仅TARGET_BUILD_PASS，旧清单不改写 |
| CO11-12/16 | Android源码/未签名构建存在，public发行身份、签名及设备证据不齐 | 不替用户选新ID/生成密钥；iOS后才做Android真机 |
| CO11-11/16 | 原白名单Worker隔离idle成果不能代替模型及真实双端媒体 | 不开放隐藏业务、不启旧私有Worker |
| CO11-17 | 用户明确签收14笔测试遗留，不改账 | 处置任务已关闭；账务仍未决，不填settled、不新增费用证据 |
| CO11-18 | 正式渠道/材料、适用QA、灰度与72小时观察未完成 | 灰度0%，不发布，不声称观察在后台进行 |

测试后置没有删除上述首发验收条件。已通过且源码未变的证据可按原计划复用，但不能把不同候选的最佳结果拼成同一个RC。

## 6. 延期、回退和交接

原延期/隐藏范围不变：商户充值订阅、SMS、PSTN、Air780、Web Guest，以及未选中的私有数据导入；不擅自删除仍在原首发范围内的Android或白名单Call Link。

- 当前隔离QA仍使用e951519/schema047；新9bdee68镜像未部署。更早QA容器只是候选回退资产，不是正式生产回滚认证。切换前必须精确核对镜像/环境/schema及期间新增数据。
- 原公有045→047仍须原计划的一致备份、隔离恢复与迁移授权。已产生新写入或无法证明无写入时，保留047及全部历史/账本，安全停新准入并前滚修复；不能旧备份覆盖新数据。
- 若没有经过对应验证的兼容旧版，只允许safe_stop，不拿冻结1.0作为公有后端或数据恢复目标。线上故障不偷偷换用户处理模式。
- 运维交付时分别托管加密配置和主密钥；记录镜像/配置/资格/价格版本、备份位置与恢复影响，不在本文件或Git中保存凭据。
- 本轮未执行新的push、合并、部署、安装、旧数据迁移、历史改账或发布；仅将新生成的App与调试符号放入稳定交付目录。用户暂不方便真机，先完成独立交付；剩余外部动作按准确对象和原计划门禁处理。

## 7. 维护说明

这是当前源码交付目录内的操作入口，不替代外层工作区的43项原任务及18项CO11子任务。逐轮证据仍由外层`plans/wujie-1.0-1.1/tasks.json`、CO11-04/13/14/17/18原回执和`PROGRESS_LOG.md`维护；独立克隆缺这些外部证据时，不得补写通过。
