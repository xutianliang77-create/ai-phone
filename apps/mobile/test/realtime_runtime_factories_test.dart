import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/android_system_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/unavailable_system_asr_provider.dart';

void main() {
  test('selects Core ML Nemotron ASR by default provider name', () {
    final provider = createDefaultMobileAsrProvider(
      _config(deviceAsrProvider: 'coreml_nemotron'),
    );

    expect(provider, isA<CoreMlNemotronAsrProvider>());
  });

  test('selects Android system ASR provider by explicit provider name', () {
    final provider = createDefaultMobileAsrProvider(
      _config(deviceAsrProvider: 'android_system'),
    );

    expect(provider, isA<AndroidSystemAsrProvider>());
  });

  test('selects Android system ASR provider by system alias', () {
    final provider = createDefaultMobileAsrProvider(
      _config(deviceAsrProvider: 'system'),
    );

    expect(provider, isA<AndroidSystemAsrProvider>());
  });

  test('keeps unknown ASR provider unavailable', () {
    final provider = createDefaultMobileAsrProvider(
      _config(deviceAsrProvider: 'unknown'),
    );

    expect(provider, isA<UnavailableSystemAsrProvider>());
  });
}

AppConfig _config({required String deviceAsrProvider}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: true,
    useDeviceAsr: true,
    deviceAsrProvider: deviceAsrProvider,
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: false,
  );
}
