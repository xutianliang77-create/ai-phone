import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';
import 'package:translation_mobile/src/shared/domain/turn_language_profile.dart';

void main() {
  late Directory tempDir;
  late File storeFile;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('local-session-store-');
    storeFile = File('${tempDir.path}/sessions.json');
  });

  tearDown(() {
    tempDir.deleteSync(recursive: true);
  });

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

    final detail = await store.getSession('local_1');
    expect(detail.segments, hasLength(1));
    expect(detail.segments.single.translatedText, '你好');
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
    expect(export.content, contains('hello'));
    expect(export.content, isNot(contains('Provider: ios_system')));

    await store.deleteSession('local_1');
    expect(await store.listSessions(), isEmpty);
  });

  test('persists action item completion across store instances', () async {
    await storeFile.writeAsString(jsonEncode(<String, Object?>{
      'sessions': <Object?>[
        <String, Object?>{
          'sessionId': 'review_1',
          'mode': 'meeting',
          'status': 'ended',
          'consumedSeconds': 60,
          'createdAt': '2026-07-15T10:00:00.000Z',
          'endedAt': '2026-07-15T10:01:00.000Z',
          'segmentCount': 1,
          'kind': 'realtime',
          'review': <String, Object?>{
            'summary': '讨论后续安排',
            'actionItems': <Object?>[
              <String, Object?>{
                'text': '发送会议纪要',
                'completed': false,
              },
            ],
          },
          'segments': <Object?>[
            <String, Object?>{
              'id': 'segment_1',
              'sourceText': '请发送会议纪要',
              'translatedText': 'Please send the meeting notes',
            },
          ],
        },
      ],
    }));

    final store = LocalSessionStore(file: storeFile);
    final updated = await store.updateActionItem('review_1', 0, true);
    expect(
      (updated.reviewJson!['actionItems'] as List<Object?>)
          .cast<Map<String, Object?>>()
          .single['completed'],
      isTrue,
    );

    final reloaded =
        await LocalSessionStore(file: storeFile).getSession('review_1');
    expect(
      (reloaded.reviewJson!['actionItems'] as List<Object?>)
          .cast<Map<String, Object?>>()
          .single['completed'],
      isTrue,
    );
  });
}
