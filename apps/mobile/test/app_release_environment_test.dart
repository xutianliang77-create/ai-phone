import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_release_environment.dart';
import 'package:translation_mobile/src/app/app_config.dart';

void main() {
  void validate(
      {String channel = 'app_store',
      String url = 'https://api.publisher.cn',
      String profile = 'core_translation',
      bool mock = false,
      bool deviceAsr = false,
      bool local = false,
      bool onDeviceTranslation = false}) {
    validateAppReleaseEnvironment(
        channel: channel,
        apiBaseUrl: Uri.parse(url),
        productProfile: profile,
        useMockAudio: mock,
        useDeviceAsr: deviceAsr,
        useLocalSessions: local,
        useOnDeviceTranslation: onDeviceTranslation);
  }

  test('restricted 1.0 keeps its existing private endpoint and full profile',
      () {
    expect(
        () => validate(
            channel: 'restricted_instance',
            url: 'http://100.110.127.117',
            profile: 'full'),
        returnsNormally);
  });
  test('formal 1.0 accepts the selected online core configuration', () {
    expect(() => validate(), returnsNormally);
  });
  for (final url in [
    'http://api.publisher.cn',
    'https://100.110.127.117',
    'https://localhost',
    'https://127.1',
    'https://2130706433',
    'https://[::1]',
    'https://api.example.cn',
    'https://api.publisher.cn?key=secret',
    'https://user:secret@api.publisher.cn'
  ]) {
    test('formal 1.0 rejects unsafe address $url', () {
      expect(() => validate(url: url), throwsStateError);
    });
  }
  test('unknown channels and accidental full capabilities fail closed', () {
    expect(() => validate(channel: 'app_stroe'), throwsStateError);
    expect(() => validate(profile: 'full'), throwsStateError);
  });
  test(
      'the formal configuration cannot silently select mock or local inference',
      () {
    expect(() => validate(mock: true), throwsStateError);
    expect(() => validate(deviceAsr: true), throwsStateError);
    expect(() => validate(local: true), throwsStateError);
    expect(() => validate(onDeviceTranslation: true), throwsStateError);
  });
  test('saved settings and copyWith cannot bypass the formal route scope', () {
    final config = AppConfig(
        apiBaseUrl: Uri.parse('https://api.publisher.cn'),
        distributionChannel: 'app_store',
        productProfile: 'core_translation',
        useMockAudio: false,
        useDeviceAsr: false,
        deviceAsrProvider: 'coreml_nemotron',
        deviceAsrLanguage: 'auto',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: true);
    expect(() => config.copyWith(useDeviceAsr: true), throwsStateError);
    expect(() => config.copyWith(targetLanguage: 'fr'), throwsStateError);
    expect(() => config.copyWith(realtimeVoiceOutputMode: 'my_voice'),
        throwsStateError);
    final online = config.copyWith(
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        realtimeVoiceOutputMode: 'natural');
    expect(online.distributionChannel, 'app_store');
    expect(online.productProfile, 'core_translation');
  });
}
