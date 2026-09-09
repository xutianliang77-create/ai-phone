part of '../realtime_controller_speech_test.dart';

void registerVoiceRouteCases() {
  test(
      'local mode ignores server PCM so the original system TTS remains the sole output',
      () async {
    final repo = _FakeRealtimeRepository(), asr = _FakeMobileAsrProvider();
    final speaker = FakeSpeechOutputProvider(),
        pcm = FakePcmAudioOutputPlayer();
    final c = RealtimeController(
        repository: repo,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: asr,
        mobileTranslationProvider: _FakeTranslationProvider(),
        speechOutputProvider: speaker,
        pcmAudioOutputPlayer: pcm,
        autoSpeakTranslation: true,
        config: _config());
    await c.start();
    asr.emit(
        const AsrTextSegment(id: 'local_voice', text: 'hello', language: 'en'));
    repo.emit(const GatewayRealtimeEvent(
        type: 'audio.output',
        format: 'pcm16',
        data: 'AA==',
        sampleRate: 24000));
    await pumpEventQueue();
    expect(speaker.spoken, hasLength(1));
    expect(pcm.played, isEmpty);
    await c.stop();
    c.dispose();
  });
  test('online mode uses PCM, not local TTS, even with a stale device-ASR flag',
      () async {
    final repo = _FakeRealtimeRepository();
    final speaker = FakeSpeechOutputProvider(),
        pcm = FakePcmAudioOutputPlayer();
    final c = RealtimeController(
        repository: repo,
        audioCapture: _NoopAudioCapture(),
        mobileAsrProvider: _FakeMobileAsrProvider(),
        speechOutputProvider: speaker,
        pcmAudioOutputPlayer: pcm,
        autoSpeakTranslation: true,
        config: _config(useDeviceAsr: false).copyWith(useDeviceAsr: true));
    await c.start();
    repo.emit(const GatewayRealtimeEvent(
        type: 'translation.final',
        segmentId: 'online',
        text: '你好',
        language: 'zh'));
    repo.emit(const GatewayRealtimeEvent(
        type: 'audio.output',
        format: 'pcm16',
        data: 'AA==',
        sampleRate: 24000));
    await pumpEventQueue();
    expect(speaker.spoken, isEmpty);
    expect(pcm.played, hasLength(1));
    await c.stop();
    c.dispose();
  });
}
