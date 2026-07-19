import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'enterprise_meeting_models.dart';
import 'enterprise_mobile_models.dart';

class EnterpriseMobileApiClient {
  EnterpriseMobileApiClient({required this.baseUrl, http.Client? client})
      : _client = client ?? http.Client();

  final Uri baseUrl;
  final http.Client _client;
  static const _timeout = Duration(seconds: 8);

  Future<List<EnterpriseMobileMembership>> listTenants(String token) async {
    final json = await _get('/enterprise/v1/tenants', token);
    final tenants = json['tenants'];
    if (tenants is! List<Object?>) {
      throw const EnterpriseMobileApiException(
        code: 'invalid_response',
        message: 'Invalid tenant response',
      );
    }
    return tenants.map((value) {
      if (value is! Map<String, Object?>) {
        throw const FormatException('Invalid enterprise membership');
      }
      return EnterpriseMobileMembership.fromJson(value);
    }).toList(growable: false);
  }

  Future<EnterpriseMobileWorkspace> loadWorkspace({
    required String token,
    required EnterpriseMobileMembership membership,
  }) async {
    final tenantId = membership.tenant.id;
    final results = await Future.wait<Map<String, Object?>>(
      <Future<Map<String, Object?>>>[
        _get('/saas/v1/tenants/${Uri.encodeComponent(tenantId)}/route', token),
        _get('/enterprise/v1/me', token, tenantId: tenantId),
        _get('/enterprise/v1/provider-capabilities', token, tenantId: tenantId),
      ],
    );
    final route = EnterpriseMobileRoute.fromJson(results[0]);
    final context = EnterpriseMobileContext.fromJson(results[1]);
    final providers = _providers(results[2]);
    _validateWorkspace(membership, context, route, providers);
    return EnterpriseMobileWorkspace(
      token: token,
      context: context,
      route: route,
      providers: providers,
    );
  }

