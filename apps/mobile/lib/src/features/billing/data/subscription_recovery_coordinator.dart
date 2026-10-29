import 'dart:async';
import 'package:flutter/services.dart';
import 'on_device_subscription_client.dart';

/// Syncs only a StoreKit transaction that already exists. It never calls
/// purchase, and a failed/unknown result remains unfinished for a later retry.
class SubscriptionRecoveryCoordinator {
  SubscriptionRecoveryCoordinator({
    Stream<Object?>? events,
    Future<String> Function()? recover,
  }) : _events =
           events ??
           const EventChannel(
             'translation_mobile/v10_subscription/events',
           ).receiveBroadcastStream(),
       _recover = recover ?? OnDeviceSubscriptionClient().recoverPending;
  final Stream<Object?> _events;
  final Future<String> Function() _recover;
  StreamSubscription<Object?>? _subscription;
  bool _pending = false, _running = false, _disposed = false;
  int _revision = 0;

  void start() {
    _subscription ??= _events.listen(
      (event) {
        if (event is! Map || event['type'] != 'unfinished_transaction') return;
        _pending = true;
        _revision++;
        _schedule();
      },
      onError: (Object _) {
        /* StoreKit remains the source of unfinished transactions. */
      },
    );
  }

  // Account changes or foregrounding provide a bounded retry opportunity.
  void retryPending() => _schedule();

  void _schedule() {
    if (!_pending || _running || _disposed) return;
    _running = true;
    final revision = _revision;
    unawaited(() async {
      var succeeded = false;
      try {
        await _recover();
        succeeded = true;
      } catch (_) {
        // Retain the pending flag. Do not finish or purchase automatically.
      } finally {
        _running = false;
        if (!_disposed) {
          if (succeeded && revision == _revision) _pending = false;
          if (succeeded && revision != _revision) _schedule();
        }
      }
    }());
  }

  Future<void> dispose() async {
    _disposed = true;
    await _subscription?.cancel();
  }
}
