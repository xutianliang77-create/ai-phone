# 公有／私有模型配置页交付与操作说明

第87批接入[安全断开水位及同进程代际接管基础](PUBLIC_DISCONNECT_HANDOFF.md)：原Gateway先排空/写入可信disconnected，再按默认策略结束；原session-manager拒绝旧代际/重复或不同水位接管。新WebSocket恢复装配未开放，不代表端到端续接通过。

第86批补[原内部恢复前置查询](PUBLIC_RECOVERY_CHECKPOINT.md)：只读核验原会话授权/窗口并返回可信接收水位，不更新Token/预占/计量，且不能取得模型配置或凭据。实际断开状态保存与连接代际接管仍未完成，不能据此开启重连。

第85批修复[手机原生命周期](MOBILE_PUBLIC_CREATION.md)：保留已确认暂停且仍存活的公有连接，前台恢复重新核许可并等待原连接ACK；不再主动断开后调用未实现的公有重连。真正断线续接与真机后台能力仍未通过，未改服务器或扩大生产准入。

第84批完成[结束回执丢失后的原链恢复HOST验收](PUBLIC_END_RECEIPT_RECOVERY.md)：补原API/Gateway和手机的故障回归，生产代码未改。验证同一会话、原译文保留和唯一结算，不代表运行中断线续接、真机或多实例恢复通过。

第83批将未决创建处置接回[原手机同传页](MOBILE_PUBLIC_CREATION.md)，只有明确查询/确认及精确终态回执落盘后才允许下一次手动开始换键；不新增管理页、自动重连或模型调用。HOST/Widget通过，未安装、部署或扩大生产准入。

第82批增加[未决创建服务端处置合同](PUBLIC_CREATION_RESOLUTION.md)：原账号下查询、撤销、过期及持久化防重建；只释放无运行/输出/调用/结算证据的用户预占。已有运行会话转原生命周期对账，供应商预算不自动释放。手机入口尚待接入，默认生产门禁不变。

第81批增加[原手机公有创建与开始确认](MOBILE_PUBLIC_CREATION.md)：先持久保存请求键，再调用原创建路由；响应绑定校验、可取消启动和精确started确认后才传音频。未知请求的显式处置、完整公有重连及真实设备资格仍待完成，不能据此启用生产。

第80批增加[会话级Gateway材料与WebSocket说明](PUBLIC_GATEWAY_RUNTIME.md)。配置与凭据分开读取，凭据通道需要独立服务端认证且默认关闭；原WebSocket可在显式测试接线下运行会话级公共组件。真实供应商/设备/部署资格未验，公有断线续接和多实例门禁仍未完成，不可据此开启生产。

第79批增加[原HTTP协调与当前授权查询](PUBLIC_HTTP_ADMISSION.md)。原创建路由仅在启动时明确注入可信回执来源后才支持公有分支；默认仍关闭。Gateway只读授权查询不返回Token/模型密钥，也不更新活动或计费。请求键重放保护目前覆盖原快照路径，PostgreSQL对应路径未就绪，不得直接开启生产流量。

第78批增加[内部会话凭证发行说明](PUBLIC_SESSION_ISSUANCE.md)：已有配置/授权/lease与原额度预占、签名及Gateway组件之间具备严格绑定，手机响应采样率来自lease；公网创建/连接门禁尚未开放。配置页仍不发起推理或自动授予资格。

第77批新增[协议能力矩阵](PUBLIC_MODEL_CAPABILITY_MATRIX.md)。原配置页按已实现协议提示连续/完整输入、输出形态和语言约束，采样率选项与服务器/Gateway共用约束；旧不兼容值保留显示、明确要求修改，不自动改写。启用并保存不支持的采样率会拒绝；朗读关闭不依赖旧TTS采样率。配置保存仍不是模型资格或公有运行就绪。

状态：本地开发与页面验证完成；**未部署、未激活推理、不是1.1发行声明**。

## 页面与职责

- `/models/public-config`：Qwen、腾讯、OpenAI、Google；ASR、翻译、TTS独立配置，15个协议项。
- `/models/private-config`：自托管ASR、LM Studio/Hy-MT2/兼容翻译、HTTP/流式TTS，5个协议项。
- 页面顶部可切换，两类配置和凭据不互相复制；这不是手机新增第三种处理模式。
- 保存只准备配置，不写已有MODEL_ROUTING_FILE、不热切换会话、不启停模型或触发探测。

