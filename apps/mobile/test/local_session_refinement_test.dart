import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';

void main() {
  test('local history retains refinement and speech timing across disk reload and later saves', () async {
    final directory = Directory.systemTemp.createTempSync('local-refinement-test-');
    addTearDown(() => directory.deleteSync(recursive: true));
    final file = File('${directory.path}/sessions.json');
    final now = DateTime.utc(2026, 9, 8, 7);
    const metadata = <String, Object?>{
      'provider': 'local_rules',
      'operations': ['term_correction'],
      'speechTiming': {
        'status': 'finished', 'queueWaitMs': 12.5,
        'nativeRequestToStartMs': 240.0,
        'voiceIdentifier': 'test-only-voice', 'voiceLanguage': 'en-US',
      },
    };
    await LocalSessionStore(file: file, now: () => now).saveEndedSession(
      sessionId: 'first', createdAt: now.subtract(const Duration(seconds: 30)),
      segments: const [SubtitleSegment(id: 's1', sourceText: '会议纪要',
        rawText: '会议既要', optimizedText: '会议纪要', translatedText: 'Meeting minutes',
        refinement: metadata)],
    );
    final disk = jsonDecode(await file.readAsString()) as Map;
    expect(disk['sessions'][0]['segments'][0]['refinement'], metadata);
    final reopened = LocalSessionStore(file: file, now: () => now);
    expect((await reopened.getSession('first')).segments.single.refinement, metadata);
    await reopened.saveEndedSession(sessionId: 'second', createdAt: now,
      segments: const [SubtitleSegment(id: 's2', sourceText: '你好', translatedText: 'Hello')]);
    final reloaded = LocalSessionStore(file: file);
    expect((await reloaded.getSession('first')).segments.single.refinement, metadata);
    expect((await reloaded.getSession('second')).segments.single.refinement, isNull);
  });
}
