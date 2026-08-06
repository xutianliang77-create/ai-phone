import 'dart:convert';

import 'package:http/http.dart' as http;

class AiCallingAgentCancellation {
  const AiCallingAgentCancellation({
    required this.status,
    required this.code,
    this.replayed = false,
  });

  final String status;
  final String code;
  final bool replayed;
}

AiCallingAgentCancellation? parseAiCallingAgentCancellation(String body) {
  try {
    final json = jsonDecode(body);
    if (json is! Map || json['hangup'] is! Map) return null;
    final hangup = json['hangup'] as Map;
    final status = hangup['status'];
    final code = hangup['code'];
    if (status is! String || code is! String) return null;
    return AiCallingAgentCancellation(
      status: status,
      code: code,
      replayed: hangup['replayed'] == true,
    );
  } on FormatException {
    return null;
  }
}

class AiCallingAgentApiException implements Exception {
  const AiCallingAgentApiException(
    this.message, {
    this.statusCode,
    this.code,
    this.retryAfterSeconds,
    this.nextAllowedAt,
  });

  factory AiCallingAgentApiException.fromResponse(
    String operation,
    http.Response response,
  ) {
    String? code;
    int? retryAfterSeconds;
    String? nextAllowedAt;
    try {
      final body = jsonDecode(response.body);
      if (body is Map) {
        final error = body['error'];
        if (error is Map && error['code'] is String) {
          code = error['code'] as String;
        }
        final retryAfter = body['retryAfterSeconds'];
        if (retryAfter is num) retryAfterSeconds = retryAfter.toInt();
        final nextAllowed = body['nextAllowedAt'];
        if (nextAllowed is String) nextAllowedAt = nextAllowed;
      }
    } on FormatException {
      // Keep the raw response in message for non-JSON proxies/errors.
    }
    return AiCallingAgentApiException(
      '$operation: ${response.body}',
      statusCode: response.statusCode,
      code: code,
      retryAfterSeconds: retryAfterSeconds,
      nextAllowedAt: nextAllowedAt,
    );
  }

  final String message;
  final int? statusCode;
  final String? code;
  final int? retryAfterSeconds;
  final String? nextAllowedAt;

  @override
  String toString() => message;
}
