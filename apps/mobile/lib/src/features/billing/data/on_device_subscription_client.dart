import 'package:flutter/services.dart';
import '../../account/data/account_scoped_http.dart';
import '../../../platform/license/on_device_license.dart';

class OnDeviceSubscriptionClient {
  OnDeviceSubscriptionClient({
    OnDeviceLicenseClient? control,
    MethodChannel? channel,
  }) : control = control ?? OnDeviceLicenseClient.shared,
       channel =
           channel ??
           const MethodChannel('translation_mobile/v10_subscription');
  final OnDeviceLicenseClient control;
  final MethodChannel channel;
  Future<Map<String, Object?>> load() async {
    final op = await ScopedAccountOperation.capture(control.store);
    final e = await control.request('/billing/entitlement', operation: op);
    final product = await channel.invokeMapMethod<String, Object?>('load', {
      'ownerId': op.original.ownerId,
    });
    await op.check();
    if (product?['productId'] != (e['entitlement'] as Map?)?['productId'] ||
        product?['validated'] != true ||
        product?['priceMinorCny'] != 1000 ||
        product?['currency'] != 'CNY' ||
        product?['period'] != 'P1M' ||
        product?['trialDays'] != 7) {
      throw StateError('subscription_product_mismatch');
    }
    return {...e, 'product': product};
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
  Future<String> _sync(String method, Map<String, Object?> arguments) async {
    final op = await ScopedAccountOperation.capture(control.store),
        owner = op.original.ownerId!;
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
    if (method == 'purchase' && config['licenseAdmission'] != 'configured_open') {
      throw StateError('subscription_admission_closed');
    }
    if (method == 'purchase') {
      final product = await channel.invokeMapMethod<String, Object?>('load', {
        'ownerId': owner,
      });
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
      });
    }
    return result?['status'] as String? ?? 'unknown';
  }
}
