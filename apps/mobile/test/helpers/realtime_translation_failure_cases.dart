part of '../realtime_controller_on_device_translation_test.dart';

void translationFailureCases() {
  test('preserves local source text when native translation throws', () async {
    final repository = _FakeRealtimeRepository();
    final asr = _FakeMobileAsrProvider();
    final controller = _controller(repository, asr, _FailingTranslationProvider(),
        useLocalSessions: true);
    addTearDown(controller.dispose);
    await controller.start();
    asr.emit(const AsrTextSegment(id: 'source-kept', text: 'original text',
        language: 'en', isFinal: true));
    await pumpEventQueue();
    expect(controller.segments.single.sourceText, 'original text');
    expect(controller.segments.single.translatedText, isEmpty);
    expect(repository.sentTextSegments, isEmpty);
  });
}

class _FailingTranslationProvider extends _FakeTranslationProvider {
  _FailingTranslationProvider() : super(null);
  @override
  Future<MobileTranslationResult?> translate(
      String text, MobileTranslationConfig config) async {
    throw StateError('language_pair_not_installed');
  }
}
