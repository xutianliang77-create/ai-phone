# CO11-12 Android 公有版交付准备

## 2026-09-29 现行边界：已有HOST，身份/签名及当前auto兼容仍待

当前汇总见 [交付入口](CLOSEOUT_HANDOFF.md) / [currentDelivery](closeout-snapshot.json)。本批没有新构建、签名、安装、测试或密钥操作。下方“未运行”为各准备时点的历史记录，不覆盖已有原生/Kotlin/候选合同HOST成果，也不冒充Android设备通过。

除了独立public applicationId、已有签名材料/alias和可信证书指纹，当前r3 Qwen Audio3.1自动语种还有明确平台边界：[supportsDeviceTextLanguage](../../../apps/mobile/lib/src/platform/asr/device_text_language.dart)仅iOS为true；[创建前检查](../../../apps/mobile/lib/src/features/realtime/data/api/public_creation_contract.dart)会拒绝当前组合的Android自动源语言并提示固定源语言。固定源语言路径与auto不同，本批不证明它已真机可用。接线/首发能力边界归原CO11-12/16，不由文档擅自换模型或删减范围。Android端侧Sortformer仍未提供。

## 2026-09-26 集中验证追加结果

当前工程候选16b4872：Android候选合同26项、原生Kotlin编译及显式rerun的3项Kotlin测试通过。离线缓存缺依赖的首轮失败保留，后续沿原版本补齐；未生成正式public签名APK，未安装/执行Android设备验收。正式applicationId、已有keystore/alias与可信证书指纹仍待提供。下文“未运行”为开发准备时的历史状态，不覆盖本段结果；完整同源iOS/服务端与来源对应见CLOSEOUT_HANDOFF.md及外层集中SUMMARY.json。

2026-09-26：`DEVELOPMENT_PREPARATION_COMPLETE / IDENTITY_AND_SIGNING_INPUT_PENDING / NOT_VALIDATED`。

本轮只编写源代码、候选流程和后置用例。没有执行Gradle/Flutter、静态检查、测试、APK分析、证书检查或设备操作；没有生成密钥、下载模型、构建/签名/安装APK。下述命令仅供全部开发完成后的统一阶段使用，不是已发生的交付回执。

## 1. 原功能与平台分工

复用同一无界AI Flutter App和原Android native package `com.example.translation_mobile`，不建第二套产品。已显式指定原MainActivity全类名，所以独立public applicationId不要求迁移Kotlin源码包。冻结私有1.0与用户原改动保持不变。

| 功能 | 保留的实现 | 不能据源码宣称的能力 |
| --- | --- | --- |
| 本地ASR | Android `createOnDeviceSpeechRecognizer`，API31及端侧服务不可用时拒绝；不借网络识别器 | 系统提供服务不等于每个语种资源已安装/已验证 |
| 本地翻译、朗读、OCR | 现有ML Kit翻译、系统TTS、手机OCR桥 | 不用iOS资源或旧测试APK证明Android设备能力 |
| 在线音频 | 原单PCM链＋Silero ONNX旁路VAD；上传的采样率/序号/音频不变 | 不新增第二路麦克风，不降为RMS，不借Shizuku权限 |
| 在线模型 | 原公有API/Gateway；ASR/MT和开启时的TTS按服务器配置 | 手机不固化供应商模型或保存其密钥；选择在线不静默改本地 |
| 说话人 | 现有手机工厂只在iOS提供Sortformer；Android候选显式`ENABLE_DEVICE_SPEAKER=false` | 不能声称Android已有Sortformer效果；保持匿名/unknown，不按语种猜人 |
| 历史与账号 | 原账户/部署命名空间及本地/在线Repository，独立public applicationId提供独立沙箱 | 不导入私有1.0账号、token、历史或余额，不自动迁移数据 |

`android-device-development.json`冻结本轮完整Android本地配置，保留原默认VAD参数、不新增自动模型下载或诊断录音。运行时仍由原设置控制本地/在线；本地自动语种/反向禁用规则不变。`WUJIE_PRODUCT_PROFILE=full`保留原功能入口及其白名单/隐藏级别。

## 2. 原Gradle中的公有候选分支

- 以实际Flutter `dart-defines`中的`PUBLIC_DEPLOYMENT_ID`或明确`PUBLIC_ANDROID_BUILD`/public applicationId声明识别公有构建。
- 公有身份由`PUBLIC_ANDROID_APPLICATION_ID`显式传入；模板包名、历史测试包名和已配置私有applicationId被拒绝。没有本轮批准的正式包名，不能自行选择。
- 签名仅从`PUBLIC_ANDROID_*`或独立`public-key.properties`取得；不能回退到`TRANSLATION_ANDROID_*`/私有`key.properties`。允许复用已经批准的现有签名密钥，但必须由公有配置明确指定，不隐式借用。
- 缺签名字段/文件、完整本地配置、clean源码身份、deployment或一致的Dart/native版本时拒绝。没有改成Debug签名，也不让未签名产物冒充公有候选。
- native namespace保持原包；applicationId决定安装/沙箱身份。Manifest记录从实际Dart构建参数读取的candidate、commit/tree、sourceState、productProfile、deployment及本地profile摘要，便于后置核对。
- 原非public构建继续使用既有配置，不改写其密钥或发行标识。

