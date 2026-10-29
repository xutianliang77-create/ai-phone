import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_repository.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_runtime_settings.dart';
import 'package:translation_mobile/src/features/realtime/data/realtime_settings_store.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/features/scan/domain/scan_translation_integrity.dart';
import 'package:translation_mobile/src/features/scan/presentation/controllers/scan_translation_controller.dart';
import 'package:translation_mobile/src/platform/ocr/mobile_ocr_provider.dart';
import 'package:translation_mobile/src/platform/sharing/file_share_service.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/speech/system_voice_preferences.dart';
import 'package:translation_mobile/src/platform/translation/language_capability_probe.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';
import 'package:translation_mobile/src/platform/translation/supported_translation_language.dart';
import 'package:translation_mobile/src/app/app_config.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('restoration-test-'));
  tearDown(() async {
    for (final channel in [
      'fixture/voice',
      'translation_mobile/ocr',
      'translation_mobile/apple_speech_asr',
      'translation_mobile/on_device_translation',
      'translation_mobile/speech_output',
    ]) {
      messenger.setMockMethodCallHandler(MethodChannel(channel), null);
    }
    await dir.delete(recursive: true);
  });

  test(
    'legacy unsupported preferences are read without changing original bytes',
    () async {
      final legacy = File('${dir.path}/realtime_settings.json');
      const original =
          '{"processingMode":"onDevice","sourceLanguage":"fr","targetLanguage":"ja","voiceOutputMode":"my_voice","voicePresetId":"old_voice"}';
      await legacy.writeAsString(original);
      final store = FileRealtimeSettingsStore(
        directory: () async => dir,
        useVersionedFile: true,
      );
      final before = await store.load();
      expect(before!.sourceLanguage, 'fr');
      expect(before.targetLanguage, 'ja');
      expect(before.voicePresetId, 'old_voice');
      await store.save(
        before.copyWith(
          sourceLanguage: 'zh',
          targetLanguage: 'en',
          voiceOutputMode: RealtimeVoiceOutputMode.natural,
        ),
      );
      expect(await legacy.readAsString(), original);
      expect((await store.load())!.sourceLanguage, 'zh');
      expect(
        await File('${dir.path}/realtime_settings_on_device_v1.json').exists(),
        true,
      );
    },
  );

  test(
    'per-language voices persist and are forwarded; unavailable selection is not replaced',
    () async {
      final preferences = SystemVoicePreferences(directory: () async => dir);
      await Future.wait([
        preferences.select('zh', 'com.apple.voice.zh'),
        preferences.select('en', 'com.apple.voice.en'),
      ]);
      final reopened = SystemVoicePreferences(directory: () async => dir);
      expect(await reopened.selected('zh'), 'com.apple.voice.zh');
      expect(await reopened.selected('en'), 'com.apple.voice.en');
      final calls = <Map>[];
      const channel = MethodChannel('fixture/voice');
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(Map.from(call.arguments as Map));
        if (call.method == 'speak') {
          if ((call.arguments as Map)['voiceIdentifier'] ==
              'com.apple.voice.en') {
            throw PlatformException(code: 'speech_voice_unavailable');
          }
          return {'provider': 'fixture', 'language': 'zh'};
        }
        return {'canSpeak': true, 'availableOnDevice': true};
      });
      final provider = SystemSpeechOutputProvider(
        channel: channel,
        preferences: reopened,
        useVoicePreferences: true,
      );
      await provider.prepareVoice('zh');
      await provider.speak(text: '你好', language: 'zh');
      await expectLater(
        provider.speak(text: 'hello', language: 'en'),
        throwsA(
          isA<PlatformException>().having(
            (e) => e.code,
            'code',
            'speech_voice_unavailable',
          ),
        ),
      );
      expect(calls.map((c) => c['voiceIdentifier']), [
        'com.apple.voice.zh',
        'com.apple.voice.zh',
        'com.apple.voice.en',
      ]);
      expect(await reopened.selected('en'), 'com.apple.voice.en');
    },
  );

  test('malformed voice preference file is not overwritten', () async {
    final file = File('${dir.path}/system_voice_selections_v1.json');
    await file.writeAsString('{broken');
    final preferences = SystemVoicePreferences(directory: () async => dir);
    await expectLater(
      preferences.select('zh', 'com.apple.voice.zh'),
      throwsFormatException,
    );
    expect(await file.readAsString(), '{broken');
  });

  test(
    'uncertain image language asks for choice and original text remains',
    () async {
      final translator = _Translator('Tomorrow afternoon');
      final c = _controller(
        _Ocr('明天下午'),
        translator,
        detect: (_) async => null,
      );
      addTearDown(c.dispose);
      await c.selectImage(ScanImageSource.gallery);
      await c.recognizeSelectedImage();
      await c.translateRecognizedText();
      expect(c.message, 'scan_language_uncertain');
      expect(c.recognizedText, '明天下午');
      expect(c.translatedText, isEmpty);
      expect(translator.calls, 0);
      c.setSourceLanguage('zh');
      await c.translateRecognizedText();
      expect(c.translatedText, 'Tomorrow afternoon');
    },
  );

  test(
    'late image result is rejected when the original license ended',
    () async {
      final ocr = _Ocr('订单');
      final c = _controller(
        ocr,
        _Translator('order'),
        detect: (_) async => 'zh',
        start: () async => 'lease-1',
        verify: (_) async => throw StateError('authorization_required'),
      );
      addTearDown(c.dispose);
      await c.selectImage(ScanImageSource.gallery);
      await c.recognizeSelectedImage();
      expect(c.imagePath, '/synthetic.jpg');
      expect(c.recognizedText, isEmpty);
      expect(c.message, contains('授权'));
    },
  );

  test('late translation is rejected even if it needs no translator', () async {
    var valid = true;
    final c = _controller(
      _Ocr('CE'),
      _Translator('unused'),
      detect: (_) async => null,
      start: () async => 'lease-1',
      verify: (_) async {
        if (!valid) throw StateError('authorization_required');
      },
    );
    addTearDown(c.dispose);
    await c.selectImage(ScanImageSource.gallery);
    await c.recognizeSelectedImage();
    valid = false;
    await c.translateRecognizedText();
    expect(c.recognizedText, 'CE');
    expect(c.translatedText, isEmpty);
    expect(c.message, contains('授权'));
  });

  test(
    'disposing a pending scan prevents its late result from being published',
    () async {
      final ocr = _PendingOcr();
      final c = _controller(
        ocr,
        _Translator('unused'),
        detect: (_) async => 'zh',
      );
      await c.selectImage(ScanImageSource.gallery);
      final pending = c.recognizeSelectedImage();
      await Future<void>.delayed(Duration.zero);
      c.dispose();
      ocr.pending.complete(
        const MobileOcrResult(text: '迟到结果', provider: 'fixture'),
      );
      await pending;
      expect(c.recognizedText, isEmpty);
    },
  );

  test('an empty retry does not discard a completed scan and translation', () async {
    final c = _controller(_OcrSequence(), _Translator('Hello'), detect: (_) async => 'zh');
    addTearDown(c.dispose);
    await c.selectImage(ScanImageSource.gallery);
    await c.recognizeSelectedImage();
    await c.translateRecognizedText();
    expect(c.translatedText, 'Hello');
    await c.recognizeSelectedImage();
    expect(c.message, 'scan_no_text');
    expect(c.recognizedText, '你好');
    expect(c.translatedText, 'Hello');
    expect(c.imagePath, '/synthetic.jpg');
  });

  test('critical number or explicit negation changes fail the scan check', () {
    bool ok(String a, String b) => scanTranslationIntegrity(
      a,
      b,
      sourceLanguage: 'zh',
      targetLanguage: 'en',
    );
    expect(ok('不是取消 A120 订单', 'Do not cancel A120'), true);
    expect(ok('不是取消 A120 订单', 'Cancel A120'), false);
    expect(ok('订单 947 件', 'Order 497 items'), false);
    expect(ok('订单 947 件', 'Order 947 items 2'), false);
  });

  test(
    'capability inventory uses only local read methods and never asserts quality',
    () async {
      final invoked = <String>[];
      for (final channel in [
        'translation_mobile/ocr',
        'translation_mobile/apple_speech_asr',
        'translation_mobile/on_device_translation',
        'translation_mobile/speech_output',
      ]) {
        messenger.setMockMethodCallHandler(MethodChannel(channel), (
          call,
        ) async {
          invoked.add('$channel:${call.method}');
          if (call.method == 'supportedLanguages') return ['zh-Hans', 'en-US'];
          if (call.method == 'voices') {
            return [
              {'identifier': 'com.apple.voice.en'},
            ];
          }
          if (channel.endsWith('apple_speech_asr')) {
            return {'locale': 'en-US', 'resourcesInstalled': true};
          }
          return {'available': true, 'status': 'installed'};
        });
      }
      final result = await const LanguageCapabilityProbe().inspect('en');
      expect(supportedHyMtLanguages, hasLength(38));
      expect(result, hasLength(5));
      expect(result.values.every((v) => v.contains('待验收')), true);
      expect(invoked, hasLength(5));
      expect(
        invoked.every(
          (call) =>
              call.endsWith(':isAvailable') ||
              call.endsWith(':voices') ||
              call.endsWith(':supportedLanguages'),
        ),
        true,
      );
    },
  );

  test('the selected pair flows to both translation preflight directions', () {
    final settings = RealtimeRuntimeSettings.fromJson({
      'processingMode': 'onDevice',
      'sourceLanguage': 'auto',
      'targetLanguage': 'auto_reverse',
      'automaticPairA': 'en',
      'automaticPairB': 'zh',
    });
    final config = settings.applyTo(
      AppConfig(
        apiBaseUrl: Uri.parse('https://example.test'),
        useMockAudio: false,
        useDeviceAsr: true,
        deviceAsrProvider: 'apple_speech_transcriber',
        deviceAsrLanguage: 'auto',
        deviceAsrAutoDownloadModel: false,
        deviceAsrModelChunkMs: 2240,
        serverOwnedHistory: false,
      ),
    );
    final preflight = createOnDeviceTranslationPreflightConfigs(config);
    expect(preflight.map((p) => '${p.sourceLanguage}->${p.targetLanguage}'), [
      'en->zh',
      'zh->en',
    ]);
    expect(createDeviceAsrConfig(config).automaticPair, ['en', 'zh']);
    expect(jsonDecode(jsonEncode(settings.toJson()))['automaticPairA'], 'en');
  });
}

