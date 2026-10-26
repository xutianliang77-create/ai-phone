import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/speech_backlog_policy.dart';

void main() {
  test(
    'an underestimated stalled utterance expires the pending queue without a new arrival',
    () {
      var now = 0;
      final queue = SpeechBacklogPolicy(nowMs: () => now);
      queue.begin(queue.enqueue('one', 'en')!);
      queue.enqueue('two', 'en');
      expect(queue.nextExpiryMs, 8001);
      now = 8000;
      expect(queue.pauseExpired(), isFalse);
      now = 8001;
      expect(queue.pauseExpired(), isTrue);
      expect(queue.paused, isTrue);
      expect(queue.pendingCount, 0);
    },
  );
  test(
    'one long active utterance triggers seconds limit, not a sentence count',
    () {
      var now = 0;
      final queue = SpeechBacklogPolicy(nowMs: () => now);
      final first = queue.enqueue(List.filled(30, 'word').join(' '), 'en')!;
      expect(queue.begin(first), isTrue);
      expect(queue.enqueue('next sentence', 'en'), isNull);
      expect(queue.paused, isTrue);
      expect(queue.pendingCount, 0);
      now = 14000;
      queue.finish(first, speakingMs: 12000);
      expect(queue.enqueue('never silently resume', 'en'), isNull);
      queue.resume();
      expect(queue.enqueue('explicit resume', 'en'), isNotNull);
    },
  );
  test(
    'duration underestimation cannot start audio older than eight seconds',
    () {
      var now = 0;
      final queue = SpeechBacklogPolicy(nowMs: () => now);
      final first = queue.enqueue('one', 'en')!;
      expect(queue.begin(first), isTrue);
      final second = queue.enqueue('two', 'en')!;
      now = 8001;
      queue.finish(first);
      expect(queue.begin(second), isFalse);
      expect(queue.paused, isTrue);
    },
  );
  test('late completion after stop cannot clear a new playback', () {
    var now = 0;
    final queue = SpeechBacklogPolicy(nowMs: () => now);
    final old = queue.enqueue('old', 'en')!;
    queue.begin(old);
    queue.clear();
    final next = queue.enqueue(List.filled(30, 'word').join(' '), 'en')!;
    queue.begin(next);
    queue.finish(old);
    expect(queue.estimatedWaitMs, greaterThan(8000));
    now = 20000;
    queue.finish(next);
    expect(queue.estimatedWaitMs, 0);
  });
  test(
    'natural chunks retain negations, decimal amounts and every character',
    () {
      const source = '不是取消订单，而是推迟发货。金额是 326.8 元！';
      final chunks = speechPlaybackChunks(source);
      expect(chunks.join(), source);
      expect(chunks.last, contains('326.8'));
      expect(speechPlaybackChunks('Pay 326.8 dollars. Do not cancel.'), [
        'Pay 326.8 dollars.',
        'Do not cancel.',
      ]);
    },
  );
}
