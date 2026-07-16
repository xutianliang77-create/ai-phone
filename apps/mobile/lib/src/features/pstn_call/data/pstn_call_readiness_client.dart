import 'dart:convert';

import 'package:http/http.dart' as http;

typedef PstnCallReadinessFetcher = Future<PstnCallReadiness> Function(
  Uri baseUrl,
);

class PstnCallReadiness {
  const PstnCallReadiness({
    required this.status,
    required this.policy,
    required this.enabled,
    required this.provider,
    required this.issues,
  });

  factory PstnCallReadiness.fromHealthJson(Map<String, Object?> json) {
    final value = json['pstnReadiness'];
    if (value is! Map<String, Object?>) {
      throw const FormatException('Missing pstnReadiness');
    }
    return PstnCallReadiness(
      status: value['status'] as String? ?? 'not_ready',
      policy: value['policy'] as String? ?? 'unknown',
      enabled: value['enabled'] == true,
      provider: value['provider'] as String? ?? 'not_configured',
      issues: (value['issues'] as List<Object?>? ?? const <Object?>[])
          .whereType<String>()
          .toList(growable: false),
    );
  }

  final String status;
  final String policy;
  final bool enabled;
  final String provider;
  final List<String> issues;

  bool get isReady => status == 'ready' && enabled;
}

class PstnCallReadinessClient {
  PstnCallReadinessClient({
    required Uri baseUrl,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final http.Client _client;

  Future<PstnCallReadiness> fetch() async {
    final response = await _client
        .get(_baseUrl.resolve('/health'))
        .timeout(const Duration(seconds: 8));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PstnCallReadinessException(
        'PSTN readiness failed: ${response.statusCode}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return PstnCallReadiness.fromHealthJson(json);
  }

  void close() => _client.close();
}

class PstnCallReadinessException implements Exception {
  const PstnCallReadinessException(this.message);

  final String message;

  @override
  String toString() => message;
}

Future<PstnCallReadiness> fetchPstnCallReadiness(Uri baseUrl) async {
  final client = PstnCallReadinessClient(baseUrl: baseUrl);
  try {
    return await client.fetch();
  } finally {
    client.close();
  }
}
