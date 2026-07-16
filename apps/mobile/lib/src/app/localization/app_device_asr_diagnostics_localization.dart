const zhDeviceAsrDiagnosticsLabels = <String, String>{
  'audio.voiceProcessingPolicy': '语音处理策略',
  'audio.voiceProcessingAttempted': '已尝试语音处理',
  'audio.lastVoiceProcessingEnabled': '回声消除与系统降噪',
  'audio.lastVoiceProcessingAgcEnabled': '自动增益 AGC',
  'audio.voiceProcessingError': '语音处理错误',
  'audio.vadConfiguredProvider': 'VAD 配置',
  'audio.vadActiveProvider': 'VAD 实际运行',
  'audio.vadFallbackReason': 'VAD 降级原因',
  'audio.vadFallbackCount': 'VAD 降级次数',
  'audio.vadLastProbability': '最近语音概率',
  'audio.vadPreRollSamples': 'VAD 前置缓存采样数',
};

const zhDeviceAsrDiagnosticsValues = <String, String>{
  'voice_processing_error': '回声消除/降噪未启用',
  'apple_voice_processing_aec_ns': 'Apple 回声消除与系统降噪',
  'fluidaudio_silero': 'FluidAudio Silero 神经 VAD',
  'rms_fallback': 'RMS 降级',
};

const zhDeviceAsrRuntimeMessages = <String, String>{
  'Checking on-device translation language packs': '正在检查端侧翻译语言包',
  'On-device translation ready': '端侧翻译已就绪',
  'On-device translation language pack is not installed': '端侧翻译语言包未安装',
  'On-device translation only supports Chinese and English': '端侧模式当前仅支持中英互译',
  'On-device translation requires iOS 26 or newer': '端侧翻译需要 iOS 26 或更新系统',
};