## 部署准备：另行授权后执行

不要将本工作线覆盖运行中的冻结1.0实例。管理服务应使用已明确的独立1.1目录、监听地址和数据位置。未经批准，不复制1.0密钥/历史，也不使用临时预览的虚构凭据。

| 范围 | 环境变量 | 要求 |
| --- | --- | --- |
| 管理鉴权 | INTERNAL_API_SECRET | 独立实例现有管理密钥，至少16字符；普通用户token不具备配置权限 |
| 显式Google ADC | PUBLIC_GOOGLE_ADC_FILE | 仅公有实例、绝对普通文件、叶文件非symlink、无group/other权限且≤64KiB；两种支持类型见下文 |
| 公有配置 | API_RESULT_SYNC_DEPLOYMENT_ID | 公有实例身份；会影响该实例公有准入语义，不应为打开私有页面而设置 |
| 公有配置 | PUBLIC_MODEL_CONFIG_FILE | 独立绝对文件路径 |
| 公有配置 | PUBLIC_MODEL_CONFIG_KEY | 安全托管、持久保留的64位十六进制AES主密钥 |
| 私有配置 | PRIVATE_MODEL_CONFIG_DEPLOYMENT_ID | 私有配置身份，与公有标记无关 |
| 私有配置 | PRIVATE_MODEL_CONFIG_FILE | 与公有文件不同的独立绝对路径 |
| 私有配置 | PRIVATE_MODEL_CONFIG_KEY | 独立安全托管的主密钥；不得每次启动随机重建 |

仅私有管理实例不需要API_RESULT_SYNC_DEPLOYMENT_ID。页面读写需要HTTPS或真实loopback客户端；即使私有模型端点允许HTTP，也不应把管理密码在裸公网HTTP中传送。反向代理须沿原可信代理设置，不扩大信任范围。

## 管理员操作

1. 打开对应页面，输入该管理实例凭据，点“加载配置”。
2. 分别选择组件的服务商/服务类型、协议、地址和模型；需要时填写Voice/AppID/Project/Location/Recognizer等。
3. 公有地址使用协议要求的HTTPS/WSS；私有地址支持HTTP/HTTPS，health/flush/stream辅助地址须同源。不得把key塞入URL。
4. 输入供应商密钥。已配置密钥不会回读，留空保留；换服务商/auth/origin会清除旧key，需重填。显式清除仅作用于勾选组件。
5. 保存后检查revision与字段状态。`configured_not_verified`仅表示配置字段齐备，不表示模型可调用或实际质量已通过。
6. “导出无密钥配置”用于审阅参数，不是包含密钥的完整备份。离开页面可锁定；锁定不撤销已发送的保存请求。

## 验证边界

该阶段已验证字段/鉴权/加密/不回显/CAS/公私隔离与真实浏览器操作。后续S4-B已补服务器内部配置快照与原会话绑定，但实际适配器消费、供应商资格、数据同意、预算、费用对账与公开会话工厂仍未齐备；不能删除入口保护来让配置看似生效。

未来联调必须冻结配置revision和协议版本，以合成数据先做本地检查。真实音频、收费请求、部署、App安装、推送和发布仍逐项取得授权，不能根据“已保存”或“有API Key”自动执行。

### 内部公有会话工厂（S4-B，非公开启用）

原ProviderRouter现已能以同一快照/授权/会话/owner/lease装配原ASR→MT Provider及原TTS队列。当前ASR支持openai_realtime_asr（24k PCM）、qwen_asr_realtime或tencent_asr_ws（均为16k PCM）、google_speech_v2（gRPC，16/24k），翻译可选Qwen/腾讯混元/OpenAI兼容MT或Google Gemini/Vertex原生MT；开启朗读的联合组件出口还要求openai_speech、qwen_tts_realtime、tencent_tts_ws或google_cloud_tts资格/配置，型号与Voice仍手填（腾讯和Google命名声音接口的服务身份见下文）。原provider-only出口仍拒绝启用TTS，防止调用方遗漏输出链。仅conversation/listening音频输入、明确语种；自动语言/反向、ASR热词/纠错、未接入Speaker和其他协议明确拒绝，不静默删参数或回退私有。

