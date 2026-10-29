import 'dart:convert';
import 'dart:math';
import 'package:flutter/services.dart';
import '../../account/data/account_scoped_http.dart';
import '../../../platform/license/on_device_license.dart';
import '../../../platform/diagnostics/subscription_load_diagnostics.dart';

class OnDeviceSubscriptionClient {
  OnDeviceSubscriptionClient({
    OnDeviceLicenseClient? control,
    MethodChannel? channel,
    SubscriptionLoadObserver? diagnosticObserver,
    Duration storeKitTimeout = const Duration(seconds: 12),
  }) : control = control ?? OnDeviceLicenseClient.shared,
       channel =
           channel ??
           const MethodChannel('translation_mobile/v10_subscription'),
       _diagnosticObserver = diagnosticObserver ?? recordSubscriptionLoadEvent,
       _storeKitTimeout = storeKitTimeout;
  final OnDeviceLicenseClient control;
  final MethodChannel channel;
  final SubscriptionLoadObserver _diagnosticObserver;
  final Duration _storeKitTimeout;
  static final _storeKitLoads = <String, _StoreKitFlight>{};
  static final _syncs = <String, Future<String>>{};
  static Future<Map<String, Object?>?>? _offerDiagnosticFlight;

  String _scopeKey(ScopedAccountOperation op) =>
      jsonEncode([channel.name, op.original.deploymentId, op.original.issuerOrigin, op.original.ownerId]);

  Future<Map<String, Object?>?> _loadProduct(ScopedAccountOperation op, String token, String requestId) {
    if (_offerDiagnosticFlight != null) {
      return Future.error(StateError('subscription_diagnostic_in_progress'));
    }
    final owner = op.original.ownerId!;
    final key = jsonEncode([_scopeKey(op), token]);
    var flight = _storeKitLoads[key];
    if (flight == null) {
      final future = channel.invokeMapMethod<String, Object?>('load', {
        'ownerId': owner,
        'appAccountToken': token,
        'diagnosticId': requestId,
      });
      flight = _StoreKitFlight(future, requestId);
      final started = flight;
      _storeKitLoads[key] = flight;
      // A timeout does not cancel the underlying StoreKit call. Keep sharing
      // that call until it actually completes instead of multiplying retries.
      future.then<void>((_) {
        if (identical(_storeKitLoads[key], started)) _storeKitLoads.remove(key);
      }, onError: (Object _, StackTrace __) {
        if (identical(_storeKitLoads[key], started)) _storeKitLoads.remove(key);
      });
    }
    return flight.future.timeout(_storeKitTimeout);
  }

