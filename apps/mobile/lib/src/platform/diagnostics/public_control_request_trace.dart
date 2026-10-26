import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';

/// Bounded QA-only metadata. Server timing accepts known numeric fields only;
/// raw headers, bodies, account IDs and error messages are never retained.
Map<String, double> parsePublicServerTiming(String? header) {
  if (header == null || header.length > 512) return const {};
  final result = <String, double>{};
  for (final entry in header.split(',')) {
    final match = RegExp(
      r'^\s*(db|auth|schema|config|active|challenge|issue|settle|outbox|total);dur=(\d+(?:\.\d+)?)\s*$',
    ).firstMatch(entry);
    if (match == null) continue;
    final value = double.tryParse(match[2]!);
    if (value != null && value.isFinite && value >= 0 && value <= 300000) {
      result[match[1]!] = value;
    }
  }
  return result;
}

Future<void> recordPublicControlAttempt({
  required String path,
  required String phase,
  required String method,
  required int durationMs,
  required int timeoutMs,
  int? httpStatus,
  String? errorType,
  Map<String, double> serverTimingsMs = const {},
  int? serverDatabaseCalls,
}) async {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA' ||
      !_paths.contains(path) ||
      !const [
        'identity',
        'identity_cache',
        'identity_joined',
        'identity_network_retry',
        'request',
      ].contains(phase)) {
    return;
  }
  final event = <String, Object?>{
    'at': DateTime.now().toUtc().toIso8601String(),
    'build': const String.fromEnvironment('BUILD_NUMBER'),
    'path': path,
    'phase': phase,
    'method': method == 'GET' ? 'GET' : 'POST',
    'durationMs': durationMs,
    'timeoutMs': timeoutMs,
    if (httpStatus != null) 'httpStatus': httpStatus,
    if (serverTimingsMs.isNotEmpty)
      'serverTimingsMs': {
        for (final entry in serverTimingsMs.entries)
          if (const {
                'db',
                'auth',
                'schema',
                'config',
                'active',
                'challenge',
                'issue',
                'settle',
                'outbox',
                'total',
              }.contains(entry.key) &&
              entry.value.isFinite &&
              entry.value >= 0 &&
              entry.value <= 300000)
            entry.key: entry.value,
      },
    if (serverDatabaseCalls != null &&
        serverDatabaseCalls >= 0 &&
        serverDatabaseCalls <= 100)
      'serverDatabaseCalls': serverDatabaseCalls,
    if (errorType != null)
      'errorType': RegExp(r'^[A-Za-z][A-Za-z0-9_]{0,100}$').hasMatch(errorType)
          ? errorType
          : 'Error',
  };
  _events.add(event);
  if (_events.length > 40) _events.removeAt(0);
  final encoded = jsonEncode({
    'credentialsRecorded': false,
    'events': List.of(_events),
  });
  _write = _write.then((_) async {
    try {
      final directory = await getApplicationDocumentsDirectory();
      await File(
        '${directory.path}/wujie-public-control-requests.json',
      ).writeAsString(encoded, flush: true);
    } catch (_) {
      /* Diagnostics never change request results. */
    }
  });
  await _write;
}

Future<void> _write = Future.value();
final _events = <Map<String, Object?>>[];
const _paths = {
  '/auth/apple/request',
  '/auth/apple/login',
  '/account/me',
  '/usage/balance',
  '/billing/ledger',
  '/billing/products',
  '/billing/cases',
  '/billing/orders/history',
  '/billing/apple/consumption-consent',
  '/realtime/device-permits/challenge',
  '/realtime/device-permits/issue',
  '/realtime/device-permits/finish',
  '/realtime/device-permits/resolve',
};