工厂构造不调用网络，启动仍必须通过可信服务端回调核验原grant/lease/config；模型dispatch进入原attempt writer。该内部实例只绑定一次精确会话，准备失败/停止后不可自动重开，直接文本输入未准入。静态参数通过及合成回调成功不是供应商资格，health/readiness不因此变为ready。公开create/Gateway入口、生产凭据输送、跨重启恢复、真实资格与设备旅程门禁继续保留；下一批补Qwen非实时兼容ASR。用户没有购买模型不影响这些合成开发。

## 故障处理

### Google Cloud TTS内部组件（google_cloud_tts）

填写HTTPS origin、/v1或完整/v1/text:synthesize，指定projectId和含语言/地区前缀的Voice全名，例如ja-JP-Standard-A，采样率选16000或24000。locale从所选Voice提取并与会话目标语言核对，不补默认en-US，不接受无地区名称或自定义声音参数；cmn与普通话、cmn-TW与zh-Hant、yue与粤语按明确规则关联，不代表所有Voice已通过质量验收。

使用服务账号或显式ADC，沿原resolver取访问令牌，令牌须覆盖请求超时；ADC quota项目若不同于配置projectId则拒绝。不能将API Key/原始JSON作为Bearer，不读取全局gcloud/metadata身份。模型名可为空，运行快照仅用service:google_cloud_tts作服务身份，不伪造底层型号；旧空模型候选须重新准入。

当前REST整段合成，输入受5000 UTF-8字节及既有4096码点限制。LINEAR16返回带WAV头的Base64音频，代码严格校验并剥离头部后再分块送手机；不是模型流式输出。帧率/声道/格式/截断错误均拒绝，不播放头部或静默重采样。没有供应商usage时费用未知；服务账号/ADC两条合成旅程通过不代表实际IAM、项目、Voice或手机听音通过。

### 腾讯公共TTS内部组件（tencent_tts_ws）

配置选择腾讯流式TTS，填写wss://tts.cloud.tencent.com/stream_wsv2（不自带query）、数字AppId与VoiceType、SecretId/SecretKey，采样率选16000或24000。此接口不用Bearer，不是/stream_ws或腾讯MPS协议；本次限定zh/en及普通VoiceType，具体音色的语言与24k支持仍需实测，SSML/复刻场景未实现。

模型名可留空：原配置/页面仍为空，运行快照和调用记录以service:tencent_tts_ws关联服务身份，不发送model参数、不伪造供应商模型版本。已有空模型名腾讯候选快照的策略hash会变化，须重新准入，不可隐式续接。签名URL含SecretId和短期Signature，不能写日志、分享或放到手机；SecretKey及文本不进入URL。

READY后发送一次SYNTHESIS和COMPLETE，PCM与FINAL均通过检查后才确认；取消/断线/超时不重试。原队列按实际16k/24k输出，不再固定24k。响应无usage或模型回执时保持未知，服务身份不作为性能资格。目前仅原API/模型替身联合旅程通过，公开入口仍关闭。

### Qwen公共TTS内部组件（qwen_tts_realtime）

配置选择Qwen Realtime WebSocket协议，填对应地域WSS地址（不自带model查询参数）、模型与Voice，采样率选24000。此项不是CosyVoice/Qwen-Audio-TTS的run-task协议。目标语言按zh/en/de/it/pt/es/ja/ko/fr/ru映射，未覆盖语种明确拒绝，不回落Auto；每个具体型号/Voice的语种及地域资格仍待真实验证。

每段独立连接，精确session.updated后才发送最终文本并commit，响应/item及PCM事件必须一致，完整响应与session.finished确认后记录成功。取消/超时/协议错误关闭socket且不重试；默认无克隆/设计/附加指令。原队列分块、去重、暂停/恢复/停止保护保留。服务器characters及输出audio_tokens可保存为用量元数据，但costStatus仍unknown，不换算成账单金额。

Qwen已完成原联合旅程合成验证，未实调用或听音；每段握手开销/配额/性能未验。腾讯和Google各自首版协议也已完成本地接线。原公开准入仍关闭，不能将四家各一个协议候选泛化成全部模型/声音/语种/模式可用。

### 公共TTS内部组件（openai_speech）

