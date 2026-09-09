# 1.1 iPhone端侧接入（原无界AI App）

本配置构建现有`apps/mobile`，复用原页面、RealtimeController、历史Repository、ios_system翻译和SpeechOutputBridge。没有另建App、测试器或业务链。`apple_speech_transcriber`是在现有MobileAsrProvider工厂内增加的实现；旧Provider及私有版入口保留。

## 开发启用

2026-09-08资源登记修复（QA0809/正常0810）：系统installedLocales与当前App的reservedLocales是不同事实。首次使用已缓存语言时，原预检可返回canPrepareLocally，但仍canStart=false；原prepare在禁下载条件下只预约SDK解析出的已装locale，不释放旧预约。Native和Controller复查installed后才启动，实际start再检查。状态/语言/参数不匹配、下载中或未知状态不能借本地准备放行。QA0809的24个原App预录流程已完成，不等于自动语言/准确率/物理音频或发版通过。

2026-09-08 S2首批补充：原生翻译按实际SDK支持与安装状态解析请求语言，返回语言必须匹配，不再把其他语种换成中英；错误和原文保留。此为HOST/目标构建成果，未安装/真机验收。在线选择走公共模型的r6.1规则保持。

先从已审核本地缓存暂存Silero（源和目标5文件SHA核验，不联网、不覆盖）：

```sh
node scripts/stage_public_ios_silero.mjs /absolute/path/silero-vad-unified-256ms-v6.0.0.mlmodelc
cd apps/mobile
flutter build ios --release --no-codesign --no-pub \
  --build-name=1.1.0 --build-number=2026090810 \
  --dart-define-from-file=../../release/public/1.1.0/ios-device-development.json
```

配置文件启用**既有本地模式**和系统翻译，供端侧开发验证。它不是公有云在线发行配置，不能用它证明在线授权同步。默认语言偏好没有被覆盖：在原语言控件选择固定源语言。正常开始严格要求资源已就绪；autoDownloadModel不再将缺包改报canStart。S2资源准备UI已接入原设置页，显式确认才允许下载；start及Apple采音预热均不触发下载，真实设备资格仍待完成。

正式1.1应用身份/签名/渠道未在此冻结，当前Release配置仍继承原App身份，所以本次只构建无签名制品，不直接安装覆盖现有1.0。未来身份选择在D0完成。

## 实际音频和字幕链

- 原CoreMlNemotronAudioInput被复用为采音/16k转换实现，新增owner参数默认保持旧值；Apple使用独立owner并共享原AudioSessionCoordinator。
- 音频回调直接进入线程安全有界队列，单消费者按源offset连续送SpeechAnalyzer并运行Silero；缓存属于当前AppleSpeechSession对象。
- Silero仍为固定v6.0.0、4096新样本/256ms；默认0.6/0.35、96ms最短语音、640ms静音与800ms pre-roll，显式配置完整透传。FluidAudio当前流式事件未执行minSpeechDuration，产品端点改由已有CoreMlNemotronEndpointDetector消费同一Silero概率统一判断；这不是换回Nemotron ASR。有效参数及fingerprint在availability/diagnostics/边界事件可核对。整个PCM持续送ASR，不作裁剪；新端点时序必须重新真机验证。
- VAD语音结束请求SpeechAnalyzer按相应音频水位finalize，最终文本仍由ASR返回。VAD边界本身不触发译文/朗读。
- Dart把同一语音范围的partial/final映射到相同segment ID；复用RealtimeController的翻译、字幕和历史流程。不在Provider内建第二历史库或自行结算。
- 用户结束先停朗读，再停麦并排空已接收的尾块；尾VAD不足一帧只补零推理，不把零填充送ASR。整个排空/finalize/reader有3秒截止；超时失效本session的输出并报告错误。旧异步处理只能访问旧session对象。
- 队列溢出、Silero错误、ASR错误必须传播到原Controller；不标假ready、不默默RMS降级。

## 资格与剩余范围

