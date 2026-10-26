import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import '../../features/account/data/account_scoped_http.dart';
import '../../features/account/data/account_session_store.dart';
import '../http/public_http_client.dart';

/// A process-local view of the native, monotonic license. Never persist a JWT
/// or reconstruct its lifetime using DateTime or the arrival of a retry.
class DeviceLicenseSnapshot {
  const DeviceLicenseSnapshot(this.data);
  final Map<String, Object?> data;
  bool get valid => data['valid'] == true;
  String get leaseId => data['leaseId'] as String? ?? '';
  int get remainingMs => (data['remainingMs'] as num?)?.toInt() ?? 0;
}

abstract interface class OnDeviceLicense {
  Stream<void> get invalidations;
  Future<DeviceLicenseSnapshot> ensureValid();
  Future<void> activity(String scope, bool active);
}

class OnDeviceLicenseClient implements OnDeviceLicense {
  OnDeviceLicenseClient({
    AccountSessionStore? store,
    http.Client? client,
    MethodChannel? channel,
    EventChannel? events,
  }) : store = store ?? defaultAccountSessionStore(),
       base = Uri.parse(configuredAccountApiBaseUrl),
       _client =
           client ??
           createPublicHttpClient(Uri.parse(configuredAccountApiBaseUrl)),
       _channel =
           channel ??
           const MethodChannel('translation_mobile/v10_device_license') {
    _subscription =
        (events ??
                const EventChannel(
                  'translation_mobile/v10_device_license/events',
                ))
            .receiveBroadcastStream()
            .listen(
              (event) {
                if (event is Map &&
                    event['valid'] == false &&
                    _scopes.isNotEmpty) {
                  _invalidations.add(null);
                }
              },
              onError: (Object _) {
                if (_scopes.isNotEmpty) _invalidations.add(null);
              },
            );
    _timer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _renewIfNeeded(),
    );
  }
  static OnDeviceLicenseClient? _shared;
  static OnDeviceLicenseClient get shared =>
      _shared ??= OnDeviceLicenseClient();
  final AccountSessionStore store;
  final Uri base;
  final http.Client _client;
  final MethodChannel _channel;
  final _invalidations = StreamController<void>.broadcast();
  final _scopes = <String>{};
  StreamSubscription<Object?>? _subscription;
  Timer? _timer;
  Future<DeviceLicenseSnapshot>? _inFlight;
  Map<String, Object?>? _pending;
  int? _pendingEpoch;
  bool _automaticRenewalFailed = false;
  @override
  Stream<void> get invalidations => _invalidations.stream;

  Future<Map<String, Object?>> native(
    String method,
    Map<String, Object?> args,
  ) async =>
      await _channel.invokeMapMethod<String, Object?>(method, args) ??
      <String, Object?>{};
  Future<Map<String, Object?>> request(
    String path, {
    Map<String, Object?>? body,
    ScopedAccountOperation? operation,
  }) async {
    final op = operation ?? await ScopedAccountOperation.capture(store);
    final response = await scopedAccountRequest(
      _client,
      store,
      base,
      body == null ? 'GET' : 'POST',
      base.resolve(path),
      body: body == null ? null : jsonEncode(body),
      operation: op,
    );
    final json = jsonDecode(response.body);
    if (json is! Map<String, Object?> || response.statusCode != 200) {
      final code = json is Map ? ((json['error'] as Map?)?['code']) : null;
      throw StateError(code is String ? code : 'device_control_unavailable');
    }
    return json;
  }

  @override
  Future<DeviceLicenseSnapshot> ensureValid() =>
      _inFlight ??= _ensure().whenComplete(() => _inFlight = null);
  Future<DeviceLicenseSnapshot> _ensure({bool renewal = false}) async {
    final op = await ScopedAccountOperation.capture(store),
        owner = op.original.ownerId!;
    if (_pending != null && _pendingEpoch != op.generation) {
      _pending = null;
    }
    var state = DeviceLicenseSnapshot(
      await native('status', {'ownerId': owner}),
    );
    await op.check();
    if (state.valid && !renewal && _pending == null) return state;
    if (_pending != null) {
      late Map<String, Object?> resolved;
      try {
        resolved = await request(
          '/v10/device/resolve',
          body: _pending,
          operation: op,
        );
      } catch (_) {
        if (state.valid && !renewal) return state;
        rethrow;
      }
      if (resolved['status'] == 'issued') {
        await op.check();
        state = DeviceLicenseSnapshot(
          await native('install', {
            'ownerId': owner,
            'license': resolved['license'],
          }),
        );
        _pending = null;
        _automaticRenewalFailed = false;
        return state;
      }
      if (!const ['cancelled', 'ended'].contains(resolved['status'])) {
        throw StateError('device_request_unresolved');
      }
      await native('abandonRequest', {'ownerId': owner});
      _pending = null;
      // Resolving an old renewal must not reset a valid native deadline.
      if (renewal) throw StateError('device_renewal_not_recovered');
      if (state.valid) {
        return DeviceLicenseSnapshot(
          await native('status', {'ownerId': owner}),
        );
      }
    }
    try {
      await flushReceipts(op);
    } catch (_) {
      await op.check();
    }
    final config = await request('/v10/device/configuration', operation: op);
    await native('anchorTime', {
      'ownerId': owner,
      'serverNowMs': config['serverNowMs'],
    });
    if (config['execution'] != 'on_device' ||
        config['licenseAdmission'] != 'configured_open' ||
        config['implementationHash'] != state.data['implementationHash'] ||
        config['deploymentId'] != configuredPublicDeploymentId) {
      throw StateError('device_license_configuration_closed');
    }
    await registerDevice(op, state.data);
    await op.check();
    final envelope = await native('request', {
      'ownerId': owner,
      'requestKey': _nonce(),
      'operation': renewal ? 'renew' : 'acquire',
      'serverNowMs': config['serverNowMs'],
    });
    _pending = envelope;
    _pendingEpoch = op.generation;
    final receipt = await request(
      '/v10/device/${renewal ? 'renew' : 'acquire'}',
      body: envelope,
      operation: op,
    );
    await op.check();
    state = DeviceLicenseSnapshot(
      await native('install', {
        'ownerId': owner,
        'license': receipt['license'],
      }),
    );
    if (!state.valid) throw StateError('device_license_invalid');
    _pending = null;
    _automaticRenewalFailed = false;
    return state;
  }

  Future<void> registerDevice(
    ScopedAccountOperation op,
    Map<String, Object?> state,
  ) async {
    final challenge = await request(
      '/v10/device/challenge',
      body: {'devicePublicKey': state['devicePublicKey']},
      operation: op,
    );
    await op.check();
    final proof = await native('registrationProof', {
      'ownerId': op.original.ownerId,
      'clientData': challenge['clientData'],
      'registered': challenge['registered'],
      'appAttestKeyId': challenge['appAttestKeyId'],
    });
    await request('/v10/device/register', body: proof, operation: op);
  }

  Future<void> flushReceipts(ScopedAccountOperation op) async {
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

  Future<void> reconcileOnline() async {
    try {
      final op = await ScopedAccountOperation.capture(store);
      try {
        await flushReceipts(op);
      } catch (_) {
        await op.check();
      }
      final result = await request('/billing/entitlement', operation: op);
      if ((result['entitlement'] as Map?)?['valid'] != true) {
        await native('invalidate', {'reason': 'subscription_ended'});
      }
    } catch (_) {
      // A network failure grants no extension; the existing native deadline
      // remains authoritative, including while returning from the background.
    }
  }

  @override
  Future<void> activity(String scope, bool active) async {
    final op = await ScopedAccountOperation.capture(store);
    await native('activity', {
      'ownerId': op.original.ownerId,
      'scope': scope,
      'active': active,
    });
    await op.check();
    active ? _scopes.add(scope) : _scopes.remove(scope);
  }

  Future<void> _renewIfNeeded() async {
    if (_scopes.isEmpty || _inFlight != null || _automaticRenewalFailed) return;
    try {
      final op = await ScopedAccountOperation.capture(store);
      final state = DeviceLicenseSnapshot(
        await native('status', {'ownerId': op.original.ownerId}),
      );
      await op.check();
      if (!state.valid) {
        _invalidations.add(null);
        return;
      }
      if (state.remainingMs > 60000) return;
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

  Future<void> dispose() async {
    _timer?.cancel();
    await _subscription?.cancel();
    _client.close();
    await _invalidations.close();
  }

  String _nonce() => List<int>.generate(
    32,
    (_) => Random.secure().nextInt(256),
  ).map((v) => v.toRadixString(16).padLeft(2, '0')).join();
}
