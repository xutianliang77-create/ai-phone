import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';
import 'account_session_store.dart';
import 'account_session_events.dart';

/// No implicit migration from private 1.0 or QA file credentials. One atomic
/// Keychain item binds the selected owner and credential to deployment+origin.
class KeychainAccountSessionStore
    implements AccountSessionStore, AccountSessionGeneration {
  KeychainAccountSessionStore({
    required this.baseUrl,
    required this.deploymentId,
    MethodChannel? channel,
  }) : _channel =
           channel ?? const MethodChannel('translation_mobile/apple_account') {
    requireAccountOrigin(baseUrl, deploymentId);
  }
  final Uri baseUrl;
  final String deploymentId;
  final MethodChannel _channel;
  static final _epochs = <String, int>{};
  static final _writes = <String, Future<void>>{};
  static final _blocked = <String>{};
  String get _key => AccountRequestScope(
    deploymentId: deploymentId,
    ownerId: 'active-account',
    apiBaseUrl: baseUrl,
  ).storageKey;
  @override
  int get generation => _epochs[_key] ?? 0;
  @override
  Future<AccountSession?> load() async {
    final epoch = generation;
    if (_blocked.contains(_key)) return null;
    final raw = await _channel.invokeMethod<String>('credentialRead', {
      'key': _key,
    });
    if (raw == null || epoch != generation || _blocked.contains(_key)) {
      return null;
    }
    final s = AccountSession.fromJson(jsonDecode(raw));
    return s?.ownerId != null &&
            AccountRequestScope(
              deploymentId: deploymentId,
              ownerId: s!.ownerId!,
              apiBaseUrl: baseUrl,
            ).matches(s)
        ? s
        : null;
  }

  @override
  Future<void> save(AccountSession s) async {
    if (s.ownerId == null ||
        !AccountRequestScope(
          deploymentId: deploymentId,
          ownerId: s.ownerId!,
          apiBaseUrl: baseUrl,
        ).matches(s)) {
      throw StateError('Public credential scope mismatch');
    }
    final epoch = generation + 1;
    _epochs[_key] = epoch;
    AccountSessionEvents.changed();
    _blocked.add(_key);
    await _invalidateLicense();
    await _serialize(() async {
      if (epoch != generation) return;
      await _channel.invokeMethod<void>('credentialWrite', {
        'key': _key,
        'value': jsonEncode(s.toJson()),
      });
      if (epoch == generation) _blocked.remove(_key);
    });
  }

  @override
  Future<void> clear() async {
    _epochs[_key] = generation + 1;
    AccountSessionEvents.changed();
    _blocked.add(
      _key,
    ); // Immediately invalidate outstanding authorization work.
    await _invalidateLicense();
    await _serialize(() async {
      await _channel.invokeMethod<void>('credentialDelete', {'key': _key});
    });
  }

  Future<void> _invalidateLicense() async {
    if (!onDeviceExecution) return;
    // Failure remains blocked; never leave business processing authorized after
    // the local account generation changed.
    await const MethodChannel('translation_mobile/v10_device_license')
        .invokeMethod<void>('invalidate', {'reason': 'account_changed'});
  }

  Future<void> _serialize(Future<void> Function() action) async {
    final previous = _writes[_key] ?? Future<void>.value(),
        done = Completer<void>();
    _writes[_key] = done.future;
    await previous.catchError((Object _) {});
    try {
      await action();
    } finally {
      done.complete();
      if (identical(_writes[_key], done.future)) _writes.remove(_key);
    }
  }
}
