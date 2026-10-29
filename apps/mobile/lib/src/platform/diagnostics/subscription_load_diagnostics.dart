import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

typedef SubscriptionLoadObserver = void Function(Map<String, Object?> event);

const _stages = {
  'scope',
  'entitlement',
  'storekit',
  'scope_recheck',
  'validation',
  'complete',
};
const _outcomes = {'started', 'completed', 'failed'};
const _platformCodes = {
  'subscription_product_mismatch',
  'subscription_trial_not_configured',
  'subscription_unavailable',
  'storekit_unavailable',
  'device_account_required',
  'storekit_network_error',
  'storekit_system_error',
  'storekit_storefront_unavailable',
  'storekit_not_entitled',
  'storekit_cancelled',
  'storekit_unsupported',
  'storekit_other',
};

int _nextAttempt = 0;
int nextSubscriptionLoadAttempt() => ++_nextAttempt;

Map<String, Object?> makeSubscriptionLoadEvent({
  required int attempt,
  required String stage,
  required String outcome,
  required int durationMs,
  Object? error,
  String? requestId,
  String? nativeRequestId,
}) {
  var code = 'none';
  if (error is PlatformException) {
    code = _platformCodes.contains(error.code)
        ? error.code
        : 'other_platform_error';
  } else if (error is TimeoutException) {
    code = 'timeout';
  } else if (error is StateError &&
      error.message == 'subscription_product_mismatch') {
    code = 'subscription_product_mismatch';
  } else if (error != null) {
    code = 'other_error';
  }
  return {
    'attempt': attempt.clamp(1, 1000000),
    'stage': _stages.contains(stage) ? stage : 'unknown',
    'outcome': _outcomes.contains(outcome) ? outcome : 'unknown',
    'durationMs': durationMs.clamp(0, 600000),
    'errorCode': code,
    if (requestId != null && RegExp(r'^[a-f0-9]{32}$').hasMatch(requestId))
      'requestId': requestId,
    if (nativeRequestId != null && RegExp(r'^[a-f0-9]{32}$').hasMatch(nativeRequestId))
      'nativeRequestId': nativeRequestId,
  };
}

final _sink = SubscriptionLoadDiagnosticsSink(
  directory: getApplicationDocumentsDirectory,
);

/// Serialized across writes. Existing QA metadata is imported and sanitized
/// after process restart so the first new event does not erase the failure.
class SubscriptionLoadDiagnosticsSink {
  SubscriptionLoadDiagnosticsSink({required this.directory});
  final Future<Directory> Function() directory;
  final _events = <Map<String, Object?>>[];
  Future<void> _write = Future.value();
  bool _loaded = false;

  Map<String, Object?> _sanitize(Map event) {
    final safe = makeSubscriptionLoadEvent(
      attempt: event['attempt'] is int ? event['attempt'] as int : 1,
      stage: event['stage'] is String ? event['stage'] as String : '',
      outcome: event['outcome'] is String ? event['outcome'] as String : '',
      durationMs: event['durationMs'] is int ? event['durationMs'] as int : 0,
      requestId: event['requestId'] is String ? event['requestId'] as String : null,
      nativeRequestId: event['nativeRequestId'] is String ? event['nativeRequestId'] as String : null,
    );
    final code = event['errorCode'];
    if (code is String &&
        {..._platformCodes, 'none', 'timeout', 'other_error', 'other_platform_error'}
            .contains(code)) { safe['errorCode'] = code; }
    final at = event['atUtc'];
    if (at is String && DateTime.tryParse(at) != null) safe['atUtc'] = at;
    return safe;
  }

  Future<void> record(Map<String, Object?> event) {
    // Copy synchronously, before the caller can mutate the event.
    final safe = _sanitize(event)..['atUtc'] = DateTime.now().toUtc().toIso8601String();
    _write = _write.then((_) async {
      try {
        final dir = await directory();
        final file = File('${dir.path}/wujie-subscription-load-stages.json');
        if (!_loaded) {
          if (await file.exists() && await file.length() <= 65536) {
            try {
              final root = jsonDecode(await file.readAsString());
              if (root is Map && root['events'] is List) {
                final old = root['events'] as List;
                for (final item in old.skip(old.length > 30 ? old.length - 30 : 0)) {
                  if (item is Map) _events.add(_sanitize(item));
                }
              }
            } catch (_) { /* Invalid old metadata cannot affect the user. */ }
          }
          _loaded = true;
        }
        _events.add(safe);
        if (_events.length > 30) _events.removeRange(0, _events.length - 30);
        final payload = jsonEncode({
          'build': const String.fromEnvironment('BUILD_NUMBER'),
          'credentialsRecorded': false,
          'events': List.of(_events),
        });
        await dir.create(recursive: true);
        final temp = File('${file.path}.tmp');
        await temp.writeAsString(payload, flush: true);
        await temp.rename(file.path);
      } catch (_) {
        // Diagnostics never change the subscription result.
      }
    }).catchError((_) {});
    return _write;
  }
}

/// Local QA metadata only. No owner, token, request/response or error message.
Future<void> recordSubscriptionLoadEvent(Map<String, Object?> event) {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') {
    return Future.value();
  }
  return _sink.record(event);
}