原HttpTtsSynthesizer及原朗读队列已接openai_speech，配置采样率须选24000，模型与Voice手填；根域名补/v1/audio/speech，已含路径前缀保留，完整/audio/speech不重复追加。请求response_format=pcm，不支持将私有JSON、NDJSON、MP3或WAV当作裸PCM。Qwen、腾讯、Google按各自协议接入，不能因为表单能保存就认为真实推理已通过。

只接当前会话最终译文、明确授权目标语种与revision；不支持自动反向或临时更换成未绑定的Voice，不新增克隆音色。单次输入≤4096字符，输出最多120秒，prefill沿调用配置20–1000ms；不截断文本、不自动重采样、不自动重试。同段同revision候选内不重复合成/播放，API也拒绝换ID重复请求。公共TTS必须先保存调用意图，EOF后保存终态；usage缺失仍unknown，PCM长度不是供应商账单，合成confirmed不是手机听音成功。

声音开关会取消原合成器在途请求，旧代际不能输出迟到音频；运行中preset仅允许本次配置绑定的Voice，不合格选择直接拒绝。暂停立即阻止新朗读，服务端确认恢复后才开放；结束保存原ASR/MT尾句但不再合成。API停止/结算确认先于等待迟到TTS记录，后者不重启计量。公共失败沿原tts错误事件非自动重试返回，字幕保留。

联合组件出口现已通过正常/取消/合成失败/存储失败四类原API合成旅程，并增加Qwen/腾讯/Google的TTS及ASR场景（Google含服务账号/显式ADC）；仍未装手机或实调用。原provider-only方法保留关闭朗读限制，使用联合出口才能取得配套队列，不能只取Provider丢弃输出。公开创建/运行门禁继续关闭，不能手动移除保护来测试；下一批补Qwen非实时兼容ASR。

### 公共ASR内部已结束片段入口

google_speech_v2现使用双向gRPC，不是REST识别。填写模型、projectId、location、Recognizer ID（可为_）和对应地区HTTPS origin；global对应speech.googleapis.com，其他地区对应location-speech.googleapis.com。原页面新增languageLocales JSON，如{"zh":"cmn-Hans-CN","en":"en-US"}，由会话源语言选取匹配项，缺项/跨语种拒绝；旧Google ASR配置需补映射后重新绑定，不自动默认en-US。

首消息只有Recognizer/配置，configMask=*覆盖原Recognizer默认设置，后续只发送16/24k PCM。显式Bearer和quota项目必须一致，令牌覆盖整个turn；使用锁定的官方protobuf与gRPC库，启用TLS并关闭自动重试，不做GoogleAuth环境发现。稳定文本、响应EOF和gRPC成功状态均满足才确认，费用只按供应商metadata记录。每段独立RPC，真实连接开销/延迟、IAM/模型/地区/SDK安全与手机资格仍待验；原配置脚本和API保存通过不代表新字段已做浏览器视觉验收。

tencent_asr_ws选择腾讯账号AppId、SecretId/SecretKey和明确的16k引擎类型，WSS完整/asr/v2/AppId路径必须对应配置；不是腾讯TTS、TRTC或MPS协议。当前11个已知引擎与源语言精确匹配，其他引擎/8k不自动猜测。ASR签名不带TTS签名中的GET前缀，签名URL不可记录或传给手机。

腾讯在首包PCM时懒建连接，收到ACK后按≤1280字节/40ms节奏发送；每应用端点用end结束流并等稳定结果和final，下一片段用新voice_id，不是失败重试。needvad=0，仍由手机VAD分句；原会话/lease/全局采样水位不变，不额外重发未知音频。每个新流重新检查授权/凭据，createSession返回不证明腾讯握手ready。真实网络的发送间隔、账号默认词表/自学习、时钟/配额/质量仍需资格验收，不能以本地合成测试代替。

qwen_asr_realtime已接原共享流式生命周期/HttpAsrProvider：手填WSS/model，输入必须16k PCM。语言限定产品与官方代码的已实现交集，turn_detection=null，由手机VAD与原Gateway边界显式commit，不用云端自动分句。text+stash按整句草稿替换，最终transcript覆盖；协议/身份/前缀错误失败，逐批采样水位和attempt先确认再append，不自动重试或在close隐式session.finish推理。缺逐段usage仍unknown。官方示例中的旧模型占位值不作为资格，实际握手回显及性能仍待验。

