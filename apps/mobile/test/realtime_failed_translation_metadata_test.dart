import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/segment_draft.dart';
import 'helpers/realtime_controller_test_helpers.dart';

void main() {
  test('clearing stale translation preserves only explicitly replaced metadata', () {
    const old = SegmentDraft('s', translatedText: 'old', targetLanguage: 'zh',
        provider: 'old', model: 'old-model', latencyMs: 12);
    final failed = old.copyWith(clearTranslation: true, targetLanguage: 'en', provider: 'qwen');
    expect(failed.translatedText, isEmpty);
    expect(failed.targetLanguage, 'en');
    expect(failed.provider, 'qwen');
    expect(failed.model, isNull);
    expect(failed.latencyMs, isNull);
    final revised = old.copyWith(sourceText: 'new', clearTranslation: true);
    expect(revised.targetLanguage, isNull);
    expect(revised.provider, isNull);
  });

  test('unknown source failure retains direction and ignores an older failure', () async {
    final repository = FakeRealtimeRepository();
    final controller = realtimeControllerForTest(repository, FakeAudioCapture());
    addTearDown(controller.dispose);
    await controller.start();
    void emit(String type, int revision, {String? text, String? language}) =>
        repository.emit(GatewayRealtimeEvent(type: type, sessionId: 'sess_1',
            segmentId: 'unknown', revision: revision, text: text, language: language,
            provider: type == 'translation.failed' ? 'qwen' : null));
    emit('transcript.final', 1, text: '你叫什么名字？', language: 'auto');
    emit('translation.failed', 1, language: 'en');
    await pumpEventQueue();
    expect(controller.segments.single.targetLanguage, 'en');
    expect(controller.segments.single.sourceLanguage, 'auto');
    expect(controller.segments.single.translatedText, isEmpty);
    emit('transcript.final', 2, text: 'What is your name?', language: 'en');
    emit('translation.final', 2, text: '你叫什么名字？', language: 'zh');
    emit('translation.failed', 1, language: 'en');
    await pumpEventQueue();
    expect(controller.segments.single.targetLanguage, 'zh');
    expect(controller.segments.single.translatedText, '你叫什么名字？');
    expect(controller.segments.single.revision, 2);
  });
}
