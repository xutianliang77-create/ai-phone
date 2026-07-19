import 'dart:convert';

import 'package:http/http.dart' as http;

typedef ApiHealthFetcher = Future<ApiHealthInfo> Function(Uri baseUrl);
typedef GatewayHealthFetcher = Future<GatewayHealthInfo> Function(
  String realtimeWsEndpoint,
);

class ApiHealthInfo {
  const ApiHealthInfo({
    required this.status,
    this.service,
    this.version,
    this.realtimeWsEndpoint,
    this.regionEdition,
    this.dataRegion,
    this.callProviderPolicy,
    this.complianceProfile,
  });

  factory ApiHealthInfo.fromJson(Map<String, Object?> json) {
    return ApiHealthInfo(
      status: json['status'] as String? ?? 'unknown',
      service: json['service'] as String?,
      version: json['version'] as String?,
      realtimeWsEndpoint: json['realtimeWsEndpoint'] as String?,
      regionEdition: json['regionEdition'] as String?,
      dataRegion: json['dataRegion'] as String?,
      callProviderPolicy: json['callProviderPolicy'] as String?,
      complianceProfile: json['complianceProfile'] as String?,
    );
  }

  final String status;
  final String? service;
  final String? version;
  final String? realtimeWsEndpoint;
  final String? regionEdition;
  final String? dataRegion;
  final String? callProviderPolicy;
  final String? complianceProfile;
}

class GatewayHealthInfo {
  const GatewayHealthInfo({
    required this.status,
    this.service,
    this.provider,
    this.resolvedProvider,
    this.regionEdition,
    this.dataRegion,
    this.callProviderPolicy,
    this.complianceProfile,
    this.asrProvider,
    this.asrEndpoint,
    this.asrHealthUrl,
    this.translationEndpoint,
    this.translationModel,
    this.sessionEventSink,
  });

  factory GatewayHealthInfo.fromJson(Map<String, Object?> json) {
    return GatewayHealthInfo(
      status: json['status'] as String? ?? 'unknown',
      service: json['service'] as String?,
      provider: json['provider'] as String?,
      resolvedProvider: json['resolvedProvider'] as String?,
      regionEdition: json['regionEdition'] as String?,
      dataRegion: json['dataRegion'] as String?,
      callProviderPolicy: json['callProviderPolicy'] as String?,
      complianceProfile: json['complianceProfile'] as String?,
      asrProvider: json['asrProvider'] as String?,
      asrEndpoint: json['asrEndpoint'] as String?,
      asrHealthUrl: json['asrHealthUrl'] as String?,
      translationEndpoint: json['translationEndpoint'] as String?,
      translationModel: json['translationModel'] as String?,
      sessionEventSink: json['sessionEventSink'] as String?,
    );
  }

  final String status;
  final String? service;
  final String? provider;
  final String? resolvedProvider;
  final String? regionEdition;
  final String? dataRegion;
  final String? callProviderPolicy;
  final String? complianceProfile;
  final String? asrProvider;
  final String? asrEndpoint;
  final String? asrHealthUrl;
  final String? translationEndpoint;
  final String? translationModel;
  final String? sessionEventSink;

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'status': status,
      'service': service,
      'provider': provider,
      'resolvedProvider': resolvedProvider,
      'regionEdition': regionEdition,
      'dataRegion': dataRegion,
      'callProviderPolicy': callProviderPolicy,
      'complianceProfile': complianceProfile,
      'asrProvider': asrProvider,
      'asrEndpoint': asrEndpoint,
      'asrHealthUrl': asrHealthUrl,
      'translationEndpoint': translationEndpoint,
      'translationModel': translationModel,
      'sessionEventSink': sessionEventSink,
    };
  }
}

class ApiHealthClient {
  ApiHealthClient({
    required Uri baseUrl,
    http.Client? client,
  })  : _baseUrl = baseUrl,
        _client = client ?? http.Client();

  final Uri _baseUrl;
  final http.Client _client;

  Future<ApiHealthInfo> fetch() async {
    final response = await _client
        .get(_baseUrl.resolve('/health'))
        .timeout(const Duration(seconds: 8));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiHealthException('API /health failed: ${response.statusCode}');
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return ApiHealthInfo.fromJson(json);
  }

  void close() {
    _client.close();
  }
}

Future<ApiHealthInfo> fetchApiHealth(Uri baseUrl) async {
  final client = ApiHealthClient(baseUrl: baseUrl);
  try {
    return await client.fetch();
  } finally {
    client.close();
  }
}

Future<GatewayHealthInfo> fetchGatewayHealth(String realtimeWsEndpoint) async {
  final client = http.Client();
  try {
    final response = await client
        .get(_gatewayHealthUri(realtimeWsEndpoint))
        .timeout(const Duration(seconds: 8));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiHealthException(
        'Gateway /health failed: ${response.statusCode}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, Object?>;
    return GatewayHealthInfo.fromJson(json);
  } finally {
    client.close();
  }
}

class ApiHealthException implements Exception {
  const ApiHealthException(this.message);

  final String message;

  @override
  String toString() => message;
}

Uri _gatewayHealthUri(String realtimeWsEndpoint) {
  final uri = Uri.parse(realtimeWsEndpoint);
  final scheme = uri.scheme == 'wss' ? 'https' : 'http';
  return uri.replace(scheme: scheme, path: '/health', query: '');
}