手机原入口已能按公有响应captureSampleRate（整数16000或24000）准备采集，缺失/非法值拒绝，私有默认24k不变。生产公有创建必须从已签发runtime lease写出该字段；发行接线尚未完成，不能仅修改ASR配置就对外开放。ASR采集率与TTS输出率各自绑定，不能相互替代，Gateway不静默重采样。

原Gateway现有audio.boundary/回执控制及队列边界；原iOS录音唯一PCM流已旁路接既有Silero VAD，沿原客户端按最后成功发送序号自动提交并等待精确ACK。在线不启动手机ASR，VAD参数从原AppConfig传递；原生VAD桥自身支持iOS17且不依赖Apple ASR资源资格，不代表整个App已取得该系统版本资格。缺模型/桥或分析失败明确停止，不自动下载或退化RMS。累计原文沿原transcript.partial链进入手机草稿，final覆盖；目前仅HOST与无签名iOS目标构建通过，真实VAD推理和手机显示尚未验收，Android对应桥未新增。

VAD每4096样本（16k下256ms）分析，最多2秒待分析队列，成功上传音频按28秒做最长片段保护；不裁剪静音、不修改上传PCM，不承诺带宽/费用或端到端延迟达标。保留原回声门；主动结束排空已接受音频，不重复提交句尾，失败不假报结束。真机蓝牙/后台/来电/长测和分句质量仍待验。

公有暂停/结束收到时先停止继续接收和待播，尾部提交/保存完成后才确认暂停；恢复需等确认再收音。失败的公有音频/控制/同步会关闭连接，不发成功结束回执，不能靠继续心跳当作运行正常。私有1.0快速暂停顺序不变。实际端点频率、确认延迟、容量、恢复和同一候选手机旅程仍需验收，公开创建/模型工厂入口仍关闭。

openai_realtime_asr现已具备内部流式传输候选，仍未开放公网入口：必须配置24k PCM，等待型号/语种/格式/关闭自动turn detection的精确ACK，逐批原API记录通过后才append，显式句尾或flush才commit。模型ID仍手填，真实endpoint/model握手资格另验。delta已接原事件和手机草稿处理链，但未做真实手机验收；ASR热词/纠错非空会明确拒绝，自动语种/反向未支持。

流式音频必须带原Gateway接收点在服务器内存标记的可信采样范围；客户端JSON字段和墙钟时间不是采样依据。batcher必须保留该范围，缺口拒绝；强制排空大包只拆网络写入，不拆句子。当前单turn100ms–30s、无自动重连/重试、close不隐式commit。每批API水位ACK、增量路由和公有pause/stop顺序已做合成验证；原生端点代码已接线但真机未验，实际公网工厂仍未完成装配准入，不能仅切配置就上线。

openai_transcriptions现有内部完整片段实现：从配置读取型号/HTTPS Base URL/超时/采样率，明确两字母源语种、16k/24k PCM16单声道、单段≤30秒。根域名追加/v1/audio/transcriptions，版本前缀追加/audio/transcriptions，完整该路径不重复追加。自动语种/反向仍明确拒绝；不是完整实时ASR。

qwen_asr_compatible同样通过原完整片段入口实现，不加入实时AsrProvider或增长采样范围协议名单。使用手填的Qwen3-ASR-Flash兼容型号、HTTPS Base URL与API Key；选择支持OpenAI兼容方式的地域/型号，不能填写仅异步Filetrans的接口。完整PCM经原WAV封装为内联data URL，POST chat/completions，stream=false，asr_options.language跟随明确源语种，enable_itn=false；单段16k/24k、≤30秒。根域名追加/v1/chat/completions，带前缀追加/chat/completions，完整路径不重复。配置保存不联网、不下载、不上传OSS文件。

Qwen响应必须完整结束，单个assistant结果；若返回语言注解则必须与本次配置一致。reportedModel/requestId与token/秒数只保留供应商实际报告的值，缺用量仍unknown；不把采样秒数当费用。取消/超时/不完整响应不重试，沿用原调用意图与已确认采样水位保护。自动语种/反向、真实供应商资格和公网创建入口仍未开放。参考[官方非实时ASR协议](https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference)。

