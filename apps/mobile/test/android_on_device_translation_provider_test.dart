import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/translation/android_on_device_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('translation_mobile/android_on_device_translation');
  late AndroidOnDeviceTranslationProvider provider;

  setUp(() {
    provider = AndroidOnDeviceTranslationProvider(channel: channel);
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('uses only a matching installed pair for availability and translation',
      () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'isAvailable') {
        expect(call.arguments, <String, Object?>{
          'sourceLanguage': 'zh',
          'targetLanguage': 'en',
        });
        return <String, Object?>{
          'available': true,
          'provider': 'android_mlkit',
          'sourceLanguage': 'zh-CN',
          'targetLanguage': 'en-US',
          'status': 'installed',
          'reason': 'ready',
        };
      }
      if (call.method == 'translate') {
        expect(call.arguments, <String, Object?>{
          'text': '你好',
          'sourceLanguage': 'zh',
          'targetLanguage': 'en',
        });
        return <String, Object?>{
          'text': 'Hello',
          'provider': 'android_mlkit',
          'sourceLanguage': 'zh',
          'targetLanguage': 'en',
        };
      }
      return null;
    });

    const config = MobileTranslationConfig(
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );
    expect((await provider.availability(config)).available, isTrue);
    expect((await provider.translate('你好', config))?.text, 'Hello');
  });

  test('only prepares models through an explicit resource request', () async {
    Object? arguments;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'prepare') arguments = call.arguments;
      return null;
    });
    await provider.prepareResources(
      const MobileTranslationConfig(sourceLanguage: 'zh', targetLanguage: 'en'),
      requestId: 'resource-1',
    );
    expect(arguments, <String, Object?>{
      'sourceLanguage': 'zh',
      'targetLanguage': 'en',
      'requestId': 'resource-1',
      'downloadAuthorized': true,
    });
  });
}
