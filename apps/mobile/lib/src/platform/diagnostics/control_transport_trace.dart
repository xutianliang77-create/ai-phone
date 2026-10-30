import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:path_provider/path_provider.dart';

const _enabled =
    String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') == 'A13_QA' &&
    bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS');
const _paths = {
  '/auth/deployment',
  '/auth/apple/request',
  '/auth/apple/login',
  '/account/me',
  '/billing/products',
  '/billing/entitlement',
  '/billing/ledger',
  '/billing/subscription/sync',
  '/v10/device/configuration',
  '/v10/device/challenge',
  '/v10/device/register',
  '/v10/device/acquire',
  '/v10/device/renew',
  '/v10/device/resolve',
  '/v10/device/close',
};
const _phases = {
  'request_started',
  'native_task_started',
  'native_task_completed',
  'native_cancel_requested',
  'native_task_metrics',
  'request_completed',
  'native_metrics_unavailable',
  'request_failed',
  'request_retry',
};
const _serverCodes = {
  'v10_license_close_binding',
  'v10_device_statistics_invalid',
  'v10_device_proof',
  'v10_license_not_found',
  'v10_device_binding',
  'v10_attested_device_required',
  'v10_device_signature',
  'v10_invalid_fields',
  'v10_invalid_identifier',
  'v10_invalid_integer',
  'v10_control_unavailable',
  'd1_idempotency_conflict',
  'd1_precondition_failed',
  'd1_batch_unconfirmed',
  'd1_command_unconfirmed',
  'd1_receipt_unconfirmed',
  'd1_read_unconfirmed',
  'd1_query_budget_exceeded',
};

String? newControlDiagnosticId({String? path}) {
  if (!_enabled || (path != null && !_paths.contains(path))) return null;
  try {
    final random = Random.secure();
    return List.generate(
      12,
      (_) => random.nextInt(256),
    ).map((v) => v.toRadixString(16).padLeft(2, '0')).join();
  } catch (_) {
    return null;
  }
}

/// Returns only an explicit code allowlist; never preserves response bodies.
String? controlDiagnosticServerCode(int status, List<int> bytes) {
  if (status == 200 || bytes.length > 4096) return null;
  try {
    final value = jsonDecode(utf8.decode(bytes));
    final code = value is Map && value['error'] is Map
        ? (value['error'] as Map)['code']
        : null;
    return code is String && _serverCodes.contains(code) ? code : null;
  } catch (_) {
    return null;
  }
}

@visibleForTesting
Map<String, Object?>? sanitizeControlTransportEvent({
  required String id,
  required String path,
  required String phase,
  required String method,
  required int elapsedMs,
  int? attempt,
  int? status,
  int? errorCode,
  String? errorDomain,
  String? errorType,
  String? cfRay,
  String? serverCode,
  List<Map<String, Object?>>? metrics,
}) {
  if (!RegExp(r'^[a-f0-9]{24}$').hasMatch(id) ||
      !_paths.contains(path) ||
      !_phases.contains(phase) ||
      !const {'GET', 'POST'}.contains(method) ||
      elapsedMs < 0 ||
      elapsedMs > 300000) {
    return null;
  }
  final domain =
      const {
        'NSURLErrorDomain',
        'NSPOSIXErrorDomain',
        'kCFErrorDomainCFNetwork',
      }.contains(errorDomain)
      ? errorDomain
      : null;
  final type =
      const {
        'TimeoutException',
        'ClientException',
        'RequestAbortedException',
        'NSErrorClientException',
        'AccountAuthRequiredException',
        'DeploymentIdentityFailure',
      }.contains(errorType)
      ? errorType
      : null;
  final safeRay =
      cfRay != null &&
          RegExp(r'^[a-fA-F0-9]{16,32}-[A-Za-z0-9]{3,6}$').hasMatch(cfRay)
      ? cfRay
      : null;
  final safeMetrics = <Map<String, Object?>>[];
  for (final item in (metrics ?? const <Map<String, Object?>>[]).take(8)) {
    final safe = <String, Object?>{};
    for (final key in const {
      'dnsMs',
      'connectMs',
      'tlsMs',
      'requestMs',
      'responseMs',
    }) {
      final value = item[key];
      if (value is int && value >= 0 && value <= 300000) safe[key] = value;
    }
    for (final key in const {'proxy', 'reused', 'cellular'}) {
      if (item[key] is bool) safe[key] = item[key];
    }
    if (const {'http/1.1', 'h2', 'h3', 'other'}.contains(item['protocol'])) {
      safe['protocol'] = item['protocol'];
    }
    safeMetrics.add(safe);
  }
  return {
    'at': DateTime.now().toUtc().toIso8601String(),
    'build': const String.fromEnvironment('BUILD_NUMBER'),
    'id': id,
    'path': path,
    'phase': phase,
    'method': method,
    'elapsedMs': elapsedMs,
    if (attempt != null && attempt >= 1 && attempt <= 2) 'attempt': attempt,
    if (status != null && status >= 100 && status <= 599) 'status': status,
    if (errorCode != null && errorCode >= -65536 && errorCode <= 65536)
      'errorCode': errorCode,
    if (domain != null) 'errorDomain': domain,
    if (type != null) 'errorType': type,
    if (safeRay != null) 'cfRay': safeRay,
    if (serverCode != null && _serverCodes.contains(serverCode))
      'serverCode': serverCode,
    if (metrics != null) 'metrics': safeMetrics,
  };
}

