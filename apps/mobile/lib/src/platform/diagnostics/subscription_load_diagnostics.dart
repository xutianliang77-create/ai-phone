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
};

int _nextAttempt = 0;
int nextSubscriptionLoadAttempt() => ++_nextAttempt;

Map<String, Object?> makeSubscriptionLoadEvent({
  required int attempt,
  required String stage,
  required String outcome,
  required int durationMs,
  Object? error,
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
  };
}

final _events = <Map<String, Object?>>[];
Future<void> _write = Future.value();

/// Local QA metadata only. No owner, token, request/response or error message.
Future<void> recordSubscriptionLoadEvent(Map<String, Object?> event) {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA') {
    return Future.value();
  }
  final safe = makeSubscriptionLoadEvent(
    attempt: event['attempt'] is int ? event['attempt'] as int : 1,
    stage: event['stage'] is String ? event['stage'] as String : '',
    outcome: event['outcome'] is String ? event['outcome'] as String : '',
    durationMs: event['durationMs'] is int ? event['durationMs'] as int : 0,
  );
  final code = event['errorCode'];
  if (code is String &&
      {
        ..._platformCodes,
        'none',
        'timeout',
        'other_error',
        'other_platform_error',
      }.contains(code)) {
    safe['errorCode'] = code;
  }
  safe['atUtc'] = DateTime.now().toUtc().toIso8601String();
  _events.add(safe);
  if (_events.length > 30) _events.removeAt(0);
  final payload = jsonEncode({
    'build': const String.fromEnvironment('BUILD_NUMBER'),
    'credentialsRecorded': false,
    'events': List.of(_events),
  });
  _write = _write
      .then((_) async {
        try {
          final directory = await getApplicationDocumentsDirectory();
          await File(
            '${directory.path}/wujie-subscription-load-stages.json',
          ).writeAsString(payload, flush: true);
        } catch (_) {
          // Diagnostics never change the subscription result.
        }
      })
      .catchError((_) {});
  return _write;
}