Apple当前只启用用户固定源语言；auto/turn明确返回automaticLanguageNotQualified。自动反向和混合LID仍是原功能的待接入资格，不删除入口、不用locale冒充检测语言。系统翻译/声音各自检查资源，不把ASR可用当整链已验。

当前代码已经装配Provider/native入口，尚无这个原App构建的真机联合结果。实验测试器025的麦克风证据只作为来源参考，不能转写成本App DEVICE_PASS。授权同步、在线公共供应商调用、实际计费、全语言和30分钟产品回归继续按总计划推进；本配置不启用这些未完成的在线能力。

主机检查：Provider与既有Controller/停止/历史回归；Swift将`AppleSpeechInputQueue.swift`、`CoreMlNemotronEndpointDetector.swift`和`scripts/tests/apple_speech_input_queue_test.swift`一起编译，验证参数、端点、队列、尾块、溢出及截止。`OnDeviceTranslationLanguage.swift`和`scripts/tests/on_device_translation_language_test.swift`直接验证原生语言解析；二者均不调用模型。资源脚本可重复执行，仅核验跳过同SHA文件。

## S2预录原页面旅程（仅显式QA目标）

`integration_test/apple_prerecorded_journey_test.dart`导入原`TranslationApp`，经原五Tab主壳、实时控件、Controller、Apple Provider、ios_system和本地历史执行。不替换SceneDelegate，不显示“停止验证”，不运行旧独立模型测试器。它是测试入口，不是生产`lib/main.dart`的另一条业务主链。

- 正常Native不定义`WUJIE_APPLE_FILE_PROBE`，任何预录描述都会返回`prerecorded_input_disabled`，不能回落打开麦克风。QA仅在显式编译该宏时接受带SHA256的16kHz/单声道/PCM16 RIFF WAV，限制2MB及60秒；不接受任意路径、URL或参考原文。
- 测试音通过既有有界队列、同一Silero和SpeechAnalyzer，实时定速输入，保留offset/尾帧/停止截止；文件模式不创建CoreMlNemotronAudioInput、不申请麦克风权限、不启用TTS。Speech系统权限及已安装资源仍须实际满足，不能借旧研究入口放宽installed检查。
- 必须显式提供`S2_INPUT_NAME`、`S2_INPUT_SHA256`、`S2_SOURCE_LANGUAGE`、`S2_TARGET_LANGUAGE`；语言从参数传入原配置，不按测试文件名猜测。当前该固定语向旅程不宣称自动语言已合格。
- 输入须事先经授权放在App的`Library/Application Support/wujie-s2-prerecorded/inputs/<name>.wav`。新入口只读取，不下载、生成或向手机复制输入。名称/文件/父目录的路径越界、软链接和大小检查失败即停止。
- Dart业务路径在测试期间重定向到唯一的`wujie-s2-prerecorded/results/run-*/`，同意/设置/账号使用测试注入，原历史写入与读取逻辑不变；Dart HTTP在建请求前拒绝并计数，不将正式账号/历史上传。此边界不等于iOS系统权限、原生模型缓存或所有其他Tab功能的隔离验收。
- 必须等待原`LocalSessionStore`实际写入，不把Controller提前显示ended当持久化完成。观察器只等待原写入Future，不替换格式/去重/存储引擎；退出须排空Controller和写入后恢复路径。清理超时保持隔离与网络阻断，失败报告不能判通过。
- 结果在隔离目录`journey.json`及integration_test reportData。检查原控件开始/结束、原译文、样本计数、麦克风未创建、单次历史写入及原历史详情页。即使这个预录旅程DEVICE通过，也不能代替真实麦克风/耳机/TTS、准确率、后台/来电/长测和产品发版验收。

已存在的合成开发输入可复用`zh_short_002.wav`：SHA256 `2aa3efcbc8c932aecc73736d38e19d970414bf52321382a6f202654f491247e8`，48381样本/3.0238125秒；选择zh→en。参考原文不注入Provider。其来源为项目`wujie-1.1-iphone-apple-only-20260907T132500Z/file-inputs`锁定素材，不新增模型选型或消耗保留集。

