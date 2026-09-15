import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/android_system_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/core_ml_nemotron_asr_provider.dart';
import 'package:translation_mobile/src/platform/asr/unavailable_system_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/android_on_device_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/ios_system_translation_provider.dart';

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

  test('does not create a mobile ASR provider for online mode', () {
    expect(
        createDefaultMobileAsrProvider(
            _config(deviceAsrProvider: 'coreml_nemotron', local: false)),
        isNull);
  });

  test('does not create a mobile translation provider for online mode', () {
    expect(
        createDefaultMobileTranslationProvider(
            _config(deviceAsrProvider: 'coreml_nemotron', local: false)
                .copyWith(useOnDeviceTranslation: true)),
        isNull);
  });

  test('selects Android ML Kit translation by explicit provider name', () {
    final provider = createDefaultMobileTranslationProvider(
      _config(deviceAsrProvider: 'android_system').copyWith(
        useOnDeviceTranslation: true,
        onDeviceTranslationProvider: 'android_mlkit',
      ),
    );

    expect(provider, isA<AndroidOnDeviceTranslationProvider>());
  });

  test('keeps auxiliary translation on device outside the realtime mode', () {
    final provider = createDefaultAuxiliaryMobileTranslationProvider(
      _config(deviceAsrProvider: 'coreml_nemotron', local: false),
    );

    expect(provider, isA<IosSystemTranslationProvider>());
  });
}

AppConfig _config({required String deviceAsrProvider, bool local = true}) {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: true,
    useDeviceAsr: true,
    useLocalSessions: local,
    deviceAsrProvider: deviceAsrProvider,
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: false,
  );
}
