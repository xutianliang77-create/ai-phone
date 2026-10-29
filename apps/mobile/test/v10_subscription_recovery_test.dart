import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/billing/data/subscription_recovery_coordinator.dart';

void main() {
  test(
    'only an unfinished transaction triggers recovery, failed sync waits for a retry',
    () async {
      final events = StreamController<Object?>.broadcast();
      var calls = 0;
      final coordinator = SubscriptionRecoveryCoordinator(
        events: events.stream,
        recover: () async {
          calls++;
          if (calls == 1) throw StateError('fixture offline');
          return 'restored';
        },
      )..start();
      events.add({'type': 'other'});
      await Future<void>.delayed(Duration.zero);
      expect(calls, 0);
      events.add({'type': 'unfinished_transaction'});
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1); // no retry loop while offline
      coordinator.retryPending();
      await Future<void>.delayed(Duration.zero);
      expect(calls, 2);
      coordinator.retryPending();
      await Future<void>.delayed(Duration.zero);
      expect(calls, 2);
      await coordinator.dispose();
      await events.close();
    },
  );

  test(
    'updates arriving during sync are coalesced without being lost',
    () async {
      final events = StreamController<Object?>.broadcast();
      final first = Completer<String>();
      var calls = 0;
      final coordinator = SubscriptionRecoveryCoordinator(
        events: events.stream,
        recover: () {
          calls++;
          return calls == 1 ? first.future : Future.value('restored');
        },
      )..start();
      events.add({'type': 'unfinished_transaction'});
      await Future<void>.delayed(Duration.zero);
      events.add({'type': 'unfinished_transaction'});
      await Future<void>.delayed(Duration.zero);
      expect(calls, 1);
      first.complete('restored');
      await Future<void>.delayed(Duration.zero);
      expect(calls, 2);
      await coordinator.dispose();
      await events.close();
    },
  );
}