ScanTranslationController _controller(
  MobileOcrProvider ocr,
  MobileTranslationProvider translator, {
  required Future<String?> Function(String) detect,
  Future<String> Function()? start,
  Future<void> Function(String)? verify,
}) => ScanTranslationController(
  ocrProvider: ocr,
  translationProvider: translator,
  detectLanguage: detect,
  startAuthorization: start,
  verifyAuthorization: verify,
  pickImagePath: (_) async => PickedScanImage(
    path: '/synthetic.jpg',
    previewBytes: Uint8List.fromList([1]),
  ),
  historyRepository: SessionHistoryRepository(shareService: _Share()),
);

class _Ocr implements MobileOcrProvider {
  _Ocr(this.text);
  final String text;
  @override
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) async => MobileOcrResult(text: text, provider: 'fixture');
  @override
  Future<void> dispose() async {}
}

class _OcrSequence implements MobileOcrProvider {
  int calls = 0;
  @override
  Future<MobileOcrResult?> recognizeImage(String imagePath, {List<String>? preferredScripts}) async =>
      MobileOcrResult(text: calls++ == 0 ? '你好' : '', provider: 'fixture');
  @override
  Future<void> dispose() async {}
}

class _PendingOcr implements MobileOcrProvider {
  final pending = Completer<MobileOcrResult?>();
  @override
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  }) => pending.future;
  @override
  Future<void> dispose() async {}
}

class _Translator implements MobileTranslationProvider {
  _Translator(this.text);
  final String text;
  int calls = 0;
  @override
  Future<MobileTranslationResult?> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    calls++;
    return MobileTranslationResult(text: this.text, provider: 'fixture');
  }

  @override
  Future<void> dispose() async {}
}

class _Share implements FileShareService {
  @override
  Future<String> saveExportFile(List<int> bytes, String filename) async =>
      filename;
  @override
  Future<void> shareFile(String path, {String? mimeType}) async {}
}
