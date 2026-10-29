import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/local_session_store.dart';
import 'package:translation_mobile/src/features/realtime/domain/entities/subtitle_segment.dart';

void main() {
  test(
    'local excerpts and terms survive restart and checkpoints preserve edits',
    () async {
      final dir = await Directory.systemTemp.createTemp('v10-history-repair-');
      try {
        final file = File('${dir.path}/owner.json');
        final store = LocalSessionStore(file: file);
        final when = DateTime.utc(2026, 1, 1);
        const segments = [
          SubtitleSegment(
            id: 'one',
            sourceText: '上海仓库',
            translatedText: 'Shanghai warehouse',
          ),
        ];
        await store.saveRecoverableSession(
          sessionId: 'session',
          createdAt: when,
          segments: segments,
        );
        final review = await store.generateLocalReview('session');
        expect(review.reviewJson?['source'], 'local_extractive');
        expect(review.reviewJson?['summary'], 'Shanghai warehouse');
        final term = await store.confirmLocalTerm(
          sessionId: 'session',
          sourceText: '上海仓库',
          translatedText: 'Shanghai warehouse',
          sourceLanguage: 'zh',
          targetLanguage: 'en',
        );
        expect(term.status, 'active');
        await store.saveEndedSession(
          sessionId: 'session',
          createdAt: when,
          segments: segments,
        );
        final reloaded = LocalSessionStore(file: file);
        expect(
          (await reloaded.getSession('session')).reviewJson?['source'],
          'local_extractive',
        );
        expect((await reloaded.listLocalTerms()).single.id, term.id);
        expect((await reloaded.revokeLocalTerm(term.id)).status, 'revoked');
        expect(
          (await LocalSessionStore(file: file).listLocalTerms()).single.status,
          'revoked',
        );
        expect(
          await LocalSessionStore(
            file: File('${dir.path}/other-owner.json'),
          ).listLocalTerms(),
          isEmpty,
        );
        await expectLater(
          store.confirmLocalTerm(
            sessionId: 'missing',
            sourceText: 'x',
            translatedText: 'y',
            sourceLanguage: 'en',
            targetLanguage: 'zh',
          ),
          throwsA(isA<LocalSessionNotFoundException>()),
        );
      } finally {
        await dir.delete(recursive: true);
      }
    },
  );
}