  String _requestId() {
    final random = Random.secure();
    return List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
  Future<Map<String, Object?>> load() async {
    final attempt = nextSubscriptionLoadAttempt();
    final requestId = _requestId();
    String? nativeRequestId;
    final watch = Stopwatch()..start();
    var stage = 'scope';
    void emit(String outcome, [Object? error]) {
      try {
        _diagnosticObserver(
          makeSubscriptionLoadEvent(
            attempt: attempt,
            stage: stage,
            outcome: outcome,
            durationMs: watch.elapsedMilliseconds,
            error: error,
            requestId: requestId,
            nativeRequestId: nativeRequestId,
          ),
        );
      } catch (_) {
        // Diagnostics must never change the product result.
      }
    }

    emit('started');
    try {
      final op = await ScopedAccountOperation.capture(control.store);
      emit('completed');
      stage = 'entitlement';
      emit('started');
      final e = await control.request('/billing/entitlement', operation: op);
      emit('completed');
      final token = e['appAccountToken'];
      if (token is! String || !RegExp(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$').hasMatch(token)) {
        throw StateError('subscription_account_unavailable');
      }
      nativeRequestId = _storeKitLoads[jsonEncode([_scopeKey(op), token])]?.requestId ?? requestId;
      stage = 'storekit';
      emit('started');
      final product = await _loadProduct(op, token, nativeRequestId);
      emit('completed');
      stage = 'scope_recheck';
      emit('started');
      await op.check();
      emit('completed');
      stage = 'validation';
      emit('started');
      if (product?['productId'] != (e['entitlement'] as Map?)?['productId'] ||
          product?['validated'] != true ||
          product?['priceMinorCny'] != 1000 ||
          product?['currency'] != 'CNY' ||
          product?['period'] != 'P1M' ||
          product?['trialDays'] != 7) {
        throw StateError('subscription_product_mismatch');
      }
      emit('completed');
      stage = 'complete';
      emit('completed');
      return {...e, 'product': product};
    } catch (error) {
      emit('failed', error);
      rethrow;
    }
  }

  /// QA-only product metadata. This is intentionally independent of the
  /// entitlement server and never changes the purchase or authorization flow.
  Future<void> diagnoseStoreOffer() async {
    if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') {
      throw StateError('subscription_diagnostic_unavailable');
    }
    final op = await ScopedAccountOperation.capture(control.store);
    if (_offerDiagnosticFlight != null || _storeKitLoads.isNotEmpty) {
      throw StateError('subscription_diagnostic_in_progress');
    }
    final future = channel.invokeMapMethod<String, Object?>('diagnoseOffer', {
      'ownerId': op.original.ownerId!,
      'diagnosticId': _requestId(),
    });
    _offerDiagnosticFlight = future;
    future.then<void>((_) {
      if (identical(_offerDiagnosticFlight, future)) _offerDiagnosticFlight = null;
    }, onError: (Object _, StackTrace __) {
      if (identical(_offerDiagnosticFlight, future)) _offerDiagnosticFlight = null;
    });
    await future.timeout(_storeKitTimeout);
    await op.check();
  }

  Future<String> purchase({
    required bool trialEligible,
    required bool consent,
  }) {
    if (!consent) {
      return Future.error(ArgumentError('subscription_consent_required'));
    }
    return _sync('purchase', {
      'trialEligible': trialEligible,
      'consentConfirmed': consent,
    });
  }

  Future<String> restore() => _sync('restore', {'userInitiated': true});
  Future<void> manage() async {
    final op = await ScopedAccountOperation.capture(control.store);
    await channel.invokeMethod<void>('manage', {
      'ownerId': op.original.ownerId,
    });
  }

  Future<String> recoverPending() => _sync('pending', {});
  Future<String> clearPendingApproval({required bool userConfirmedDecline}) async {
    if (!userConfirmedDecline) throw ArgumentError('subscription_confirmation_required');
    await recoverPending();
    final op = await ScopedAccountOperation.capture(control.store);
    final e = await control.request('/billing/entitlement', operation: op);
    if ((e['entitlement'] as Map?)?['valid'] == true) throw StateError('subscription_already_active');
    final token = e['appAccountToken'];
    if (token is! String || !RegExp(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$').hasMatch(token)) {
      throw StateError('subscription_account_unavailable');
    }
    await op.check();
    final result = await channel.invokeMapMethod<String,Object?>('clearPendingApproval', {
      'ownerId': op.original.ownerId, 'appAccountToken': token, 'userConfirmedDecline': true,
    });
    await op.check();
    return result?['status'] as String? ?? 'unknown';
  }
  Future<String> _sync(String method, Map<String, Object?> arguments) async {
    final op = await ScopedAccountOperation.capture(control.store);
    final key = _scopeKey(op);
    final existing = _syncs[key];
    if (existing != null) {
      // An update can arrive while a user-initiated purchase is being
      // recorded. Share its result; never run finish twice concurrently.
      if (method == 'pending') return existing;
      throw StateError('subscription_busy');
    }
    final flight = _syncCaptured(method, arguments, op);
    _syncs[key] = flight;
    try { return await flight; }
    finally { if (identical(_syncs[key], flight)) _syncs.remove(key); }
  }

  Future<String> _syncCaptured(String method, Map<String, Object?> arguments,
      ScopedAccountOperation op) async {
    final owner = op.original.ownerId!;
    final state = await control.native('readiness', {'ownerId': owner});
    await control.registerDevice(op, state);
    final e = await control.request('/billing/entitlement', operation: op);
    final config = await control.request(
      '/v10/device/configuration',
      operation: op,
    );
    await control.native('anchorTime', {
      'ownerId': owner,
      'serverNowMs': config['serverNowMs'],
    });
    if (method == 'purchase' &&
        config['licenseAdmission'] != 'configured_open') {
      throw StateError('subscription_admission_closed');
    }
    if (method == 'purchase') {
      final token = e['appAccountToken'];
      if (token is! String || !RegExp(r'^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$').hasMatch(token)) {
        throw StateError('subscription_account_unavailable');
      }
      final product = await _loadProduct(op, token, _requestId());
      if (product?['validated'] != true ||
          product?['productId'] != (e['entitlement'] as Map?)?['productId']) {
        throw StateError('subscription_product_mismatch');
      }
    }
    await op.check();
    // Restore/sync never grants access itself. Only a verified server receipt
    // changes entitlement. No trial is invented from installation time.
    final result = await channel.invokeMapMethod<String, Object?>(method, {
      ...arguments,
      'ownerId': owner,
      'serverNowMs': config['serverNowMs'],
      'appAccountToken': e['appAccountToken'],
    });
    await op.check();
    for (final raw in (result?['proofs'] as List? ?? [])) {
      final proof = Map<String, Object?>.from(raw as Map);
      final receipt = await control.request(
        '/billing/subscription/sync',
        body: Map<String, Object?>.from(proof['envelope'] as Map),
        operation: op,
      );
      await op.check();
      if (receipt['status'] != 'recorded' ||
          receipt['transactionId'] != proof['transactionId']) {
        throw StateError('subscription_ack_binding');
      }
      await channel.invokeMethod<void>('finish', {
        'ownerId': owner,
        'transactionId': proof['transactionId'],
        'acknowledgedTransactionId': receipt['transactionId'],
        'appAccountToken': e['appAccountToken'],
        'restoreAcknowledged': receipt['restoreAcknowledged'] == true,
      });
      await control.verifiedEntitlementUpdated(op, receipt['entitlement']);
    }
    return result?['status'] as String? ?? 'unknown';
  }
}

class _StoreKitFlight {
  const _StoreKitFlight(this.future, this.requestId);
  final Future<Map<String, Object?>?> future;
  final String requestId;
}