Future<void> _pendingWrite = Future.value();

@visibleForTesting
Future<void> waitForControlDiagnosticWrites() => _pendingWrite;

Map<String, Object?>? _resanitizePrevious(Map value) {
  final id = value['id'],
      path = value['path'],
      phase = value['phase'],
      method = value['method'],
      elapsed = value['elapsedMs'];
  if (id is! String ||
      path is! String ||
      phase is! String ||
      method is! String ||
      elapsed is! int) {
    return null;
  }
  final rawMetrics = value['metrics'];
  final result = sanitizeControlTransportEvent(
    id: id,
    path: path,
    phase: phase,
    method: method,
    elapsedMs: elapsed,
    attempt: value['attempt'] is int ? value['attempt'] : null,
    status: value['status'] is int ? value['status'] : null,
    errorCode: value['errorCode'] is int ? value['errorCode'] : null,
    errorDomain: value['errorDomain'] is String ? value['errorDomain'] : null,
    errorType: value['errorType'] is String ? value['errorType'] : null,
    cfRay: value['cfRay'] is String ? value['cfRay'] : null,
    serverCode: value['serverCode'] is String ? value['serverCode'] : null,
    metrics: rawMetrics is List
        ? rawMetrics
              .whereType<Map>()
              .map(
                (e) => <String, Object?>{
                  for (final entry in e.entries)
                    if (entry.key is String) entry.key as String: entry.value,
                },
              )
              .toList()
        : null,
  );
  if (result == null) return null;
  final at = value['at'], build = value['build'];
  if (at is String && DateTime.tryParse(at) != null && at.length <= 40) {
    result['at'] = at;
  }
  if (build is String && RegExp(r'^\d{0,20}$').hasMatch(build)) {
    result['build'] = build;
  }
  return result;
}

/// A separate bounded file keeps the pre-existing 3002 evidence untouched.
/// Diagnostics are best-effort and never change the business request result.
void recordControlTransportEvent({
  required String? id,
  required String path,
  required String phase,
  required String method,
  required int elapsedMs,
  int? attempt,
  int? status,
  int? errorCode,
  String? errorDomain,
  String? errorType,
  String? cfRay,
  String? serverCode,
  List<Map<String, Object?>>? metrics,
}) {
  if (!_enabled || id == null) return;
  final event = sanitizeControlTransportEvent(
    id: id,
    path: path,
    phase: phase,
    method: method,
    elapsedMs: elapsedMs,
    attempt: attempt,
    status: status,
    errorCode: errorCode,
    errorDomain: errorDomain,
    errorType: errorType,
    cfRay: cfRay,
    serverCode: serverCode,
    metrics: metrics,
  );
  if (event == null) return;
  _pendingWrite = _pendingWrite.then((_) async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File(
        '${dir.path}/wujie-control-transport-diagnostics-v2.json',
      );
      final entries = <Object?>[];
      if (await file.exists() && await file.length() <= 128 * 1024) {
        final previous = jsonDecode(await file.readAsString());
        if (previous is Map && previous['events'] is List) {
          for (final row in (previous['events'] as List).whereType<Map>()) {
            final safe = _resanitizePrevious(row);
            if (safe != null) entries.add(safe);
          }
        }
      }
      entries.add(event);
      final kept = entries.length > 128
          ? entries.sublist(entries.length - 128)
          : entries;
      final temp = File('${file.path}.tmp');
      await temp.writeAsString(
        jsonEncode({'credentialsRecorded': false, 'events': kept}),
        flush: true,
      );
      await temp.rename(file.path);
    } catch (_) {
      // Do not interfere with authorization if diagnostic persistence fails.
    }
  });
}