  Future<List<EnterpriseMobileMeetingAggregate>> listMeetings(
    EnterpriseMobileWorkspace workspace,
  ) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings',
      method: 'GET',
    );
    final meetings = json['meetings'];
    if (meetings is! List<Object?>) {
      throw const FormatException('Invalid enterprise meetings response');
    }
    return meetings.map((value) {
      if (value is! Map<String, Object?>) {
        throw const FormatException('Invalid enterprise meeting aggregate');
      }
      return EnterpriseMobileMeetingAggregate.fromJson(value);
    }).toList(growable: false);
  }

  Future<EnterpriseMobileMeetingJoinGrant> joinMeeting(
    EnterpriseMobileWorkspace workspace,
    String meetingId, {
    required String captionLanguage,
    required bool translatedAudioEnabled,
  }) async {
    final json = await contentRequest(
      workspace,
      '/enterprise/v1/meetings/${Uri.encodeComponent(meetingId)}/join',
      method: 'POST',
      body: <String, Object?>{
        'captionLanguage': captionLanguage,
        'translatedAudioEnabled': translatedAudioEnabled,
      },
    );
    final grant = EnterpriseMobileMeetingJoinGrant.fromJson(json);
    if (grant.meetingId != meetingId ||
        _canonicalUrl(grant.rtcUrl) != _canonicalUrl(workspace.route.rtcUrl)) {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Enterprise meeting grant mismatch',
      );
    }
    return grant;
  }

  void close() => _client.close();

  Future<Map<String, Object?>> _get(
    String path,
    String token, {
    String? tenantId,
  }) async {
    http.Response response;
    try {
      response = await _client.get(
        baseUrl.resolve(path),
        headers: <String, String>{
          'accept': 'application/json',
          'authorization': 'Bearer $token',
          if (tenantId != null) 'x-tenant-id': tenantId,
        },
      ).timeout(_timeout);
    } on TimeoutException {
      throw const EnterpriseMobileApiException(
        code: 'network_timeout',
        message: 'Enterprise request timed out',
      );
    } catch (_) {
      throw const EnterpriseMobileApiException(
        code: 'network_error',
        message: 'Enterprise network unavailable',
      );
    }
    return _decode(response);
  }

  Future<Map<String, Object?>> contentRequest(
    EnterpriseMobileWorkspace workspace,
    String path, {
    required String method,
    Map<String, Object?>? body,
    String? idempotencyKey,
    Duration? timeout,
  }) async {
    http.Response response;
    try {
      final request =
          http.Request(method, workspace.route.apiBaseUrl.resolve(path))
            ..headers.addAll(<String, String>{
              'accept': 'application/json',
              'authorization': 'Bearer ${workspace.token}',
              'x-tenant-id': workspace.context.tenant.id,
              'x-enterprise-route-document': base64Url
                  .encode(utf8.encode(jsonEncode(workspace.route.toJson())))
                  .replaceAll('=', ''),
              if (body != null) 'content-type': 'application/json',
              if (idempotencyKey != null) 'idempotency-key': idempotencyKey,
            });
      if (body != null) request.body = jsonEncode(body);
      response = await http.Response.fromStream(await _client.send(request))
          .timeout(timeout ?? _timeout);
    } on TimeoutException {
      throw const EnterpriseMobileApiException(
        code: 'network_timeout',
        message: 'Enterprise request timed out',
      );
    } catch (_) {
      throw const EnterpriseMobileApiException(
        code: 'network_error',
        message: 'Enterprise network unavailable',
      );
    }
    return _decode(response);
  }

  Map<String, Object?> _decode(http.Response response) {
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw EnterpriseMobileApiException(
        statusCode: response.statusCode,
        code: 'invalid_response',
        message: 'Enterprise API returned invalid JSON',
      );
    }
    if (decoded is! Map<String, Object?>) {
      throw EnterpriseMobileApiException(
        statusCode: response.statusCode,
        code: 'invalid_response',
        message: 'Enterprise API returned invalid payload',
      );
    }
    if (response.statusCode >= 200 && response.statusCode < 300) return decoded;
    final error = decoded['error'];
    final detail =
        error is Map<String, Object?> ? error : const <String, Object?>{};
    throw EnterpriseMobileApiException(
      statusCode: response.statusCode,
      code: detail['code'] as String? ?? 'request_failed',
      message: detail['message'] as String? ?? 'Enterprise request failed',
      traceId: detail['traceId'] as String?,
    );
  }

  List<EnterpriseMobileProviderCapability> _providers(
    Map<String, Object?> json,
  ) {
    final values = json['capabilities'];
    if (values is! List<Object?>) {
      throw const FormatException('Invalid capabilities');
    }
    return values.map((value) {
      if (value is! Map<String, Object?>) {
        throw const FormatException('Invalid capability');
      }
      return EnterpriseMobileProviderCapability.fromJson(value);
    }).toList(growable: false);
  }

  void _validateWorkspace(
    EnterpriseMobileMembership selected,
    EnterpriseMobileContext context,
    EnterpriseMobileRoute route,
    List<EnterpriseMobileProviderCapability> providers,
  ) {
    final tenant = context.tenant;
    final valid = selected.tenant.id == tenant.id &&
        selected.member.tenantId == tenant.id &&
        selected.member.id == context.member.id &&
        selected.member.userId == context.member.userId &&
        context.member.tenantId == tenant.id &&
        selected.member.status == 'active' &&
        context.member.status == 'active' &&
        tenant.status == 'active' &&
        route.tenantId == tenant.id &&
        route.homeRegion == tenant.homeRegion &&
        route.cellId == tenant.cellId &&
        route.routeEpoch == tenant.version &&
        !route.issuedAt
            .isAfter(DateTime.now().add(const Duration(seconds: 30))) &&
        route.expiresAt.isAfter(DateTime.now()) &&
        _publicUrl(route.apiBaseUrl, 'https') &&
        _publicUrl(route.rtcUrl, 'wss') &&
        route.signature.isNotEmpty &&
        providers.every(
          (provider) =>
              provider.region == tenant.homeRegion &&
              const <String>{
                'ready',
                'checking',
                'degraded',
                'not_configured',
                'not_ready',
              }.contains(provider.status),
        );
    if (!valid) {
      throw const EnterpriseMobileApiException(
        code: 'tenant_context_mismatch',
        message: 'Enterprise route and membership mismatch',
      );
    }
  }

  bool _publicUrl(Uri value, String scheme) {
    final host = value.host.toLowerCase();
    return value.scheme == scheme &&
        value.userInfo.isEmpty &&
        host.contains('.') &&
        host != 'localhost' &&
        !host.endsWith('.local') &&
        !host.endsWith('.internal') &&
        InternetAddress.tryParse(host) == null;
  }

  String _canonicalUrl(Uri value) {
    final path = value.path.endsWith('/')
        ? value.path.substring(0, value.path.length - 1)
        : value.path;
    return '${value.scheme}://${value.authority}$path';
  }
}

class EnterpriseMobileApiException implements Exception {
  const EnterpriseMobileApiException({
    required this.code,
    required this.message,
    this.statusCode,
    this.traceId,
  });

  final int? statusCode;
  final String code;
  final String message;
  final String? traceId;

  bool get isAuthenticationFailure => statusCode == 401;

  @override
  String toString() => '$code: $message';
}
