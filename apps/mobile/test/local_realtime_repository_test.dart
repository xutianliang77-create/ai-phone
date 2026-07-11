import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_config.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/data/local_realtime_repository.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_runtime_factories.dart';
import 'package:translation_mobile/src/platform/asr/asr_text_segment.dart';

void main() {
  test('creates local realtime sessions and saves local history', () async {
    final tempDir = Directory.systemTemp.createTempSync('local-realtime-');
    addTearDown(() => tempDir.deleteSync(recursive: true));
    final store = LocalSessionStore(
      file: File('${tempDir.path}/sessions.json'),
      now: () => DateTime.utc(2026, 6, 28, 12, 0, 5),
    );
    final repository = LocalRealtimeRepository(
      store: store,
      now: () => DateTime.utc(2026, 6, 28, 12),
    );
    addTearDown(repository.dispose);

    final session = await repository.startSession();
    expect(session.sessionId, startsWith('local_'));
    expect(repository.pause(session.sessionId), isTrue);
    expect(repository.resume(session.sessionId), isTrue);
    expect(
      repository.sendTextSegment(
        session.sessionId,
        const AsrTextSegment(id: 'asr_1', text: 'hello', language: 'en'),
      ),
      isFalse,
    );

    await repository.end(session.sessionId, const <SubtitleSegment>[
      SubtitleSegment(
        id: 'seg_1',
        sourceText: 'hello',
        translatedText: '你好',
      ),
    ]);

    final saved = await store.getSession(session.sessionId);
    expect(saved.status, 'ended');
    expect(saved.segments.single.sourceText, 'hello');
  });

  test('runtime factory uses local repository when local sessions are enabled',
      () {
    final repository = createDefaultRealtimeRepository(_localConfig());
    addTearDown(repository.dispose);

    expect(repository, isA<LocalRealtimeRepository>());
  });
}

AppConfig _localConfig() {
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
