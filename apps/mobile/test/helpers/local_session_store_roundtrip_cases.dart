part of '../local_session_store_test.dart';

void registerLocalStoreRoundtripCases() {
  test('saves, lists, exports, and deletes local sessions', () async {
    final store = LocalSessionStore(
      file: storeFile,
      now: () => DateTime.utc(2026, 6, 28, 12, 0, 10),
    );

    await store.saveEndedSession(
      sessionId: 'local_1',
      createdAt: DateTime.utc(2026, 6, 28, 12),
      segments: const <SubtitleSegment>[
        SubtitleSegment(
          id: 'seg_1',
          turnId: 'turn_1',
          revision: 2,
          sourceText: 'hello',
          rawText: 'hallo',
          optimizedText: 'hello revised',
          translatedText: '你好',
          sourceLanguage: 'en',
          targetLanguage: 'zh',
          confidence: 0.88,
          stage: 'translation',
          provider: 'ios_system',
          latencyMs: 120,
          speaker: SpeakerAttribution(
            speakerId: 'speaker_2',
            role: 'speaker',
            source: 'diarization',
          ),
          timing: SegmentTiming(
            startMs: 1000,
            endMs: 1800,
            source: 'client',
            overlap: true,
            activeSpeakerIds: <String>['speaker_1', 'speaker_2'],
          ),
          languageProfile: TurnLanguageProfile(
            dominantLanguage: 'en',
            detectedLanguages: <String>['en', 'zh'],
            mixedLanguage: true,
          ),
        ),
        SubtitleSegment(id: 'empty', sourceText: '', translatedText: ''),
      ],
    );

    final sessions = await store.listSessions(query: 'hello');
    expect(sessions.single.sessionId, 'local_1');
    expect(sessions.single.status, 'ended');
    expect(sessions.single.consumedSeconds, 10);
    expect(await store.listSessions(query: 'hallo'), hasLength(1));
    expect(await store.listSessions(query: 'revised'), hasLength(1));

    final detail = await store.getSession('local_1');
    expect(detail.segments, hasLength(1));
    expect(detail.segments.single.translatedText, '你好');
    expect(detail.segments.single.rawText, 'hallo');
    expect(detail.segments.single.optimizedText, 'hello revised');
    expect(detail.segments.single.turnId, 'turn_1');
    expect(detail.segments.single.revision, 2);
    expect(detail.segments.single.provider, 'ios_system');
    expect(detail.segments.single.confidence, 0.88);
    expect(detail.segments.single.speaker?.speakerId, 'speaker_2');
    expect(detail.segments.single.timing?.overlap, isTrue);
    expect(
      detail.segments.single.timing?.activeSpeakerIds,
      <String>['speaker_1', 'speaker_2'],
    );
    expect(detail.segments.single.languageProfile?.dominantLanguage, 'en');
    expect(detail.segments.single.languageProfile?.mixedLanguage, isTrue);

    final export = await store.exportSession('local_1');
    expect(export.filename, 'translation-session-local_1.md');
    expect(export.content, contains('hallo'));
    expect(export.content, contains('hello'));
    expect(export.content, contains('hello revised'));
    expect(export.content, isNot(contains('Provider: ios_system')));

    await store.deleteSession('local_1');
    expect(await store.listSessions(), isEmpty);
  });
}
