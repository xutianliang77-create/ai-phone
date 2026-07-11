import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../app/app_config.dart';

class AppErrorReporter {
  AppErrorReporter({
    required Uri baseUrl,
    required bool enabled,
    required String appVersion,
    required String buildNumber,
    required String regionEdition,
    required String dataRegion,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _enabled = enabled,
        _appVersion = appVersion,
        _buildNumber = buildNumber,
        _regionEdition = regionEdition,
        _dataRegion = dataRegion,
        _client = client ?? http.Client();

  factory AppErrorReporter.fromConfig(AppConfig config, {http.Client? client}) {
    return AppErrorReporter(
      baseUrl: config.apiBaseUrl,
      enabled: config.appErrorReportingEnabled,
      appVersion: config.appVersion,
      buildNumber: config.buildNumber,
      regionEdition: config.region.edition.name,
      dataRegion: config.region.dataRegion,
      client: client,
    );
  }

  final Uri _baseUrl;
  final bool _enabled;
  final String _appVersion;
  final String _buildNumber;
  final String _regionEdition;
  final String _dataRegion;
  final http.Client _client;

  Future<void> reportFlutterError(FlutterErrorDetails details) {
    return reportError(
      details.exception,
      details.stack,
      eventType: 'flutter_error',
      fatal: false,
      context: <String, Object?>{
        'library': details.library,
        'context': details.context?.toString(),
      },
    );
  }

  Future<void> reportError(
    Object error,
    StackTrace? stackTrace, {
    required String eventType,
    required bool fatal,
    Map<String, Object?> context = const <String, Object?>{},
  }) async {
    if (!_enabled) return;
    final body = AppErrorReport(
      eventType: eventType,
      message: error.toString(),
      stackTrace: stackTrace?.toString(),
      fatal: fatal,
      platform: defaultTargetPlatform.name,
      appVersion: _appVersion,
      buildNumber: _buildNumber,
      regionEdition: _regionEdition,
      dataRegion: _dataRegion,
      occurredAt: DateTime.now().toUtc(),
      context: context,
    ).toJson();
    try {
      await _client
          .post(
            _baseUrl.resolve('/diagnostics/app-errors'),
            headers: const {'content-type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 5));
    } catch (_) {
      // Crash reporting must never create a second user-visible failure.
    }
  }

  void close() {
    _client.close();
  }
}

class AppErrorReport {
  const AppErrorReport({
    required this.eventType,
    required this.message,
    required this.fatal,
    required this.platform,
    required this.appVersion,
    required this.buildNumber,
    required this.regionEdition,
    required this.dataRegion,
    required this.occurredAt,
    this.stackTrace,
    this.context = const <String, Object?>{},
  });

  final String eventType;
  final String message;
  final String? stackTrace;
  final bool fatal;
  final String platform;
  final String appVersion;
  final String buildNumber;
  final String regionEdition;
  final String dataRegion;
  final DateTime occurredAt;
  final Map<String, Object?> context;

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'eventType': eventType,
      'message': redactAppDiagnosticText(_trim(message, 1000)),
      if (stackTrace != null)
        'stackTrace': redactAppDiagnosticText(_trim(stackTrace!, 4000)),
      'fatal': fatal,
      'platform': platform,
      'appVersion': appVersion,
      'buildNumber': buildNumber,
      'regionEdition': regionEdition,
      'dataRegion': dataRegion,
      'occurredAt': occurredAt.toIso8601String(),
      if (context.isNotEmpty) 'context': redactAppDiagnosticObject(context),
    };
  }

  String _trim(String value, int maxLength) {
    return value.length <= maxLength ? value : value.substring(0, maxLength);
  }
}

Object? redactAppDiagnosticObject(Object? value, [String? key]) {
  if (key != null && _sensitiveKeys.contains(_normalizeKey(key))) {
    return _redacted;
  }
  if (value is String) return redactAppDiagnosticText(value);
  if (value is List) {
    return value.map((item) => redactAppDiagnosticObject(item)).toList();
  }
  if (value is Map) {
    return value.map(
      (entryKey, entryValue) => MapEntry(
        entryKey,
        redactAppDiagnosticObject(entryValue, entryKey.toString()),
      ),
    );
  }
  return value;
}

String redactAppDiagnosticText(String value) {
  return value
      .replaceAllMapped(_inlineSensitivePattern, (match) {
        return '${match.group(1)}=$_redacted';
      })
      .replaceAll(_emailPattern, _redacted)
      .replaceAll(_chinaMobilePattern, _redacted)
      .replaceAll(_e164PhonePattern, _redacted)
      .replaceAll(_usPhonePattern, _redacted);
}

const _redacted = '[REDACTED]';

final _sensitiveKeys = <String>{
  'accesstoken',
  'apikey',
  'authorization',
  'audio',
  'content',
  'data',
  'email',
  'password',
  'phone',
  'phonenumber',
  'refreshtoken',
  'secret',
  'signedpayload',
  'signedtransactioninfo',
  'sourcetext',
  'text',
  'token',
  'transcript',
  'translatedtext',
  'translation',
  'webhooksecret',
};

final _inlineSensitivePattern = RegExp(
  '\\b(${_sensitiveKeys.join('|')})\\s*[:=]\\s*("[^"]*"|\'[^\']*\'|[^,\\s&}]+)',
  caseSensitive: false,
);
final _emailPattern = RegExp(
  r'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
  caseSensitive: false,
);
final _chinaMobilePattern = RegExp(r'\b1[3-9]\d{9}\b');
final _e164PhonePattern = RegExp(r'\+\d[\d\s().-]{7,}\d');
final _usPhonePattern = RegExp(
  r'\b(?:\(\d{3}\)|\d{3})[-\s.]\d{3}[-\s.]\d{4}\b',
);

String _normalizeKey(String key) {
  return key.replaceAll(RegExp('[_-]'), '').toLowerCase();
}
