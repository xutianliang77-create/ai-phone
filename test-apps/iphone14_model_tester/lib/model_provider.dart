class ModelProviderSpec {
  const ModelProviderSpec({
    required this.id,
    required this.name,
    required this.kind,
    required this.modelId,
    required this.resultMode,
    required this.available,
    required this.description,
  });

  final String id;
  final String name;
  final String kind;
  final String modelId;
  final String resultMode;
  final bool available;
  final String description;
}

class ModelProviderCatalog {
  static const remoteAsrModelId = String.fromEnvironment(
    'REMOTE_ASR_MODEL_ID',
    defaultValue: 'Qwen3-ASR-0.6B-original-tuned-v3',
  );
  static const qwen3CoreMlModelId = String.fromEnvironment(
    'QWEN3_COREML_MODEL_ID',
    defaultValue: 'qwen3_asr_0_6b_coreml_int8',
  );

  static const appleSpeech = ModelProviderSpec(
    id: 'apple_speech',
    name: 'Apple Speech',
    kind: 'asr',
    modelId: 'ios_sfspeechrecognizer',
    resultMode: 'apple_speech_baseline',
    available: true,
    description: 'iOS 系统 ASR 基线',
  );

  static const coreMlNemotron = ModelProviderSpec(
    id: 'coreml_nemotron',
    name: 'CoreML Nemotron',
    kind: 'asr',
    modelId: 'nemotron_coreml_2240ms',
    resultMode: 'coreml_nemotron_asr',
    available: true,
    description: '独立测试 App 的端侧模型诊断与后续真实 CoreML ASR 入口',
  );

  static const remoteAsr = ModelProviderSpec(
    id: 'remote_asr',
    name: '远程 Qwen3-ASR',
    kind: 'asr',
    modelId: remoteAsrModelId,
    resultMode: 'remote_asr',
    available: true,
    description: '通过 Mac 局域网代理连接 Beelink/服务器 ASR 横评',
  );

  static const coreMlQwen3Asr = ModelProviderSpec(
    id: 'coreml_qwen3_asr',
    name: 'CoreML Qwen3-ASR',
    kind: 'asr',
    modelId: qwen3CoreMlModelId,
    resultMode: 'coreml_qwen3_asr',
    available: false,
    description: '已从 iPhone 14 端侧测试队列剔除：int8 输出乱码且延迟过高',
  );

  static const all = [
    appleSpeech,
    coreMlNemotron,
    remoteAsr,
  ];

  static ModelProviderSpec byId(String? id) {
    for (final provider in all) {
      if (provider.id == id) return provider;
    }
    return appleSpeech;
  }
}