构建使用`flutter build ios --config-only --release --no-codesign --no-pub --target integration_test/apple_prerecorded_journey_test.dart`及上述四个dart-define，再由原Runner的xcodebuild显式传入QA宏。正常版使用`lib/main.dart`且QA宏为空；构建完QA必须恢复正常目标配置，并分别记录两个制品的身份/哈希。**构建授权不包含签名、安装覆盖、手机文件暂存或启动推理；这些仍须按精确范围授权。**

## S2资源准备交互（0804，本地开发验证）

原App语言菜单→同传设置→端侧模式→“本地 ASR/VAD 与翻译资源”。进入页面不发下载或推理请求；点击“检查资源”只检查当前选定语言。显示未检查、检查中、未安装、准备中、已就绪、不支持、失败及取消；就绪不是质量/自动语言/系统声音资格。

- 用户点击某一资源的“准备所选资源”后，须确认可能联网和占用存储。只传语言、参数、显式布尔授权和requestId，不上传会话音频/文本，也不开始ASR/MT/TTS。
- ASR复用原Apple prepare和系统AssetInventory。Native要求显式下载许可，用户开始同传的旧autoDownload标志不能触发下载。VAD缺失或哈希错误只能提示修复包，不静默下载其他模型。
- MT复用原ios_system通道/语言解析，在原Flutter视图上临时呈现Apple支持的SwiftUI translationTask准备页，调用prepareTranslation请求系统许可；不替换Scene/root，不构造测试文本做翻译。installedSource初始化器仍只用于已安装资源的正常推理。
- 准备返回后再检查真实资源状态；系统请求返回但未安装完成不能显示ready。缺空间/网络错误/用户取消/超时分别回传，大小由系统管理，不虚构下载容量或进度百分比。
- 检查30秒、准备5分钟为等待上限；取消带requestId并停止本次等待，晚结果不能覆盖新配置。iOS共享资源下载可能仍由系统继续，本App不宣称取消了其他App的共享下载或删除了资源。切换设置/模式时原Controller销毁会请求取消旧准备，在线仍直接走公共链而不等本地资源。
- 无明确语言对时不猜中英；已明确的自动反向语言对检查两方向资源，但自动ASR本身仍标未资格。系统声音映射/离线资格是下一项，不把本资源页当TTS已验收。

