import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';
import 'package:translation_mobile/src/platform/asr/mobile_asr_provider.dart';
import 'package:translation_mobile/src/platform/translation/mobile_translation_provider.dart';

import 'helpers/fake_audio_session_coordinator.dart';
import 'helpers/fake_speech_output_provider.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('syncs speaker TTS lifecycle when diagnostic capture is off', () async {
    final asr = _TimelineAsrProvider();
    final controller = RealtimeController(
      repository: FakeRealtimeRepository(),
      audioCapture: FakeAudioCapture(),
      mobileAsrProvider: asr,
      mobileTranslationProvider: _TranslationProvider(),
      speechOutputProvider: FakeSpeechOutputProvider(),
      audioSessionCoordinator: FakeAudioSessionCoordinator(),
      autoSpeakTranslation: true,
      config: _config(),
    );
    addTearDown(controller.dispose);

    await controller.start();
    asr.emit(const AsrTextSegment(
      id: 'asr_1',
      text: 'hello',
      language: 'en',
    ));
    await pumpEventQueue();
    await controller.stop();

    final ttsEvents = asr.diagnosticEvents
        .where((event) => (event['type'] as String).startsWith('tts.'))
        .toList();
    expect(
      ttsEvents.map((event) => event['type']),
      containsAll(<String>['tts.begin', 'tts.end', 'tts.stop_requested']),
    );
    for (final event in ttsEvents) {
      final payload = event['payload']! as Map<String, Object?>;
      expect(payload['requiresAcousticEchoSuppression'], isTrue);
    }
  });
}

AppConfig _config() {
  return AppConfig(
    apiBaseUrl: Uri.parse('http://127.0.0.1:3100'),
    useMockAudio: false,
    useDeviceAsr: true,
    useLocalSessions: true,
    useOnDeviceTranslation: true,
    deviceAsrProvider: 'coreml_nemotron',
    deviceAsrLanguage: 'auto',
    deviceAsrAutoDownloadModel: false,
    deviceAsrModelChunkMs: 2240,
    serverOwnedHistory: false,
  );
}

class _TimelineAsrProvider
    implements MobileAsrProvider, MobileAsrDiagnosticTimeline {
  final _segments = StreamController<AsrTextSegment>.broadcast();
  final diagnosticEvents = <Map<String, Object?>>[];

  @override
  Stream<AsrTextSegment> get segments => _segments.stream;

  void emit(AsrTextSegment segment) => _segments.add(segment);

  @override
  Future<void> requestPermission() async {}

  @override
  Future<void> start(MobileAsrConfig config) async {}

  @override
  Future<void> stop() async {}

  @override
  Future<void> recordDiagnosticEvent(
    String type, {
    Map<String, Object?> payload = const <String, Object?>{},
  }) async {
    diagnosticEvents.add(<String, Object?>{
      'type': type,
      'payload': payload,
    });
  }

  @override
  Future<void> dispose() async => _segments.close();
}

class _TranslationProvider implements MobileTranslationProvider {
  @override
  Future<MobileTranslationResult> translate(
    String text,
    MobileTranslationConfig config,
  ) async {
    return const MobileTranslationResult(text: '你好', provider: 'fake');
  }

  @override
  Future<void> dispose() async {}
}
