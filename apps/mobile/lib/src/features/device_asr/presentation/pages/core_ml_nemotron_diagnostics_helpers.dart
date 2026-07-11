import '../../../../app/app_config.dart';
import '../../../../platform/asr/mobile_asr_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../realtime/presentation/controllers/realtime_runtime_factories.dart';

MobileAsrConfig diagnosticsDeviceConfig(
  AppConfig config,
  bool allowDownload,
) {
  final base = createDeviceAsrConfig(config);
  return MobileAsrConfig(
    language: base.language,
    chunkDurationMs: base.chunkDurationMs,
    modelChunkMs: base.modelChunkMs,
    autoDownloadModel: allowDownload,
    endpointMinSpeechMs: base.endpointMinSpeechMs,
    endpointSilenceMs: base.endpointSilenceMs,
    endpointSpeechThresholdRms: base.endpointSpeechThresholdRms,
  );
}

MobileTranslationConfig diagnosticsTranslationConfig(AppConfig config) {
  return createMobileTranslationConfig(config);
}

MobileTranslationProvider? diagnosticsTranslationProvider(AppConfig config) {
  return createDefaultMobileTranslationProvider(config);
}

String diagnosticsDisplayMessage(Object error) {
  return error.toString().replaceFirst(
        RegExp(
          r'^(Unsupported operation: |MissingPluginException\(|PlatformException\(|Exception: )',
        ),
        '',
      );
}
