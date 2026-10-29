import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:flutter/services.dart';
import '../../../platform/http/public_http_client.dart';
import '../../../platform/diagnostics/apple_login_failure.dart';
import '../../../platform/http/deployment_identity_cache.dart';
import '../../../platform/diagnostics/public_control_request_trace.dart';
import 'account_session_store.dart';
import 'account_scoped_http.dart';
import 'account_auth_headers.dart';
import 'apple_identity_client.dart';
import '../../../platform/http/account_bound_http_client.dart';
import '../../../platform/http/on_device_egress.dart';
import '../../history/data/owned_local_session_store.dart';
import '../../../platform/sharing/local_file_share_service.dart';

part 'account_api_transport.dart';
part 'account_api_models.dart';

class AccountApiClient {
  AccountApiClient({
    required this.baseUrl,
    http.Client? client,
    this.deploymentId = configuredPublicDeploymentId,
  }) : _client = client ?? createPublicHttpClient(baseUrl) {
    if (deploymentId.isNotEmpty) {
      AccountRequestScope(
        deploymentId: deploymentId,
        ownerId: 'login',
        apiBaseUrl: baseUrl,
      );
    }
  }

  final Uri baseUrl;
  final String deploymentId;
  AccountSessionStore createSessionStore() =>
      accountStoreForDeployment(baseUrl, deploymentId: deploymentId);
  AccountSession sessionFromLogin(AccountLoginResult result) => AccountSession(
    token: result.token,
    expiresAtIso: result.expiresAt.toUtc().toIso8601String(),
    deploymentId: deploymentId.isEmpty ? null : deploymentId,
    ownerId: deploymentId.isEmpty ? null : result.account.id,
    issuerOrigin: deploymentId.isEmpty ? null : baseUrl.origin,
  );
  bool sessionMatches(AccountSession session) =>
      deploymentId.isEmpty ||
      session.ownerId != null &&
          AccountRequestScope(
            deploymentId: deploymentId,
            ownerId: session.ownerId!,
            apiBaseUrl: baseUrl,
          ).matches(session) &&
          (DateTime.tryParse(session.expiresAtIso)?.isAfter(DateTime.now()) ??
              false);
  final http.Client _client;
  // Includes deployment verification and the following account request. A
  // fresh device connection can exceed eight seconds before login is sent.
  static const requestTimeout = Duration(seconds: 30);

  Future<Map<String, Object?>> appleChallenge() async {
    requireAccountOrigin(baseUrl, deploymentId);
    return _captureAppleFailure(
      'challenge_request',
      () => _post('/auth/apple/request', {
        'deploymentId': deploymentId,
        'action': 'login',
      }),
    );
  }

  Future<AccountLoginResult> loginWithApple(
    Map<String, Object?> challenge, {
    required bool privacyAccepted,
    required bool termsAccepted,
    AppleIdentityClient identity = const AppleIdentityClient(),
  }) async {
    requireAccountOrigin(baseUrl, deploymentId);
    if (challenge['deploymentId'] != deploymentId ||
        !privacyAccepted ||
        !termsAccepted ||
        configuredPublicBundleId.isEmpty ||
        configuredPrivacyVersion.isEmpty ||
        configuredTermsVersion.isEmpty ||
        challenge['privacyVersion'] != configuredPrivacyVersion ||
        challenge['termsVersion'] != configuredTermsVersion ||
        [
          'challengeId',
          'nonce',
          'state',
          'bindingSecret',
          'privacyVersion',
          'termsVersion',
        ].any((k) => challenge[k] is! String)) {
      await recordAppleLoginClientFailure(
        stage: 'validate_agreements',
        errorType: 'AccountApiException',
        code: 'account_agreements_required',
        durationMs: 0,
      );
      throw const AccountApiException('请确认当前隐私政策与服务协议', {});
    }
    final proof = await _captureAppleFailure(
      'system_authorization',
      () => identity.signIn(
        nonce: challenge['nonce'] as String,
        state: challenge['state'] as String,
        bundleId: configuredPublicBundleId,
      ),
    );
    final response = await _captureAppleFailure(
      'login_submit',
      () => _post('/auth/apple/login', {
        'deploymentId': deploymentId,
        'challengeId': challenge['challengeId'],
        'state': proof['state'],
        'bindingSecret': challenge['bindingSecret'],
        'identityToken': proof['identityToken'],
        'authorizationCode': proof['authorizationCode'],
        'agreements': {
          'privacyAccepted': true,
          'termsAccepted': true,
          'privacyVersion': challenge['privacyVersion'],
          'termsVersion': challenge['termsVersion'],
        },
      }),
    );
    return _captureAppleFailure('login_response', () async {
      _checkDeployment(response);
      return AccountLoginResult.fromJson(response);
    });
  }

