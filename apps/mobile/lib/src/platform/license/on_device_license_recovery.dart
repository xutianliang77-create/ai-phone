part of 'on_device_license.dart';

extension _OnDeviceLicenseRecovery on OnDeviceLicenseClient {
  Future<void> _flushReceipts(ScopedAccountOperation op) async {
    if (controlDiagnosticReadOnly) {
      throw StateError('control_diagnostic_read_only');
    }
    await op.check();
    while (true) {
      final previous = _receiptFlushFlight;
      if (previous == null) {
        final flight = _flushReceiptsOnce(op);
        _receiptFlushFlight = flight;
        _receiptFlushOperation = op;
        try {
          await flight;
        } finally {
          if (identical(_receiptFlushFlight, flight)) {
            _receiptFlushFlight = null;
            _receiptFlushOperation = null;
          }
        }
        return;
      }
      final running = _receiptFlushOperation;
      final sameAccount =
          running != null &&
          identical(running.store, op.store) &&
          running.generation == op.generation &&
          running.original.ownerId == op.original.ownerId &&
          running.original.token == op.original.token;
      try {
        await previous;
      } catch (error, stack) {
        await op.check();
        if (sameAccount) Error.throwWithStackTrace(error, stack);
      }
      await op.check();
      // A same-account waiter shares the outcome, including failures. It may
      // not silently replay the same receipt as part of the same signal.
      if (sameAccount) return;
    }
  }

  Future<void> _flushReceiptsOnce(ScopedAccountOperation op) async {
    final outbox = await native('outbox', {'ownerId': op.original.ownerId});
    final blocked = <String>{};
    Object? firstConflict;
    StackTrace? firstConflictStack;
    for (final row in (outbox['receipts'] as List? ?? [])) {
      await op.check();
      final value = Map<String, Object?>.from(row as Map);
      final leaseId = value['leaseId'];
      if (leaseId is! String || leaseId.isEmpty) {
        throw StateError('device_receipt_binding');
      }
      if (blocked.contains(leaseId)) continue;
      late final Map<String, Object?> result;
      try {
        result = await request(
          '/v10/device/close',
          body: Map<String, Object?>.from(value['envelope'] as Map),
          operation: op,
        );
      } on _DeviceControlResponseError catch (error, stack) {
        const isolatedConflicts = {
          'v10_license_close_binding',
          'v10_device_statistics_invalid',
          'v10_device_proof',
          'v10_invalid_fields',
          'v10_invalid_identifier',
          'v10_invalid_integer',
          'd1_idempotency_conflict',
        };
        if (error.statusCode != 409 ||
            !isolatedConflicts.contains(error.message)) {
          rethrow;
        }
        // Preserve order within one lease; an unrelated lease may still send
        // its own original receipt. A conflict never acknowledges the row.
        blocked.add(leaseId);
        firstConflict ??= error;
        firstConflictStack ??= stack;
        continue;
      }
      if (result['status'] != 'closed' ||
          result['leaseId'] != value['leaseId'] ||
          result['sequence'] != value['sequence'] ||
          result['chargedSeconds'] != 0) {
        throw StateError('device_close_ack_binding');
      }
      await op.check();
      await native('ackClose', {
        'ownerId': op.original.ownerId,
        'leaseId': value['leaseId'],
        'sequence': value['sequence'],
      });
    }
    if (firstConflict != null) {
      Error.throwWithStackTrace(firstConflict, firstConflictStack!);
    }
  }

  // The native bridge emits this only after persisting a signed receipt.
  // Failed delivery leaves the native outbox intact for foreground recovery.
  void _scheduleReceiptFlush({ScopedAccountOperation? expectedOperation}) {
    if (controlDiagnosticReadOnly) return;
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
            final op =
                expectedOperation ??
                await ScopedAccountOperation.capture(store);
            await op.check();
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
