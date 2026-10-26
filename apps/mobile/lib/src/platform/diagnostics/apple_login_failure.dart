import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

final _loginStages = <Map<String, Object?>>[];
Future<void> _loginStageWrite = Future.value();

/// Success and failure durations only: no request, identity, token, or code.
Future<void> recordAppleLoginStage({
  required String stage,
  required String outcome,
  required int durationMs,
}) async {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA' ||
      !const [
        'challenge_request',
        'validate_agreements',
        'system_authorization',
        'login_submit',
        'login_response',
      ].contains(stage) ||
      !const ['completed', 'failed', 'cancelled'].contains(outcome)) {
    return;
  }
  _loginStages.add({
    'at': DateTime.now().toUtc().toIso8601String(),
    'build': const String.fromEnvironment('BUILD_NUMBER'),
    'stage': stage,
    'outcome': outcome,
    'durationMs': durationMs.clamp(0, 600000),
  });
  if (_loginStages.length > 40) _loginStages.removeAt(0);
  final value = jsonEncode({
    'credentialsRecorded': false,
    'events': List.of(_loginStages),
  });
  _loginStageWrite = _loginStageWrite.then((_) async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      await File(
        '${dir.path}/wujie-apple-login-stages.json',
      ).writeAsString(value, flush: true);
    } catch (_) {
      /* A diagnostic never changes login behavior. */
    }
  });
  await _loginStageWrite;
}

/// QA-only local failure metadata. Never receives a request, token, or response body.
Future<void> recordAppleLoginFailure(
  String path,
  int status,
  Object? code,
) async {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA' ||
      !const ['/auth/apple/request', '/auth/apple/login'].contains(path)) {
    return;
  }
  final safeCode =
      code is String &&
          RegExp(
            r'^(apple_|d1_|account_|invalid_|public_|deployment_|request_)[a-z0-9_]{1,120}$',
          ).hasMatch(code)
      ? code
      : 'unclassified_error';
  try {
    final directory = await getApplicationDocumentsDirectory();
    final now = DateTime.now().toUtc();
    await File(
      '${directory.path}/wujie-apple-login-failure-${now.microsecondsSinceEpoch}.json',
    ).writeAsString(
      jsonEncode({
        'at': now.toIso8601String(),
        'build': const String.fromEnvironment('BUILD_NUMBER'),
        'stage': path.endsWith('/login') ? 'login_submit' : 'challenge_request',
        'httpStatus': status,
        'errorCode': safeCode,
        'credentialsRecorded': false,
      }),
      flush: true,
    );
  } catch (_) {
    // A diagnostic write must not alter the authentication result.
  }
}

Future<void> recordAppleLoginClientFailure({
  required String stage,
  required String errorType,
  Object? code,
  Object? nativeDomain,
  Object? nativeCode,
  required int durationMs,
}) async {
  if (const String.fromEnvironment('PUBLIC_RELEASE_PURPOSE') != 'A13_QA' ||
      !const [
        'challenge_request',
        'validate_agreements',
        'system_authorization',
        'login_submit',
        'login_response',
      ].contains(stage)) {
    return;
  }
  final safeCode =
      code is String &&
          RegExp(
            r'^(apple_|network_|invalid_|public_|deployment_|request_|account_)[a-z0-9_]{1,120}$',
          ).hasMatch(code)
      ? code
      : 'unclassified_error';
  final safeType = RegExp(r'^[A-Za-z0-9_]{1,80}$').hasMatch(errorType)
      ? errorType
      : 'Unknown';
  try {
    final dir = await getApplicationDocumentsDirectory();
    final now = DateTime.now().toUtc();
    await File(
      '${dir.path}/wujie-apple-login-client-failure-${now.microsecondsSinceEpoch}.json',
    ).writeAsString(
      jsonEncode({
        'at': now.toIso8601String(),
        'build': const String.fromEnvironment('BUILD_NUMBER'),
        'stage': stage,
        'errorType': safeType,
        'errorCode': safeCode,
        'durationMs': durationMs.clamp(0, 600000),
        'credentialsRecorded': false,
        if (nativeDomain is String &&
            RegExp(r'^[A-Za-z0-9._-]{1,120}$').hasMatch(nativeDomain))
          'nativeErrorDomain': nativeDomain,
        if (nativeCode is int && nativeCode.abs() <= 2147483647)
          'nativeErrorCode': nativeCode,
      }),
      flush: true,
    );
  } catch (_) {
    /* Diagnostics cannot replace the actual login result. */
  }
}