签名模板：`apps/mobile/android/public-key.properties.example`。实际文件已在根与Android `.gitignore`排除，应放在私有位置并设为仅本人可读。不要将密码发到聊天、放在命令参数或写入Git。仓库旧`generate_android_release_keystore.mjs`不属于本轮执行步骤；本轮不生成/覆盖密钥。

## 3. 统一阶段需要的准确输入

| 输入 | 来源/要求 | 当前结论 |
| --- | --- | --- |
| `PUBLIC_ANDROID_APPLICATION_ID` | 用户确认的独立公有发行包名；不能从iOS Bundle或私有包名推定 | 待提供 |
| 签名文件、alias、密码 | 已有公有签名材料；`PUBLIC_ANDROID_KEY_PROPERTIES`可指向私有配置文件，或使用PUBLIC_ANDROID_STORE_FILE/STORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD | 待提供；不生成新密钥 |
| `PUBLIC_ANDROID_CERT_SHA256` | 经授权选定证书的可信SHA-256；不能从待验APK反推为“预期值” | 随签名材料在统一阶段确定 |
| `PUBLIC_DEPLOYMENT_ID`、`SERVER_BASE_URL` | 与选定同源1.1公有服务器一致，设备可达HTTPS，无URL凭据 | CO11-14绑定，不硬编码旧QA/IP |
| `APP_VERSION=1.1.0`、`BUILD_NUMBER` | 与native versionName/versionCode精确一致；正数且不超过2100000000 | 构建阶段固定 |
| 语种参数 | source/target、autoReverse、明确自动语言对；沿原路由，不硬编码中英业务能力 | 构建阶段固定 |
| 工具与依赖 | 已有Flutter/Android SDK/锁定依赖；可指定FLUTTER_BIN/APKANALYZER/APKSIGNER | 本轮未运行检查或安装 |

单次候选使用一个`TARGET_PLATFORM`：默认`android-arm64`，可明确选择`android-arm`或`android-x64`；这不是目标设备已匹配的声明。正式渠道若要求AAB，应在原发布任务确定渠道后沿同源签名流程交付，不能把本APK QA流程当商店上架完成。

## 4. 后置候选流程（本轮未执行）

入口：`node scripts/build_traceable_android_candidate.mjs build`。

该入口只在统一阶段运行：

1. 要求干净、固定的完整源码提交/树；读取完整Android profile和原VAD清单。输入缺项即停止，不生成签名密钥。
2. 使用相同defines、版本和签名输入，先执行原Flutter Release `--config-only`刷新生产插件注册，再执行Release APK构建；使用现有依赖，不手改GeneratedPluginRegistrant或把IntegrationTestPlugin塞入用户包。
3. 用现有Android SDK读取实际APK的包名、版本、非Debug状态与Manifest元数据，按预期证书指纹核签名；同时比对包内VAD字节/摘要和许可证NOTICE。
4. 再确认源码没有被构建改变，以排他复制归档APK，记录APK摘要、源身份、profile、目标ABI、证书指纹与原生退出码。输出已有时拒绝覆盖，不删除旧候选。
5. 清单只声称对应构建/包检查通过，明确`installed=false`、`deviceVerified=false`、`sameSourceServerQualified=false`、`releaseAccepted=false`。不调用服务器健康/模型接口，不执行adb安装或启动。

默认输出`.cache/android-candidates/<candidateId>/`；准确稳定归档位置由原CO11-14/18交付流程决定。本轮没有生成该目录、APK或通过回执。

## 5. 保留的验收与外部边界

- 本轮新增`android_public_candidate_contract.test.mjs`仅编写、未执行。它覆盖配置/身份/元数据拒绝条件和流程约束，不是Gradle编译、真实签名或设备证据；这些必须在CO11-13/14分别完成。
- 先iOS、后Android真机顺序不变。CO11-16再验证普通权限下本地资源、无网/在线、VAD、朗读/打断、蓝牙/锁屏/来电/网络、30分钟100段、历史和唯一结算。
- 当前局域网若使用私有CA，必须在CO11-14明确目标证书/域名及Android应用的实际信任方式。系统已安装用户CA不等于Release App已信任；本轮未关闭TLS校验、未加入trust-all或全局用户CA信任，也未把LAN地址换到其他环境。
- Android端侧匿名说话人尚无与iOS同等的模型接线/效果证据；该能力保持未提供/匿名边界，不能凭`full` profile写成已经验收。
- 任何失败都不修改冻结1.0或旧APK/密钥/历史来“修复”本候选。签名变更与数据迁移需要明确对象，不使用卸载重装清数据替代升级验收。