  Future<T> _captureAppleFailure<T>(
    String stage,
    Future<T> Function() action,
  ) async {
    final watch = Stopwatch()..start();
    try {
      final value = await action();
      unawaited(
        recordAppleLoginStage(
          stage: stage,
          outcome: 'completed',
          durationMs: watch.elapsedMilliseconds,
        ),
      );
      return value;
    } catch (error) {
      unawaited(
        recordAppleLoginStage(
          stage: stage,
          outcome: 'failed',
          durationMs: watch.elapsedMilliseconds,
        ),
      );
      final data = error is AccountApiException ? error.body['error'] : null;
      final details = error is PlatformException && error.details is Map
          ? error.details as Map
          : null;
      await recordAppleLoginClientFailure(
        stage: stage,
        errorType: error.runtimeType.toString(),
        code: error is PlatformException
            ? error.code
            : data is Map
            ? data['code']
            : null,
        nativeDomain: details?['nativeErrorDomain'],
        nativeCode: details?['nativeErrorCode'],
        durationMs: watch.elapsedMilliseconds,
      );
      rethrow;
    }
  }

  Future<PhoneCodeChallenge> requestPhoneCode(String phone) async {
    final response = await _post('/auth/phone/request-code', {'phone': phone});
    _checkDeployment(response);
    return PhoneCodeChallenge.fromJson(response);
  }

  Future<AccountLoginResult> loginWithPhoneCode({
    required String phone,
    required String code,
  }) async {
    final response = await _post('/auth/phone/login', {
      'phone': phone,
      'code': code,
    });
    _checkDeployment(response);
    return AccountLoginResult.fromJson(response);
  }

  Future<AccountProfile> fetchMe(String token) async {
    final response = await _get('/account/me', token);
    return AccountProfile.fromJson(response['account'] as Map<String, Object?>);
  }

  Future<AccountExportData> exportData(String token) async {
    final operation = onDeviceExecution ? await _currentToken(token) : null;
    final control = await _get('/account/export', token);
    if (onDeviceExecution) {
      final store = OwnedLocalSessionStore(account: createSessionStore());
      final sessions = await store.listSessions(), details = <Object?>[];
      for (final s in sessions) {
        details.add(jsonDecode((await store.exportSession(s.sessionId, format: 'json')).content));
      }
      final payload = {...control, 'sessions': details, 'contentLocation': 'device'};
      await operation?.check();
      final sharing = LocalFileShareService();
      final file = await sharing.saveExportFile(utf8.encode(jsonEncode(payload)), 'wujie-account-export.json');
      await operation?.check();
      await sharing.shareFile(file, mimeType: 'application/json');
      return AccountExportData.fromJson(payload);
    }
    if (configuredAccountBackend != 'cloudflare') {
      return AccountExportData.fromJson(control);
    }
    final processing = Uri.parse(configuredProcessingApiBaseUrl),
        store = createSessionStore();
    final transport = AccountBoundHttpClient(processing, store);
    try {
      final result = await transport.get(
        processing.resolve('/account/export'),
        headers: {'authorization': 'Bearer $token'},
      );
      if (result.statusCode != 200) {
        throw const FormatException('private_data_export_unconfirmed');
      }
      return AccountExportData.fromJson({
        ...control,
        ...(jsonDecode(result.body) as Map<String, Object?>),
      });
    } finally {
      transport.close();
    }
  }

  Future<AccountProfile> requestDeletion(String token) async {
    final response = await _post('/account/delete', const {}, token: token);
    return AccountProfile.fromJson(response['account'] as Map<String, Object?>);
  }

  Future<AccountProfile> requestDeviceDeletion(String token,{required String receiptHash}) async {
    if(!RegExp(r'^[a-f0-9]{64}$').hasMatch(receiptHash)) throw ArgumentError('invalid_deletion_receipt');
    final response=await _post('/account/delete',{'receiptHash':receiptHash},token:token);
    return AccountProfile.fromJson(response['account'] as Map<String,Object?>);
  }

  Future<Map<String,Object?>> deletionStatus(String secret) => _getDeletionStatus(secret);

  Future<void> recordConsent({
    required String token,
    required String consentType,
    required String version,
    required String acceptedAtIso,
    String? scene,
    String source = 'mobile',
    String? locale,
  }) async {
    await _post('/account/consents', {
      'consentType': consentType,
      'version': version,
      'acceptedAt': acceptedAtIso,
      'source': source,
      if (scene != null) 'scene': scene,
      if (locale != null) 'locale': locale,
    }, token: token);
  }

  Future<void> logout(String token) async {
    await _post('/auth/logout', const {}, token: token);
  }

  void close() => _client.close();

  void _checkDeployment(Map<String, Object?> response) {
    if (deploymentId.isNotEmpty && response['deploymentId'] != deploymentId) {
      throw const AccountApiException('Public login deployment mismatch', {});
    }
  }
}
