part of 'on_device_license.dart';

extension _OnDeviceLicenseRecovery on OnDeviceLicenseClient {
  Future<void> _flushReceipts(ScopedAccountOperation op) async {
    await op.check();
    while (true) {
      final previous = _receiptFlushFlight;
      if (previous == null) break;
      try {
        await previous;
      } catch (_) {
        // A later caller may retry the retained outbox for its own account.
      }
      await op.check();
    }
    final flight = _flushReceiptsOnce(op);
    _receiptFlushFlight = flight;
    try {
      await flight;
    } finally {
      if (identical(_receiptFlushFlight, flight)) _receiptFlushFlight = null;
    }
  }

  Future<void> _flushReceiptsOnce(ScopedAccountOperation op) async {
    final outbox = await native('outbox', {'ownerId': op.original.ownerId});
    for (final row in (outbox['receipts'] as List? ?? [])) {
      await op.check();
      final value = Map<String, Object?>.from(row as Map);
      final result = await request(
        '/v10/device/close',
        body: Map<String, Object?>.from(value['envelope'] as Map),
        operation: op,
      );
      if (result['status'] != 'closed' ||
          result['leaseId'] != value['leaseId'] ||
          result['sequence'] != value['sequence'] ||
          result['chargedSeconds'] != 0) {
        throw StateError('device_close_ack_binding');
      }
      await native('ackClose', {
        'ownerId': op.original.ownerId,
        'leaseId': value['leaseId'],
        'sequence': value['sequence'],
      });
    }
  }

  // The native bridge emits this only after persisting a signed receipt.
  // Failed delivery leaves the native outbox intact for foreground recovery.
  void _scheduleReceiptFlush() {
    if (_receiptFlushRunning) {
      _receiptFlushAgain = true;
      return;
    }
    _receiptFlushRunning = true;
    unawaited(() async {
      try {
        do {
          _receiptFlushAgain = false;
          try {
            final op = await ScopedAccountOperation.capture(store);
            await flushReceipts(op);
          } catch (_) {
            // Network or account changes must never discard the receipt.
            break;
          }
        } while (_receiptFlushAgain);
      } finally {
        _receiptFlushRunning = false;
      }
    }());
  }

  /// A newly verified entitlement can unblock a clipped renewal immediately.
  /// Duplicate StoreKit notifications cannot reset the attempt budget.
  Future<void> _verifiedEntitlementUpdated(
    ScopedAccountOperation op,
    Object? entitlement,
  ) async {
    if (!identical(op.store, store) ||
        entitlement is! Map ||
        entitlement['valid'] != true) {
      return;
    }
    final rawExpiry = entitlement['expiresAtMs'];
    if (rawExpiry is! num || !rawExpiry.isFinite) return;
    final expires = rawExpiry.toInt();
    if (expires <= 0) return;
    try {
      await op.check();
    } catch (_) {
      return;
    }
    final owner = op.original.ownerId;
    if (owner == null) return;
    if (_notifiedEntitlementOwner != owner) {
      _notifiedEntitlementOwner = owner;
      _notifiedEntitlementExpiry = 0;
    }
    if (expires <= _notifiedEntitlementExpiry) return;
    _notifiedEntitlementExpiry = expires;
    _automaticRenewalKey = null;
    _automaticRenewalAttempts = 0;
    _automaticRenewalFailed = false;
    unawaited(_renewIfNeeded(expectedOperation: op));
  }

  Future<void> _renewIfNeeded({
    ScopedAccountOperation? expectedOperation,
  }) async {
    if (_scopes.isEmpty || _inFlight != null || _automaticRenewalFailed) return;
    try {
      final op = await ScopedAccountOperation.capture(store);
      if (expectedOperation != null &&
          (op.generation != expectedOperation.generation ||
              op.original.ownerId != expectedOperation.original.ownerId ||
              op.original.token != expectedOperation.original.token)) {
        return;
      }
      final state = DeviceLicenseSnapshot(
        await native('status', {'ownerId': op.original.ownerId}),
      );
      await op.check();
      if (!state.valid) {
        _invalidations.add(null);
        return;
      }
      if (state.remainingMs > 60000) return;
      final deadline = (state.data['expiresAtMs'] as num?)?.toInt();
      if (state.leaseId.isEmpty || deadline == null || deadline <= 0) return;
      final key = '${op.original.ownerId}\u0000${state.leaseId}\u0000$deadline';
      if (_automaticRenewalKey != key) {
        _automaticRenewalKey = key;
        _automaticRenewalAttempts = 0;
      }
      // A subscription or QA window can clip renewal to the same deadline.
      // Try once near one minute and once in the last 15 seconds, then let
      // the native deadline stop work; never keep renewing unchanged grants.
      if (_automaticRenewalAttempts >= 2 ||
          (_automaticRenewalAttempts == 1 && state.remainingMs > 15000)) {
        return;
      }
      _automaticRenewalAttempts++;
      _inFlight = _ensure(renewal: true);
      await _inFlight;
    } catch (_) {
      // One automatic renewal attempt per period; failure preserves the old
      // cutoff. A foreground action can explicitly resolve its original nonce.
      _automaticRenewalFailed = true;
    } finally {
      _inFlight = null;
    }
  }
}