必须由后续可信端点/片段逻辑提供complete输入，不能将原120–800ms网络批次直接当完整句子。原API按lease和已确认采样水位接受ASR attempt，拒绝重叠范围重发（not_sent除外）；不能通过新UUID重放可能已收费的音频。采样范围不是用户计费时长，供应商usage缺失仍unknown。

### 兼容翻译地址与内部接线

Qwen Chat、腾讯混元兼容Chat和OpenAI Chat现可由原Router内部组件工厂消费已绑定快照；这不等于公开会话已启用。Base URL含路径时直接在其后追加 `/chat/completions`；纯域名使用 `/v1/chat/completions`；已填写完整 `/chat/completions` 不重复追加。服务商实际地址仍需按所选API核验，不会从私有环境变量自动补齐。Google原生协议需独立适配，不能套用这个拼接规则。

模型未购买不阻塞开发和合成测试；真实凭据、调用、供应商验收与部署另列。保存配置仍不调用模型。

Google原生generateContent协议已在原客户端接入：endpoint填HTTPS origin或/v1、/v1beta、/v1beta1版本前缀，项目/区域/模型通过各自字段配置，不填Chat Completions或完整资源路径。Gemini用API Key请求头，Vertex用短期Bearer令牌；工厂要求令牌有效期覆盖请求。原models域现已支持加密服务账号OAuth交换及显式ADC文件两种类型（service_account、authorized_user）；后者必须有quota_project_id，并通过x-goog-user-project传给Vertex。不能把原始服务账号JSON/API Key当Bearer。缺令牌明确拒绝，公开入口仍关闭。

ADC只读PUBLIC_GOOGLE_ADC_FILE，不读取全局GOOGLE_APPLICATION_CREDENTIALS、本机gcloud登录或metadata server；身份联合、模拟账号等其他类型未支持，不能执行文件中的外部命令。token_uri只允许固定Google OAuth端点。当前验证全用临时虚构密钥和模拟响应，真实文件配置/权限/IAM/调用仍另授权。

短期令牌仅内存缓存，覆盖请求超时加30秒余量才复用；并发交换合并、最后一个等待者取消时中止。配置revision每次复查，ADC内容在同一resolver内变更会拒绝。但ADC指纹未跨重启持久化，生产恢复不得自动重建旧会话并调用模型，需补凭据源版本绑定或明确重新准入；不承诺改文件/重启后旧会话无缝继续。

| 现象 | 处理 |
| --- | --- |
| 401 | 核对管理凭据来源，不改为普通账号或关闭鉴权 |
| 403安全传输错误 | 使用HTTPS或受控本机通道，不伪造转发头 |
| 409 revision冲突 | 保留需要的非敏感修改，重新加载后人工合并，不强行覆盖 |
| storage_not_ready | 核对该模式的路径、主密钥和部署身份；不要给私有模式补公有标记 |
| unreadable/invalid_storage | 停止写入，检查原主密钥、身份、文件类型和完整性；不能重置为空配置 |
| 已配置但不能运行 | 查看适配/准入门禁，配置保存不是运行就绪证据 |

## 备份与回滚原则

- 加密文件与对应主密钥必须分别安全托管；丢失主密钥无法靠无密钥导出恢复凭据。
- 本轮不执行任何备份迁移、文件删除或服务回退。正式备份位置、保留期及恢复演练在部署授权时明确。
- 若后续候选需回退，先停止新的管理变更/模型准入，保留当前密文、revision和未决调用证据，再按批准的精确目标恢复已知候选。
- 不能把公有配置交给私有模式解密、清空公有标记绕回1.0旧链，或将未知调用费用补成零。
- 当前文件CAS只保证单进程串行写；生产多进程/HA和KMS集成尚未验收。
- 内部运行快照按部署/revision/完整参数绑定原会话，不含密钥；配置或密钥轮换后旧快照不能取新凭据。当前密文只保留最新版本，没有旧密钥无缝恢复能力；不能在后续上线时承诺改配后旧会话无感继续。
- Google ADC的两类显式文件令牌解析已完成合成验证，真实资格、完整ADC类型和跨重启源版本绑定仍未通过；不能以已填写项目/location或模拟换令牌成功冒充实际可用。旧同步原始凭据读取函数仍拒绝ADC，运行工厂须使用新的受范围约束的异步resolver。