依据本机iPhoneOS26.2接口及Apple文档：[prepareTranslation](https://developer.apple.com/documentation/translation/translationsession/preparetranslation())、[installedSource约束](https://developer.apple.com/documentation/translation/translationsession/init(installedsource:target:))、[AssetInstallationRequest](https://developer.apple.com/documentation/speech/assetinstallationrequest)。该系统弹窗与真实下载仍需同候选真机验证；本轮只完成源代码、HOST测试与无签名目标构建。

## S2系统声音映射（0805，未安装手机）

同一资源卡现在显示所选目标语向的系统声音名称、Voice ID、实际language和SDK质量等级。固定语向检查目标语言；明确自动反向语言对检查两侧；没有明确反向语言对不猜声音。检查不朗读、不下载，也不初始化AVSpeechSynthesizer；声线不可用时引导在iOS系统设置准备后重新检查，没有新增声音下载接口。

- 原“本地自然声音”按语言映射到当前系统可用标准声音，优先原系统语言默认，再按已有质量等级/ID稳定选择；没有硬编码具体人名/中英Voice ID。在线音色偏好继续保留，不冒充本机Voice ID，也不新增独立声音选择体系。
- 使用speechVoices目录及identifier重新解析确认设备可用，排除个人/搞怪与不在当前Apple命名空间允许列表的声音；此允许列表不是离线实测或来源签名证明。显式region/script不随意折叠，繁体不回落简体，zh-HK不默认为繁体普通话或yue别名，相关方言映射须后续真机资格。
- iOS speak先检查后固定Voice ID；Native按该ID再次验证，消失/错语言不回落，结束回调返回实际Voice ID/语言/质量。Dart拒绝缺元数据、错误Voice或没有完成确认的假成功。目录查询中stop/替换会使旧结果失效，新声音不可用时也不遗留旧朗读。
- 原队列、watchdog、AudioSessionCoordinator、echo gate与先停播放再等ASR尾句保留；本地只用系统TTS且拒绝服务端PCM，在线不调用系统TTS，即使有旧device-ASR标志也不改变用户模式。Android既有speak/stop协议保留，不继承iOS目录资格。
- 原中英数字/金额/代码规则保留；地域中英使用同规则。其他语种不再被统一改成英文数字/币种，繁体/粤语也不通过该英文回退改写。
- UI标“设备可用，断网待验”，offlineVerified/qualityQualified仍false。SDK可用目录与真实断网冷启动/耳机听音/首音延迟/发音语种不是同一证据；本轮没有真实朗读或系统声音下载。

依据：[Apple speechVoices](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices())、[identifier可用性](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/init(identifier:))和本机AVSpeechSynthesis.h。Apple的语音合成说明为设备侧处理，但本App仍要求按具体设备/声音做无网与听感验收，不据目录查询晋级产品。

## S2语言路由边界与原App联合QA（0806/0807）

正常0806继续原入口，Apple自动语种仍未资格，不把固定locale、文字脚本或A/B交替当成声学检测。新语言证据路由明确遵守：固定源不被detected标签改写；固定目标不因conversation模式自动反向；自动反向只在明确语言对内选择另一侧，第三语言/未知/混说/未资格文本推断保留原文，不造译文/朗读。无明确反向对不猜中英。旧无版本1.0数据保持其兼容语义，新版本字段缺languageEvidence不能降级到legacy。

Apple MT预检按同一显式语言对；auto源+固定目标不强迫补未知源语言，也不预检猜测的中英，改为在已知实际final语种后检查对应MT资源。反向对缺失/过期先拒绝；ASR availability核对实际locale，日志保存resolvedLocale。

0807是同一原App的受控预录QA构建，仍使用`integration_test/apple_prerecorded_journey_test.dart`。通过`S2_LANGUAGE_TRIALS`内嵌冻结矩阵（最多24项、唯一id、固定源/目标、WAV SHA），不从任意路径加载配置、不接受reference字段。输入文件仍在原受限inputs目录，结果仍逐病例隔离。

- `journey`：4个匹配语向病例执行原ASR/VAD→系统MT→字幕→结束→原历史。
- `asr_observation`：20个跨locale、混说、A/A/B、静音及短词病例只开原ASR/VAD与原历史，不开MT/TTS；这是QA观察配置，不是第三种产品模式。
- Native仅在QA宏内对ASR原始final记录NaturalLanguage假设，标`text_only_not_acoustic`和未资格，不给hint/constraint、不使用参考文本、不改变生产路由。原Provider的同一通道接收隔离诊断事件；capture/policy匹配，合法停前尾句可观察，最多2048项，溢出失败。
- 正常包不包含可用QA预录入口或文本观察执行路径。病例失败即终止后续执行并保留隔离；报告列计划数量/待执行ID，不把未运行病例标PASS。

矩阵和编译参数见项目`artifacts/releases/wujie-1.1-s2-language-20260908/LANGUAGE_QA_PROTOCOL.json`及`QA_MATRIX_DEFINES.json`。复用12个已锁定合成WAV，共1,262,516字节；无新生成或下载。实际第三语言音频、真实麦克风/声音、长测和公共链不在这24项范围，不据此签收完整S2。

本轮只本地开发/构建，不签名安装或运行该矩阵。执行前须另行获得精确设备QA授权并复核原App保全/恢复材料；之后才能判断Apple单引擎+文本观察是否足以推进自动语言，不能先把资格置true。
